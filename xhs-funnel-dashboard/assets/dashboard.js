/* 灏忕孩涔﹀叏閾捐矾鎶曟斁鐪嬫澘 路 鍓嶇娓叉煋
   鍥捐〃涓€ 路 鍗曠瘒瓒嬪娍鍒嗘瀽 | 鍥捐〃浜?路 鍗曠瘒鎴愭湰鍒嗘瀽 | 鍥捐〃涓?路 鍏ㄩ摼璺暟鎹?*/
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("dashPayload").textContent);
  const C = {
    text: "#111827", muted: "#6B7280", dim: "#9CA3AF", border: "#E5E7EB",
    grid: "#F3F4F6", panel: "#FFFFFF", brand: "#FF2442",
  };

  // ===== 鑱斿姩 state锛氭瘡涓浘琛ㄥ悇鑷殑鑱斿姩寮€鍏筹紝榛樿鍏ㄥ紑锛岀嫭绔嬫帶鍒?=====
  const STATE = { links: { trend: true, cost: true, table: true }, currentNote: null };

  /** 瀹夊叏鑱斿姩鐨勬牳蹇冿細浠?sourceModule 鎶婇€変腑绗旇鎺ㄩ€佺粰鎵€鏈夊弬涓庤仈鍔ㄧ殑妯″潡 */
  function onNoteChange(sourceModule, noteId) {
    console.log('[onNoteChange] source=' + sourceModule + ' noteId=' + noteId + ' links=' + JSON.stringify(STATE.links));
    STATE.currentNote = noteId;
    // 婧愭ā鍧楀繀椤诲嬀閫夎仈鍔ㄦ墠寰€澶栨帹
    if (!STATE.links[sourceModule]) { console.log('[onNoteChange] 婧愭ā鍧楁湭鍕鹃€夎仈鍔紝璺宠繃'); return; }

    // 瑙ｆ瀽妯″潡鍚?鈫?瀵瑰簲鐨?combo 寮曠敤锛堝欢杩熸眰鍊硷紝澶勭悊 boot 鏃跺簭锛?    function _comboFor(mod) {
      if (mod === "trend") return trendCombo;
      if (mod === "cost") return costCombo;
      if (mod === "table") return tableCombo;
      return null;
    }

    function _push(mod, extra) {
      if (mod === sourceModule || !STATE.links[mod]) return;
      var c = _comboFor(mod);
      if (c && c.selectById) {
        c.selectById(noteId);
        if (extra) extra();
        return;
      }
      // combo 杩樻湭鍒濆鍖?鈫?寤惰繜 300ms 閲嶈瘯涓€娆★紙閲嶆柊鍙栧€艰€岄潪鐢ㄩ棴鍖呮崟鑾风殑鏃у紩鐢級
      var retryMod = mod, retryExtra = extra;
      setTimeout(function () {
        var c2 = _comboFor(retryMod);
        if (c2 && c2.selectById) {
          c2.selectById(noteId);
          if (retryExtra) retryExtra();
        }
      }, 300);
    }

    _push("trend");
    _push("cost");
    _push("table", function () {
      TABLE.keyword = noteId || ""; TABLE.page = 1; renderTable();
    });
  }

  // ---------- 鏍煎紡鍖?----------
  const fmt = {
    int(v) { return v == null ? "鈥? : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 }); },
    // 鏁板瓧绫伙細涓ユ牸2浣嶅皬鏁帮紙鐢ㄤ簬 ROI/鍏戞崲姣旂瓑闈為噾棰濇瘮鍊硷級
    num(v, d = 2) { return v == null ? "鈥? : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }); },
    // 鐜囩被锛?100 鍚庝弗鏍?浣嶅皬鏁板甫 %
    ratio(v, d = 2) { return v == null ? "鈥? : (Number(v) * 100).toFixed(d) + "%"; },
    // 閲戦绫伙細涓ユ牸2浣嶅皬鏁帮紙鍏冿級
    money(v) { return v == null ? "鈥? : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    val(v, col) {
      if (v == null || (typeof v === "number" && !isFinite(v))) return "鈥?;
      if (col.type === "int") return fmt.int(v);
      if (col.type === "ratio") return fmt.ratio(v);
      if (col.type === "num") return fmt.num(v);
      if (col.type === "date") {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v).slice(0, 10);
      }
      return v;
    },
  };

  // ===== 閫氱敤 Combobox =====
  function makeCombo(cfg) {
    /* cfg: { inputId, listId, candidates, onSelect, placeholder, filterKeys, moduleKey }
       moduleKey: "trend" | "cost" 鈥?鐢ㄤ簬鑱斿姩鎺ㄩ€?*/
    const self = { currentId: null, keyword: "", hi: 0, selectById: null, clear: null };
    const inp = document.getElementById(cfg.inputId);
    const list = document.getElementById(cfg.listId);

    // 脳 娓呴櫎鎸夐挳锛氭彃鍒?input 鍚庨潰锛岀粷瀵瑰畾浣?    const clearBtn = document.createElement("span");
    clearBtn.className = "combo-clear";
    clearBtn.innerHTML = "脳";
    clearBtn.title = "涓€閿竻闄?;
    clearBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      self.clear();
    });
    inp.parentNode.insertBefore(clearBtn, inp.nextSibling);
    function _updateClear() {
      clearBtn.style.display = (self.currentId || inp.value.trim()) ? "" : "none";
    }

    self.clear = function () {
      self.currentId = null; self.keyword = ""; self.hi = 0;
      inp.value = ""; inp.classList.remove("has-value", "linked-outside");
      list.hidden = true; _updateClear(); inp.focus();
      if (cfg.onClear) cfg.onClear();
    };

    function getFiltered() {
      const kw = self.keyword;
      const candidates = cfg.candidates || [];
      if (!kw) return candidates.slice(0, 200);
      const low = kw.toLowerCase();
      return candidates.filter(n => {
        for (const k of (cfg.filterKeys || ["note_id", "creator"])) {
          if ((n[k] || "").toLowerCase().includes(low)) return true;
        }
        return false;
      }).slice(0, 200);
    }

    function fmtPubDate(d) {
      if (!d) return "鈥?;
      var s = String(d);
      if (s.length >= 10) s = s.slice(0, 10); // "2026-06-17"
      var parts = s.split("-");
      if (parts.length === 3) return parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
      if (s.length === 8) return s.slice(4, 6).replace(/^0/, "") + "/" + s.slice(6, 8).replace(/^0/, "");
      return s;
    }
    function renderList(keepScroll) {
      const items = getFiltered();
      if (!items.length) {
        list.innerHTML = '<li class="combo-empty">鏃犲尮閰嶇瑪璁?/li>';
        return;
      }
      list.innerHTML = items.map((n, i) =>
        `<li class="combo-item ${i === self.hi ? "hi" : ""}" data-id="${n.note_id}">
          <span class="combo-line"><span class="pub-date">${fmtPubDate(n.pub_date)}</span><span class="sep">|</span><span class="id">${n.note_id}</span><span class="sep">|</span><span class="creator">${escapeHtml(n.creator || "鈥?)}</span></span>
        </li>`).join("");
      list.querySelectorAll(".combo-item").forEach(li => {
        li.addEventListener("click", () => { select(li.dataset.id); });
      });
      if (!keepScroll) list.scrollTop = 0;
      else { const hi = list.querySelector(".combo-item.hi"); if (hi) hi.scrollIntoView({ block: "nearest" }); }
    }

    function restoreInputDisplay() {
      if (!self.currentId) return;
      const candidates = cfg.candidates || [];
      let n = candidates.find(x => x.note_id === self.currentId);
      const isOutside = !n;
      if (!n) n = DATA.notes.find(x => x.note_id === self.currentId);
      if (n) {
        inp.value = `${fmtPubDate(n.pub_date)} | ${n.note_id} | ${n.creator || "鈥?}`;
        inp.classList.add("has-value");
        if (isOutside) inp.classList.add("linked-outside");
        else inp.classList.remove("linked-outside");
      }
    }

    function select(noteId) {
      self.currentId = noteId;
      list.hidden = true;
      restoreInputDisplay();
      _updateClear();
      STATE.currentNote = noteId;
      if (cfg.onSelect) cfg.onSelect(noteId);
      if (cfg.moduleKey) onNoteChange(cfg.moduleKey, noteId);
    }

    self.selectById = function (noteId) {
      console.log('[combo.selectById] moduleKey=' + (cfg.moduleKey || 'none') + ' noteId=' + noteId + ' hasOnSelect=' + !!cfg.onSelect);
      self.currentId = noteId;
      restoreInputDisplay();
      _updateClear();
      list.hidden = true;
      if (cfg.onSelect) cfg.onSelect(noteId);
    };

    inp.addEventListener("focus", () => {
      self.hi = 0; renderList(); list.hidden = false;
      // 閫変腑鍏ㄦ枃鏂逛究澶嶅埗鎴栫洿鎺ヨ緭鍏ヨ鐩栵紝涓嶆竻绌?      inp.select();
    });
    inp.addEventListener("input", () => {
      self.keyword = inp.value.trim().toLowerCase();
      self.hi = 0; renderList(); list.hidden = false;
      _updateClear();
    });
    inp.addEventListener("keydown", e => {
      const items = getFiltered();
      if (e.key === "ArrowDown") { e.preventDefault(); self.hi = Math.min(items.length - 1, self.hi + 1); renderList(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); self.hi = Math.max(0, self.hi - 1); renderList(true); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[self.hi]) select(items[self.hi].note_id); }
      else if (e.key === "Escape") { list.hidden = true; if (self.currentId) restoreInputDisplay(); }
    });
    document.addEventListener("click", function (ev) {
      if (!ev.target.closest("#" + cfg.inputId) && !ev.target.closest("#" + cfg.listId)) {
        list.hidden = true;
        if (self.currentId) restoreInputDisplay();
      }
    });

    // 鏃犲€欓€変汉鏃剁鐢?    if (!cfg.candidates || !cfg.candidates.length) {
      inp.placeholder = cfg.emptyPlaceholder || "锛堟棤鏁版嵁锛?;
      inp.disabled = true;
    }
    return self;
  }

  // ===== 椤堕儴 meta =====
  function renderMeta() {
    const m = DATA.meta;
    document.getElementById("metaPeriod").textContent = "鏁版嵁鍛ㄦ湡锛? + (m.period || "鈥?);
    document.getElementById("metaFlow").textContent =
      "鍙ｅ緞锛? + (m.flow_type || "鍏ㄩ儴娴侀噺") + " / 褰掑洜 " + (m.attr_period || 30) + " 澶?;
    document.getElementById("metaGen").textContent = "鐢熸垚浜?" + m.generated;
    document.getElementById("footAlign").textContent = m.align_ok
      ? "绐楀彛瀵归綈 鉁?宸插榻?
      : (m.align_msg ? "鈿?" + m.align_msg : "鈥?);
  }

  // ===== KPI 椤堕儴 =====
  function renderKpis() {
    const s = DATA.summary;
    const m = DATA.meta || {};
    const kpi = [
      { l: "鎬绘姇鍏ワ紙钖潯瀹炰粯锛?, v: fmt.money(s.total_spend), u: "鍏?, sub: "浠呮帹骞垮畬鎴惵峰疄闄呮敮浠橈紝涓嶅惈杈句汉鍚堜綔璐?, range: m.chili_period, rangeTip: "钖潯鎶曟斁鍛ㄦ湡" },
      { l: '鎬?GMV <span class="gmv-approx" data-tip="鏄熸渤鎸夊唴瀹圭淮搴︾粺璁MV锛屽悓涓€绗旇鍗曞鏋滄湁澶氭潯绗旇鍏卞悓璐＄尞锛岃璁㈠崟GMV浼氳閲嶅璁″叆姣忔潯绗旇锛屽洜姝ゅ姞鎬诲悗鐨凣MV楂樹簬瀹為檯鎴愪氦棰濄€?>鈮?鍙傝€冨€?/span>', v: fmt.money(s.total_gmv), u: "鍏?, sub: "鈿?澶氬唴瀹瑰綊鍥犲瓨鍦ㄩ噸澶嶈绠?, range: m.star_period, rangeTip: "鏄熸渤鏁版嵁鍛ㄦ湡", approx: true },
      { l: '鏁翠綋 ROI <span class="gmv-approx" data-tip="ROI = GMV / 钖潯瀹炰粯锛屽洜鍒嗗瓙GMV鍚鍐呭褰掑洜閲嶅璁＄畻锛岃ROI涓鸿繎浼煎弬鑰冨€硷紝瀹為檯ROI浼氬亸浣庛€?>鈮?鍙傝€冨€?/span>', v: s.overall_roi == null ? "鈥? : Number(s.overall_roi).toFixed(2), u: "", sub: "鍙ｅ緞锛欸MV / 钖潯瀹炰粯锛圙MV鍚綊鍥犻噸澶嶏級", approx: true },
      { l: "绗旇鏁?,        v: fmt.int(s.note_count),    u: "绡?, sub: "宸叉姇 " + fmt.int(s.invested_count) + " 绡? },
    ];
    document.getElementById("kpiRow").innerHTML = kpi.map(k =>
      `<div class="kpi${k.approx ? " kpi-approx" : ""}">
        <div class="kpi-label">${k.l}${k.range ? `<span class="kpi-range" title="${k.rangeTip || ""}">${k.range}</span>` : ""}</div>
        <div class="kpi-val">${k.v}<span class="kpi-unit">${k.u}</span></div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ""}
      </div>`
    ).join("");
  }

  // ===== 鏁版嵁婧愮姸鎬佹潯 =====
  function renderSources() {
    const src = DATA.meta.sources || {};
    const cards = ["pgy", "star", "chili", "lx"].map(k => {
      const s = src[k] || { name: k, loaded: false, rows: 0 };
      const ok = s.loaded;
      const path = (s.path || "").split(/[\\/]/).pop() || "";
      let countTxt = ok ? fmt.int(s.rows) + " 鏉? : "鏈笂浼?;
      if (ok && k === "lx" && s.hit != null) {
        countTxt = fmt.int(s.rows) + " 鏉?路 鍛戒腑鏈湡 " + fmt.int(s.hit) + " 鏉?;
      }
      const period = ok && s.period ? `<span class="src-period">馃搮 ${s.period}</span>` : "";
      return `<div class="src-card">
        <div class="src-badge ${ok ? "ok" : "miss"}">${ok ? "鉁? : "鈥?}</div>
        <div class="src-info">
          <div class="src-name">${s.name} <span class="src-count ${ok ? "" : "miss"}">${countTxt}</span></div>
          <div class="src-desc">${ok ? path : (s.reason || "缂哄け璇ヨ〃锛岀浉鍏冲瓧娈靛垪灏嗘爣娉?)}</div>
          ${period}
        </div>
      </div>`;
    }).join("");
    document.getElementById("sourceStrip").innerHTML = cards;
  }

  // ===== 鍥捐〃涓€ 路 鍗曠瘒瓒嬪娍鍒嗘瀽 =====
  let trendChart = null, trendCombo = null;

  function fmtDate(d) {
    if (d == null) return "鈥?;
    const s = String(d);
    return s.length === 8 ? s.slice(4, 6) + "/" + s.slice(6, 8) : s;
  }

  // 杩涘簵UV鏃ュ潎鍊艰櫄绾匡紙type=average锛孶V绫绘寜鏁存暟鏄剧ず锛?  function buildAvgMarkLine(color) {
    return {
      symbol: "none",
      silent: true,
      precision: 0,
      lineStyle: { color: color, type: "dashed", width: 1.5, opacity: 0.75 },
      label: {
        formatter: function(p){ return "鏃ュ潎 " + Math.round(p.value); },
        position: "insideEndTop",
        fontSize: 11,
        fontWeight: 600,
        color: color,
        backgroundColor: "rgba(255,255,255,0.85)",
        padding: [2, 4],
        borderRadius: 3,
      },
      data: [{ type: "average", name: "杩涘簵UV鏃ュ潎" }],
    };
  }

  function renderTrendModule() {
    const trends = DATA.trends || {};
    const trendsAll = DATA.trends_all || [];
    const candidates = DATA.notes
      .filter(n => trends[n.note_id])
      .sort((a, b) => (b.gmv || 0) - (a.gmv || 0));

    trendCombo = makeCombo({
      inputId: "trendSearch", listId: "trendList", candidates,
      filterKeys: ["note_id", "creator"], moduleKey: "trend",
      emptyPlaceholder: "锛堟棤瓒嬪娍鏄庣粏鏁版嵁锛?,
      onSelect: function (noteId) { renderTrend(noteId); },
      onClear: function () { renderTrend(null); },
    });

    // 榛樿锛氭棤閫変腑 鈫?灞曠ず鍏ㄩ儴绗旇姹囨€昏秼鍔?    if (trendsAll.length || candidates.length) {
      renderTrend(null);
    } else {
      document.getElementById("trendChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">鏄熸渤琛ㄦ湭鍔犺浇鎴栨棤鎸夋棩鏄庣粏锛屾棤娉曠粯鍒惰秼鍔?/div>';
    }
  }

  /** renderTrend(null) = 鍏ㄩ儴绗旇姹囨€伙紱renderTrend(noteId) = 鍗曠瘒 */
  function renderTrend(noteId) {
    if (trendCombo) trendCombo.currentId = noteId || null;
    const trendsAll = DATA.trends_all || [];

    if (!noteId) {
      // ===== 鍏ㄩ儴绗旇姹囨€绘ā寮?=====
      const rows = trendsAll;
      if (!rows.length) {
        document.getElementById("trendChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">鏆傛棤姹囨€昏秼鍔挎暟鎹?/div>';
        return;
      }
      const period = rows.length
        ? fmtDate(rows[0][0]) + " ~ " + fmtDate(rows[rows.length - 1][0])
        : "鈥?;
      const totalVisit = rows.reduce((s, r) => s + (r[1] || 0), 0);
      const totalCart = rows.reduce((s, r) => s + (r[2] || 0), 0);
      const totalDeal = rows.reduce((s, r) => s + (r[3] || 0), 0);
      const totalGmv = rows.reduce((s, r) => s + (r[4] || 0), 0);
      const kpis = [
        { l: "鎬昏繘搴桿V锛堝叏閮級", v: fmt.int(totalVisit), u: "" },
        { l: "鎬诲姞璐璘V锛堝叏閮級", v: fmt.int(totalCart), u: "" },
        { l: "鎬绘垚浜V锛堝叏閮級", v: fmt.int(totalDeal), u: "" },
        { l: '鎬籊MV锛堝叏閮級<span class="gmv-approx" data-tip="鏄熸渤鎸夊唴瀹圭淮搴︾粺璁MV锛屽悓涓€绗旇鍗曡澶氭潯绗旇鍏卞悓璐＄尞鏃朵細閲嶅璁″叆锛屽姞鎬诲悗楂樹簬瀹為檯鎴愪氦棰濄€?>鈮?鍙傝€冨€?/span>', v: fmt.money(totalGmv), u: "鍏?, approx: true },
        { l: "绗旇鏁?, v: fmt.int(DATA.notes.length), u: "绡? },
        { l: "", v: "馃搳 鍏ㄩ儴绗旇姹囨€?, u: "" },
      ];
      document.getElementById("trendKpis").innerHTML = kpis.map(k =>
        `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
          <div class="trend-kpi-label">${k.l}</div>
          <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
        </div>`
      ).join("");

      if (!trendChart) trendChart = echarts.init(document.getElementById("trendChart"));
      const dates = rows.map(r => fmtDate(r[0]));
      const series = [
        { name: "杩涘簵UV锛堝叏閮級", data: rows.map(r => r[1]), col: "#FF2442", avg: true },
        { name: "鍔犺喘UV锛堝叏閮級", data: rows.map(r => r[2]), col: "#F97316" },
        { name: "鎴愪氦UV锛堝叏閮級", data: rows.map(r => r[3]), col: "#EAB308" },
      ];
      trendChart.setOption({
        backgroundColor: "transparent",
        tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "#fff", borderColor: C.border, textStyle: { color: C.text } },
        legend: { top: 0, textStyle: { color: C.muted, fontSize: 12 }, itemWidth: 12, itemHeight: 2 },
        grid: { top: 40, left: 60, right: 30, bottom: 40 },
        xAxis: {
          type: "category", data: dates,
          axisLine: { lineStyle: { color: C.border } },
          axisLabel: { fontSize: 11, color: C.muted, rotate: dates.length > 40 ? 45 : 0 },
        },
        yAxis: {
          type: "value", name: "UV", position: "left",
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: C.grid } },
          axisLabel: { color: C.muted, fontSize: 11 }, nameTextStyle: { color: C.dim },
        },
        series: series.map(s => ({
          name: s.name, type: "line", data: s.data,
          smooth: true, symbol: "circle", symbolSize: 5,
          lineStyle: { color: s.col, width: 2 },
          itemStyle: { color: s.col },
          ...(s.avg ? { markLine: buildAvgMarkLine(s.col) } : {}),
        })),
      });
      return;
    }

    // ===== 鍗曠瘒绗旇妯″紡 =====
    const rows = (DATA.trends || {})[noteId] || [];
    const note = DATA.notes.find(n => n.note_id === noteId) || {};

    const period = rows.length
      ? fmtDate(rows[0][0]) + " ~ " + fmtDate(rows[rows.length - 1][0])
      : "鈥?;

    // 璁＄畻澶嶅悎鎸囨爣
    const readUv = note.read_uv_content || note.read_uv_funnel || 0;
    const visitUv = note.visit_uv || 0;
    const cartUv = note.cart_uv || 0;
    const dealUv = note.deal_uv || 0;
    const gmv = note.gmv || 0;
    const visitRate = readUv > 0 ? (visitUv / readUv * 100) : null;
    const cartRate = visitUv > 0 ? (cartUv / visitUv * 100) : null;
    const dealRate = visitUv > 0 ? (dealUv / visitUv * 100) : null;
    const uvValue = visitUv > 0 ? (gmv / visitUv) : null;

    const kpis = [
      { l: "鎬婚槄璇籙V", v: fmt.int(readUv), rate: null, tip: "", u: "" },
      { l: "鎬昏繘搴桿V", v: fmt.int(visitUv), rate: visitRate != null ? visitRate.toFixed(2) + "%" : null, tip: "杩涘簵鐜?= 杩涘簵UV 梅 闃呰UV", u: "" },
      { l: "鎬诲姞璐璘V", v: fmt.int(cartUv), rate: cartRate != null ? cartRate.toFixed(2) + "%" : null, tip: "杩涘簵鍔犺喘鐜?= 鍔犺喘UV 梅 杩涘簵UV", u: "" },
      { l: "鎬绘垚浜V", v: fmt.int(dealUv), rate: dealRate != null ? dealRate.toFixed(2) + "%" : null, tip: "杩涘簵杞寲鐜?= 鎴愪氦UV 梅 杩涘簵UV", u: "" },
      { l: '鎬籊MV <span class="gmv-approx" data-tip="鏄熸渤鎸夊唴瀹圭淮搴︾粺璁MV锛屽悓涓€绗旇鍗曡澶氭潯绗旇鍏卞悓璐＄尞鏃朵細閲嶅璁″叆锛屾暟鍊奸珮浜庡疄闄呮垚浜ら銆?>鈮?鍙傝€冨€?/span>', v: fmt.money(gmv), rate: null, tip: "鈿?澶氬唴瀹瑰綊鍥犱笅鍚噸澶嶈绠楋紝闈炵簿纭€?, u: "鍏?, approx: true },
      { l: 'UV浠峰€?<span class="gmv-approx" data-tip="UV浠峰€?= GMV 梅 杩涘簵UV锛屽洜GMV鍚鍐呭褰掑洜閲嶅锛岃鍊间负杩戜技鍙傝€冦€?>鈮?鍙傝€冨€?/span>', v: uvValue != null ? "楼" + uvValue.toFixed(2) : "鈥?, rate: null, tip: "UV浠峰€?= 鎬籊MV 梅 杩涘簵UV锛圙MV鍚綊鍥犻噸澶嶏級", u: "", approx: true },
    ];
    document.getElementById("trendKpis").innerHTML = kpis.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span>${k.rate ? '<span class="trend-kpi-rate"> ' + k.rate + '</span>' : ""}</div>
      </div>`
    ).join("");

    // 绗旇鍙戝竷鏃ユ湡锛坸 杞寸孩瀛楁爣娉紝涓庡浘琛ㄤ簩涓€鑷达級
    const pubDateRaw = note.pub_date ? note.pub_date : null;
    const pubDateStr = pubDateRaw ? fmtDate(pubDateRaw.replace(/-/g, "")) : null;

    if (!trendChart) trendChart = echarts.init(document.getElementById("trendChart"));
    const dates = rows.map(r => fmtDate(r[0]));
    const series = [
      { name: "杩涘簵UV", data: rows.map(r => r[1]), col: "#FF2442", avg: true },
      { name: "鍔犺喘UV", data: rows.map(r => r[2]), col: "#F97316" },
      { name: "鎴愪氦UV", data: rows.map(r => r[3]), col: "#EAB308" },
    ];
    trendChart.setOption({
      backgroundColor: "transparent",
      graphic: [
        {
          type: "text",
          left: 56,
          top: 5,
          style: {
            text: "进店汇总  " + fmt.int(totalVisit),
            fill: "#FF2442",
            font: "bold 13px system-ui, -apple-system, sans-serif",
          },
          z: 100,
        },
      ],
      tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "#fff", borderColor: C.border, textStyle: { color: C.text } },
      legend: { top: 0, textStyle: { color: C.muted, fontSize: 12 }, itemWidth: 12, itemHeight: 2 },
      grid: { top: 40, left: 60, right: 30, bottom: 40 },
      xAxis: {
        type: "category", data: dates,
        axisLine: { lineStyle: { color: C.border } },
        axisLabel: {
          fontSize: 11, fontWeight: 600,
          color: function (value) {
            return pubDateStr && value === pubDateStr ? "#FF2442" : C.muted;
          },
          rotate: dates.length > 40 ? 45 : 0,
        },
      },
      yAxis: {
        type: "value", name: "UV", position: "left",
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.muted, fontSize: 11 }, nameTextStyle: { color: C.dim },
      },
      series: series.map(s => ({
        name: s.name, type: "line", data: s.data,
        smooth: true, symbol: "circle", symbolSize: 5,
        lineStyle: { color: s.col, width: 2 },
        itemStyle: { color: s.col },
        ...(s.avg ? { markLine: buildAvgMarkLine(s.col) } : {}),
      })),
    });
  }

  // ===== 鍥捐〃浜?路 鍗曠瘒鎴愭湰鍒嗘瀽 =====
  let costChart = null, costCombo = null;

  function renderCostModule() {
    const costData = DATA.cost || {};
    const costAll = DATA.cost_all;
    const candidates = DATA.notes
      .filter(n => costData[n.note_id])
      .sort((a, b) => (b.spend || 0) - (a.spend || 0));

    costCombo = makeCombo({
      inputId: "costSearch", listId: "costList", candidates,
      filterKeys: ["note_id", "creator"], moduleKey: "cost",
      emptyPlaceholder: "锛堟棤宸叉姇鏀剧瑪璁帮級",
      onSelect: function (noteId) { renderCost(noteId); },
      onClear: function () { renderCost(null); },
    });

    // 榛樿锛氭棤閫変腑 鈫?灞曠ず鍏ㄩ儴绗旇姹囨€绘秷鑰?    if (costAll || candidates.length) {
      renderCost(null);
    } else {
      document.getElementById("costChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">钖潯琛ㄦ湭鍔犺浇鎴栨棤娑堣€楁暟鎹紝鏃犳硶灞曠ず鎴愭湰鍒嗘瀽</div>';
    }
  }

  /** renderCost(null) = 鍏ㄩ儴绗旇姹囨€伙紱renderCost(noteId) = 鍗曠瘒 */
  function renderCost(noteId) {
    console.log('[renderCost] called with noteId:', JSON.stringify(noteId), 'type:', typeof noteId);
    if (costCombo) costCombo.currentId = noteId || null;
    const costData = DATA.cost || {};

    if (!noteId) {
      console.log('[renderCost] 鈫?姹囨€绘ā寮忥紙!noteId锛?);
      // ===== 鍏ㄩ儴绗旇姹囨€绘ā寮?=====
      const ca = DATA.cost_all;
      if (!ca || !ca.daily || !ca.daily.length) {
        document.getElementById("costChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">鏆傛棤娑堣€楁眹鎬绘暟鎹?/div>';
        return;
      }
      const s = ca.summary || {};
      const daily = ca.daily || [];
      const kpiItems = [
        { l: "鎬绘秷鑰楋紙鍏ㄩ儴锛?, v: fmt.money(s.spend), u: "鍏? },
        { l: '鎬籊MV锛堝叏閮級<span class="gmv-approx" data-tip="鏄熸渤鎸夊唴瀹圭淮搴︾粺璁MV锛屽悓涓€绗旇鍗曡澶氭潯绗旇鍏卞悓璐＄尞鏃朵細閲嶅璁″叆锛屽姞鎬诲悗楂樹簬瀹為檯鎴愪氦棰濄€?>鈮?鍙傝€冨€?/span>', v: fmt.money(s.gmv), u: "鍏?, approx: true },
        { l: "鎬昏繘搴桿V锛堝叏閮級", v: fmt.int(s.visit_uv), u: "" },
        { l: "鎬诲姞璐璘V锛堝叏閮級", v: fmt.int(s.cart_uv), u: "" },
        { l: "鎬绘垚浜V锛堝叏閮級", v: fmt.int(s.deal_uv), u: "" },
        { l: "绗旇鏁?, v: fmt.int(s.note_count), u: "绡? },
        { l: "", v: "馃搳 鍏ㄩ儴绗旇姹囨€?, u: "" },
      ];
      document.getElementById("costKpis").innerHTML = kpiItems.map(k =>
        `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
          <div class="trend-kpi-label">${k.l}</div>
          <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
        </div>`
      ).join("");

      if (!costChart) costChart = echarts.init(document.getElementById("costChart"));
      const dates = daily.map(r => fmtDate(r[0]));
      const spendVals = daily.map(r => r[1]);
      costChart.setOption({
        backgroundColor: "transparent",
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "#fff", borderColor: C.border, textStyle: { color: C.text, fontSize: 13 },
          formatter: function (params) {
            const di = params[0].dataIndex;
            const row = daily[di];
            const sp = row[1] != null ? "楼" + Number(row[1]).toFixed(2) : "鈥?;
            const tdL2 = "color:#6B7280;text-align:right;padding-right:10px;white-space:nowrap";
            const tdR2 = "font-weight:600;text-align:right";
            return `<div style="font-weight:700;margin-bottom:4px">${fmtDate(row[0])}</div>
              <table style="border-spacing:0 2px;font-size:13px;line-height:1.6">
              <tr><td style="${tdL2}">褰撴棩鎬绘秷鑰?/td><td style="${tdR2}">${sp}</td></tr>
              </table>`;
          },
        },
        grid: { top: 20, left: 60, right: 70, bottom: 40 },
        xAxis: {
          type: "category", data: dates,
          axisLine: { lineStyle: { color: C.border } },
          axisLabel: { fontSize: 11, fontWeight: 600, rotate: dates.length > 40 ? 45 : 0 },
        },
        yAxis: [
          { type: "value", name: "鍏?, position: "left",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { lineStyle: { color: C.grid } },
            axisLabel: { color: "#FF2442", fontSize: 11, fontWeight: 600, formatter: function(v){ return v>=1000 ? (v/1000).toFixed(1)+"k" : Math.round(v); } }, nameTextStyle: { color: "#FF2442", fontWeight: 600 },
          },
          { type: "value", name: "鍏?UV", position: "right",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { color: "#F97316", fontSize: 11, fontWeight: 600, formatter: function(v){ return "楼"+v.toFixed(1); } },
            nameTextStyle: { color: "#F97316", fontWeight: 600 },
          },
        ],
        series: [
          { name: "褰撴棩鎬诲疄浠?, type: "bar", yAxisIndex: 0, data: spendVals,
            itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#FF4D6A" }, { offset: 1, color: "#FF2442" }
            ]) },
            barMaxWidth: 30,
          },
          { name: "绱杩涘簵鎴愭湰锛堝叏閮級", type: "line", yAxisIndex: 1,
            data: daily.map(r => r[3]),
            smooth: true, symbol: "none",
            lineStyle: { color: "#FF2442", width: 2, type: "dashed" },
          },
        ],
      });
      return;
    }

    // ===== 鍗曠瘒绗旇妯″紡 =====
    const entry = costData[noteId];
    if (!entry) {
      if (costChart) { try { costChart.dispose(); } catch (ignore) {} costChart = null; }
      document.getElementById("costChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">璇ョ瑪璁版棤鎴愭湰鏁版嵁</div>';
      // 娓呯┖鎸囨爣鍗★紝閬垮厤娈嬬暀姹囨€绘暟鎹?      document.getElementById("costKpis").innerHTML = "";
      return;
    }
    const s = entry.summary || {};
    const daily = entry.daily || [];

    // 7 鎸囨爣鍗?    const kpiItems = [
      { l: "绱娑堣€?, v: fmt.money(s.spend), u: "鍏? },
      { l: '绱GMV <span class="gmv-approx" data-tip="鏄熸渤鎸夊唴瀹圭淮搴︾粺璁MV锛屽悓涓€绗旇鍗曡澶氭潯绗旇鍏卞悓璐＄尞鏃朵細閲嶅璁″叆锛屾暟鍊奸珮浜庡疄闄呮垚浜ら銆?>鈮?鍙傝€冨€?/span>', v: fmt.money(s.gmv), u: "鍏?, approx: true },
      { l: 'ROI <span class="gmv-approx" data-tip="ROI = GMV / 钖潯瀹炰粯锛屽洜鍒嗗瓙GMV鍚鍐呭褰掑洜閲嶅锛岃鍊间负杩戜技鍙傝€冿紝瀹為檯ROI浼氬亸浣庛€?>鈮?鍙傝€冨€?/span>', v: s.roi == null ? "鈥? : Number(s.roi).toFixed(2), u: "", approx: true },
      { l: "杩涘簵UV鎴愭湰", v: s.visit_uv_cost == null ? "鈥? : "楼" + Number(s.visit_uv_cost).toFixed(2), u: "" },
      { l: "鍔犺喘鎴愭湰",  v: s.cart_cost == null ? "鈥? : "楼" + Number(s.cart_cost).toFixed(2), u: "" },
      { l: "鎴愪氦鎴愭湰",  v: s.deal_cost == null ? "鈥? : "楼" + Number(s.deal_cost).toFixed(2), u: "" },
      { l: "鍘嗗彶鏈€楂樺崟鏃?, v: s.max_daily == null ? "鈥? : "楼" + Number(s.max_daily).toFixed(2), u: "" },
    ];
    document.getElementById("costKpis").innerHTML = kpiItems.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
      </div>`
    ).join("");

    // 绗旇鍙戝竷鏃ユ湡锛堢敤浜?x 杞存爣娉紝瀵归綈 fmtDate 鏍煎紡 MM/DD锛?    const noteInfo = DATA.notes.find(n => n.note_id === noteId);
    const pubDateRaw = noteInfo && noteInfo.pub_date ? noteInfo.pub_date : null;
    const pubDateStr = pubDateRaw ? fmtDate(pubDateRaw.replace(/-/g, "")) : null;

    // ECharts 鏌辩姸鍥撅紙鍔犲浐锛歵ry-catch + 鑷姩鎭㈠锛?    try {
      if (!costChart) costChart = echarts.init(document.getElementById("costChart"));
      const dates = daily.map(r => fmtDate(r[0]));
      const spendVals = daily.map(r => r[1]);
      costChart.setOption({
        backgroundColor: "transparent",
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "#fff", borderColor: C.border, textStyle: { color: C.text, fontSize: 13 },
          formatter: function (params) {
            const di = params[0].dataIndex;
            const row = daily[di];
            const sp = row[1] != null ? "楼" + Number(row[1]).toFixed(2) : "鈥?;
            let vc = "鈥?;
            const visit = row[2], spend = row[1];
            if (spend && spend > 0 && visit && visit > 0) vc = "楼" + (spend / visit).toFixed(2);
            const dStr = fmtDate(row[0]);
            const isPub = pubDateStr && dStr === pubDateStr;
            const cumCost = row[6] != null ? "楼" + Number(row[6]).toFixed(2) : "鈥?;
            const tdL = "color:#6B7280;text-align:right;padding-right:10px;white-space:nowrap";
            const tdR = "font-weight:600;text-align:right;font-variant-numeric:tabular-nums";
            const pubTag = isPub ? ' <span style="color:#FF2442;font-size:11px">绗旇鍙戝竷鏃ユ湡</span>' : "";
            return `<div style="font-weight:700;margin-bottom:6px">${dStr}${pubTag}</div>
              <table style="border-spacing:0 2px;font-size:13px;line-height:1.6">
              <tr><td style="${tdL}">褰撴棩娑堣€?/td><td style="${tdR}">${sp}</td></tr>
              <tr><td style="${tdL}">褰撴棩杩涘簵鎴愭湰</td><td style="${tdR}">${vc}</td></tr>
              <tr><td style="${tdL}">绱杩涘簵鎴愭湰</td><td style="${tdR}">${cumCost}</td></tr>
              </table>`;
          },
        },
        grid: { top: 20, left: 60, right: 70, bottom: 40 },
        xAxis: {
          type: "category", data: dates,
          axisLine: { lineStyle: { color: C.border } },
          axisLabel: {
            fontSize: 11, fontWeight: 600,
            color: function (value) {
              return pubDateStr && value === pubDateStr ? "#FF2442" : "#111827";
            },
            rotate: dates.length > 40 ? 45 : 0,
          },
        },
        yAxis: [
          { type: "value", name: "鍏?, position: "left",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { lineStyle: { color: C.grid } },
            axisLabel: { color: "#FF2442", fontSize: 11, fontWeight: 600, formatter: function(v){ return v>=1000 ? (v/1000).toFixed(1)+"k" : v.toFixed(2); } }, nameTextStyle: { color: "#FF2442", fontWeight: 600 },
          },
          { type: "value", name: "鍏?UV", position: "right",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { color: "#F97316", fontSize: 11, fontWeight: 600, formatter: function(v){ return "楼"+v.toFixed(2); } },
            nameTextStyle: { color: "#F97316", fontWeight: 600 },
          },
        ],
        series: [
          { name: "褰撴棩瀹炰粯", type: "bar", yAxisIndex: 0, data: spendVals,
            itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#FF4D6A" }, { offset: 1, color: "#FF2442" }
            ]) },
            barMaxWidth: 30,
          },
          { name: "绱杩涘簵鎴愭湰", type: "line", yAxisIndex: 1,
            data: daily.map(r => r[6]),
            smooth: true, symbol: "none",
            lineStyle: { color: "#FF2442", width: 2, type: "dashed" },
          },
        ],
      });
    } catch (e) {
      console.error("costChart render error:", e);
      if (costChart) { try { costChart.dispose(); } catch (ignore) {} costChart = null; }
      document.getElementById("costChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#DC2626">鍥捐〃娓叉煋澶辫触锛? + (e.message || e) + '<br><small>璇峰埛鏂伴〉闈㈠悗閲嶈瘯</small></div>';
    }
  }

  // ===== 鍥捐〃涓?路 鍏ㄩ摼璺〃鏍?=====
  const TABLE = {
    allCols: [],
    byKey: {},
    groups: DATA.column_groups || [],
    fixed: ["note_id", "creator"],
    selected: [],
    sortKey: null,
    sortDir: "desc",
    keyword: "",
    page: 1,
    pageSize: 30,
    // 鏌ヨ闈㈡澘绛涢€夌姸鎬侊紙鍥捐〃涓夌嫭绔嬬瓫閫夛紝涓嶅弬涓庤仈鍔級
    filter: {
      creator: "",       // 杈句汉鏄电О锛堟ā绯婂寘鍚尮閰嶏級
      noteId: "",        // 绗旇ID锛堟ā绯婂寘鍚尮閰嶏級
      pubDateStart: "",  // YYYY-MM-DD
      pubDateEnd: "",    // YYYY-MM-DD
    },
  };

  function initTableCols() {
    for (const g of TABLE.groups) {
      for (const c of g.columns) {
        c.group = g.key;
        c.groupLabel = g.label;
        // 娲剧敓瀛楁鏍囪锛歴ource=="绯荤粺璁＄畻" 鈫?derived
        c.derived = (c.source === "绯荤粺璁＄畻");
        TABLE.allCols.push(c);
        TABLE.byKey[c.key] = c;
      }
    }
    const saved = safeLoadSel();
    TABLE.selected = saved && saved.length ? saved : (DATA.default_columns || []).slice();
    ensureFixedFirst();
  }
  function ensureFixedFirst() {
    TABLE.selected = TABLE.selected.filter(k => TABLE.byKey[k]);
    for (let i = TABLE.fixed.length - 1; i >= 0; i--) {
      const k = TABLE.fixed[i];
      const at = TABLE.selected.indexOf(k);
      if (at >= 0) TABLE.selected.splice(at, 1);
      TABLE.selected.unshift(k);
    }
  }
  function safeLoadSel() {
    try {
      const v = localStorage.getItem("xhs_dash_cols_v4");
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  }
  function safeSaveSel() {
    try { localStorage.setItem("xhs_dash_cols_v4", JSON.stringify(TABLE.selected)); } catch {}
  }

  function isColMissing(col) {
    if (col.key === "note_id" || col.key === "creator") return null;
    const src = DATA.meta.sources || {};
    const loaded = {
      "钂插叕鑻?: !!(src.pgy && src.pgy.loaded),
      "鏄熸渤": !!(src.star && src.star.loaded),
      "钖潯": !!(src.chili && src.chili.loaded),
      "鐏电妧": !!(src.lx && src.lx.loaded),
    };
    const deps = [];
    const need = col.source || "";
    for (const t of ["钂插叕鑻?, "鏄熸渤", "钖潯", "鐏电妧"]) if (need.includes(t)) deps.push(t);
    if (Array.isArray(col.needs)) for (const t of col.needs) if (!deps.includes(t)) deps.push(t);
    for (const t of deps) if (!loaded[t]) return "闇€涓婁紶" + t;
    return null;
  }

  // ===== 鍥捐〃涓?路 鏌ヨ闈㈡澘锛氬瓧娈电瓫閫?+ CSV 瀵煎嚭 =====


  // 搴旂敤鏌ヨ闈㈡澘鎵€鏈夌瓫閫?  function applyPanelFilter(notes) {
    const F = TABLE.filter;
    let out = notes;
    if (F.creator) {
      const k = F.creator.toLowerCase();
      out = out.filter(n => (n.creator || "").toLowerCase().includes(k));
    }
    if (F.noteId) {
      const k = F.noteId.trim().toLowerCase();
      out = out.filter(n => String(n.note_id || "").toLowerCase().includes(k));
    }
    if (F.pubDateStart) out = out.filter(n => n.pub_date && String(n.pub_date).slice(0, 10) >= F.pubDateStart);
    if (F.pubDateEnd) out = out.filter(n => n.pub_date && String(n.pub_date).slice(0, 10) <= F.pubDateEnd);
    return out;
  }

  function initQueryPanel() {
    const qCreator = document.getElementById("qpCreator");
    const qNoteId = document.getElementById("qpNoteId");
    const qStart = document.getElementById("qpDateStart");
    const qEnd = document.getElementById("qpDateEnd");

    document.getElementById("qpQuery").addEventListener("click", applyQuery);
    document.getElementById("qpReset").addEventListener("click", resetQuery);
    document.getElementById("qpExport").addEventListener("click", exportCSV);

    // 杈撳叆鍗宠繃婊わ細杈句汉鏄电О/绗旇ID 鎵撳瓧瀹炴椂鍖归厤锛?50ms debounce 閬垮厤鎶栧姩锛夛紝鏃ユ湡鏀瑰姩绔嬪嵆瑙﹀彂
    let debounceTimer = null;
    function debouncedApply() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyQuery, 150);
    }
    [qCreator, qNoteId].forEach(el => el.addEventListener("input", debouncedApply));
    [qStart, qEnd].forEach(el => el.addEventListener("change", applyQuery));

    // Enter 閿篃鍙互鎵嬪姩瑙﹀彂锛堜笉鐢ㄧ瓑 debounce锛?    [qCreator, qNoteId, qStart, qEnd].forEach(el => {
      el.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(debounceTimer); applyQuery(); }
      });
    });

    function applyQuery() {
      TABLE.filter.creator = qCreator.value.trim();
      TABLE.filter.noteId = qNoteId.value.trim();
      TABLE.filter.pubDateStart = qStart.value;
      TABLE.filter.pubDateEnd = qEnd.value;
      TABLE.page = 1;
      renderTable();
    }

    function resetQuery() {
      qCreator.value = ""; qNoteId.value = "";
      qStart.value = ""; qEnd.value = "";
      TABLE.filter = { creator: "", noteId: "", pubDateStart: "", pubDateEnd: "" };
      TABLE.page = 1;
      renderTable();
    }
  }

  function csvEscape(v) {
    if (v == null) return "";
    let s = String(v);
    if (typeof v === "number") {
      // 淇濈暀鏁版嵁绮惧害锛氭暣鏁颁笉鍔犲皬鏁般€佸皬鏁颁繚鐣?4 浣?      s = Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
    }
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    const cols = TABLE.selected.map(k => TABLE.byKey[k]).filter(Boolean);
    if (!cols.length) { alert("娌℃湁鍙鍑虹殑鍒?); return; }
    // 澶嶇敤绛涢€夛紙涓嶅惈鍒嗛〉鍜屾帓搴忥紝瀵煎嚭鍏ㄩ儴绛涢€夌粨鏋滐級
    let notes = DATA.notes.slice();
    notes = applyPanelFilter(notes);
    if (TABLE.keyword) {
      const terms = TABLE.keyword.toLowerCase().split(/\s+/).filter(Boolean);
      notes = notes.filter(n => {
        const hay = ((n.note_id || "") + " " + (n.creator || "")).toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    // 淇濇寔褰撳墠鎺掑簭
    if (TABLE.sortKey) {
      const k = TABLE.sortKey, dir = TABLE.sortDir === "desc" ? -1 : 1;
      notes.sort((a, b) => {
        const va = a[k], vb = b[k];
        const na = va == null || va === "" ? -Infinity : (typeof va === "number" ? va : String(va));
        const nb = vb == null || vb === "" ? -Infinity : (typeof vb === "number" ? vb : String(vb));
        if (typeof na === "number" && typeof nb === "number") return (na - nb) * dir;
        return String(na).localeCompare(String(nb)) * dir;
      });
    }

    const header = cols.map(c => csvEscape(c.label + (c.unit ? "(" + c.unit + ")" : ""))).join(",");
    const rows = notes.map(n => cols.map(c => csvEscape(n[c.key])).join(","));
    const csv = "锘? + header + "\r\n" + rows.join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = (new Date()).toISOString().slice(0, 10);
    a.href = url;
    a.download = "鍏ㄩ摼璺暟鎹甠" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  const FROZEN_W = { note_id: 210, creator: 130, pub_date: 110 };

  function computeFrozen(cols) {
    const frozen = {};
    let off = 0, lastKey = null, totalW = 0, count = 0;
    for (const c of cols) {
      if (c.group !== "base") break;
      const w = FROZEN_W[c.key] || 120;
      frozen[c.key] = { left: off, width: w };
      lastKey = c.key; off += w; totalW += w; count++;
    }
    return { map: frozen, lastKey, totalW, count };
  }

  function renderTable() {
    const cols = TABLE.selected.map(k => TABLE.byKey[k]).filter(Boolean);
    const thead = document.getElementById("tableHead");
    const tbody = document.getElementById("tableBody");
    const FZ = computeFrozen(cols);

    const groupRuns = [];
    for (const c of cols) {
      const last = groupRuns[groupRuns.length - 1];
      if (last && last.group === c.group) last.span++;
      else groupRuns.push({ group: c.group, label: c.groupLabel, span: 1 });
    }
    const groupRow = "<tr class='group-row'>" + groupRuns.map(r => {
      const isBaseFrozen = r.group === "base" && FZ.count > 0;
      const style = isBaseFrozen ? ` style="left:0;min-width:${FZ.totalW}px"` : "";
      const cls = "group-h grp-" + r.group + (isBaseFrozen ? " frozen-group" : "");
      return `<th class="${cls}" colspan="${r.span}"${style}>${r.label}</th>`;
    }).join("") + "</tr>";

    const fieldRow = "<tr>" + cols.map(c => {
      const active = TABLE.sortKey === c.key;
      const arrow = !active ? "鈫? : (TABLE.sortDir === "desc" ? "鈫? : "鈫?);
      const missing = isColMissing(c);
      const grp = "grp-" + c.group;
      const fz = FZ.map[c.key];
      const fzCls = fz ? " frozen-col" + (c.key === FZ.lastKey ? " last-frozen" : "") : "";
      const fzStyle = fz ? ` style="left:${fz.left}px;min-width:${fz.width}px;max-width:${fz.width}px"` : "";
      return `<th class="${grp}${fzCls}" data-key="${c.key}"${fzStyle}${missing ? ' title="' + missing + '"' : ""}>
        <span class="th-cell">
          <span class="th-name">${c.label}</span>
          <span class="sort-arrow ${active ? "active" : ""}">${arrow}</span>
        </span>
      </th>`;
    }).join("") + "</tr>";

    thead.innerHTML = groupRow + fieldRow;
    requestAnimationFrame(() => {
      const groupTr = thead.querySelector(".group-row");
      if (!groupTr) return;
      const h = groupTr.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--group-h-height", h + "px");
    });

    let notes = DATA.notes.slice();
    // 鏌ヨ闈㈡澘绛涢€夛紙杈句汉鏄电О/绗旇ID/鍙戝竷鏃ユ湡/鑷劧璇█锛?    notes = applyPanelFilter(notes);
    if (TABLE.keyword) {
      const terms = TABLE.keyword.toLowerCase().split(/\s+/).filter(Boolean);
      notes = notes.filter(n => {
        const hay = ((n.note_id || "") + " " + (n.creator || "")).toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    if (TABLE.sortKey) {
      const k = TABLE.sortKey;
      const dir = TABLE.sortDir === "desc" ? -1 : 1;
      notes.sort((a, b) => {
        const va = a[k], vb = b[k];
        const na = va == null || va === "" ? -Infinity : (typeof va === "number" ? va : String(va));
        const nb = vb == null || vb === "" ? -Infinity : (typeof vb === "number" ? vb : String(vb));
        if (typeof na === "number" && typeof nb === "number") return (na - nb) * dir;
        return String(na).localeCompare(String(nb)) * dir;
      });
    }
    const total = notes.length;
    const pageCount = Math.max(1, Math.ceil(total / TABLE.pageSize));
    if (TABLE.page > pageCount) TABLE.page = pageCount;
    if (TABLE.page < 1) TABLE.page = 1;
    const start = (TABLE.page - 1) * TABLE.pageSize;
    const pageRows = notes.slice(start, start + TABLE.pageSize);

    tbody.innerHTML = pageRows.map(n => "<tr>" + cols.map(c => cellHtml(n, c, FZ)).join("") + "</tr>").join("");

    document.getElementById("tableFoot").innerHTML =
      `<span>鍏?<b>${total}</b> 绡?路 鏄剧ず ${total === 0 ? 0 : start + 1}-${Math.min(start + TABLE.pageSize, total)} 路 ${cols.length} 鍒?/span>
       <span class="pager">
         <button class="pg-btn" data-pg="first" ${TABLE.page === 1 ? "disabled" : ""}>芦</button>
         <button class="pg-btn" data-pg="prev" ${TABLE.page === 1 ? "disabled" : ""}>鈥?/button>
         <span class="pg-cur">${TABLE.page} / ${pageCount}</span>
         <button class="pg-btn" data-pg="next" ${TABLE.page >= pageCount ? "disabled" : ""}>鈥?/button>
         <button class="pg-btn" data-pg="last" ${TABLE.page >= pageCount ? "disabled" : ""}>禄</button>
         <select class="pg-size" id="pgSize">
           <option value="20" ${TABLE.pageSize === 20 ? "selected" : ""}>20 琛?椤?/option>
           <option value="30" ${TABLE.pageSize === 30 ? "selected" : ""}>30 琛?椤?/option>
           <option value="50" ${TABLE.pageSize === 50 ? "selected" : ""}>50 琛?椤?/option>
           <option value="100" ${TABLE.pageSize === 100 ? "selected" : ""}>100 琛?椤?/option>
         </select>
       </span>`;
    document.querySelectorAll("#tableFoot .pg-btn").forEach(b => {
      b.addEventListener("click", () => {
        const act = b.dataset.pg;
        if (act === "first") TABLE.page = 1;
        else if (act === "prev") TABLE.page = Math.max(1, TABLE.page - 1);
        else if (act === "next") TABLE.page = Math.min(pageCount, TABLE.page + 1);
        else if (act === "last") TABLE.page = pageCount;
        renderTable();
        const w = document.querySelector(".table-wrap");
        if (w) w.scrollTop = 0;
      });
    });
    const pgSize = document.getElementById("pgSize");
    if (pgSize) pgSize.addEventListener("change", e => {
      TABLE.pageSize = parseInt(e.target.value, 10);
      TABLE.page = 1;
      renderTable();
    });

    thead.querySelectorAll("th").forEach(th => {
      const key = th.dataset.key;
      th.addEventListener("click", () => {
        if (TABLE.sortKey === key) {
          TABLE.sortDir = TABLE.sortDir === "desc" ? "asc" : "desc";
        } else {
          TABLE.sortKey = key;
          TABLE.sortDir = "desc";
        }
        TABLE.page = 1;
        renderTable();
      });
      th.addEventListener("mouseenter", e => showTip(e, TABLE.byKey[key]));
      th.addEventListener("mouseleave", hideTip);
    });
  }

  function cellHtml(n, c, FZ) {
    const fz = FZ && FZ.map[c.key];
    const fzCls = fz ? " frozen-col" + (c.key === FZ.lastKey ? " last-frozen" : "") : "";
    const fzStyle = fz ? ` style="left:${fz.left}px;min-width:${fz.width}px;max-width:${fz.width}px"` : "";

    const tableMiss = isColMissing(c);
    if (tableMiss) return `<td class="col-missing${fzCls}"${fzStyle} title="${tableMiss}">鈥?/td>`;

    const src = c.source || "";
    const rm = (tip) => `<td class="row-missing${fzCls}"${fzStyle} title="${tip}">鈥?/td>`;
    if (src === "钂插叕鑻? && !n.in_pgy) return rm("璇ョ瑪璁颁笉鍦ㄨ挷鍏嫳鍚堜綔鎶ュ鍚嶅崟");
    if (src === "鏄熸渤" && !n.in_star) return rm("璇ョ瑪璁版棤鏄熸渤杞寲鏁版嵁");
    if (src === "钖潯" && !n.in_chili) return rm("璇ョ瑪璁版湭鎶曡柉鏉?);
    if (src === "鐏电妧" && !n.in_lx) return rm("璇ョ瑪璁颁笉鍦ㄧ伒鐘€绉嶈崏璐＄尞姒滃崟");

    let v = n[c.key];
    const tier = (n.tiers || {})[c.key];
    let cls = "";
    if (tier === "good") cls = "num-good";
    else if (tier === "warn") cls = "num-warn";
    else if (tier === "na") cls = "num-na";
    const kw = TABLE.keyword;
    if (c.key === "note_id") {
      return `<td class="mono-id${fzCls}"${fzStyle} title="${v || ''}">${highlight(v, kw)}</td>`;
    }
    if (c.key === "creator" || c.key === "title") {
      return `<td class="${fzCls.trim()}"${fzStyle}>${highlight(v, kw)}</td>`;
    }
    return `<td class="${fzCls.trim()}"${fzStyle}><span class="${cls}">${fmt.val(v, c)}</span></td>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function highlight(text, kw) {
    const t = String(text == null || text === "" ? "鈥? : text);
    if (!kw) return escapeHtml(t);
    const terms = kw.split(/\s+/).filter(Boolean).map(s => s.toLowerCase());
    if (!terms.length) return escapeHtml(t);
    const lower = t.toLowerCase();
    const marks = [];
    for (const term of terms) {
      let from = 0, idx;
      while ((idx = lower.indexOf(term, from)) >= 0) {
        marks.push([idx, idx + term.length]);
        from = idx + term.length;
      }
    }
    if (!marks.length) return escapeHtml(t);
    marks.sort((a, b) => a[0] - b[0]);
    const merged = [marks[0].slice()];
    for (let i = 1; i < marks.length; i++) {
      const last = merged[merged.length - 1];
      if (marks[i][0] <= last[1]) last[1] = Math.max(last[1], marks[i][1]);
      else merged.push(marks[i].slice());
    }
    let out = "", pos = 0;
    for (const [s, e] of merged) {
      out += escapeHtml(t.slice(pos, s)) + '<mark class="hl">' + escapeHtml(t.slice(s, e)) + "</mark>";
      pos = e;
    }
    out += escapeHtml(t.slice(pos));
    return out;
  }

  // ---------- 鎮仠 tip ----------
  const tipEl = () => document.getElementById("tipCard");
  let tipTimer = null;
  function showTip(e, col) {
    if (!col) return;
    clearTimeout(tipTimer);
    const target = e.currentTarget;
    tipTimer = setTimeout(() => {
      const t = tipEl();
      document.getElementById("tipTitle").textContent = col.label;
      document.getElementById("tipSub").textContent = "鍒嗙粍锛? + (col.groupLabel || "") + " 路 鏉ユ簮锛? + (col.source || "鈥?) + (col.unit ? " 路 鍗曚綅锛? + col.unit : "") + (col.derived ? " 路 娲剧敓瀛楁" : "");
      document.getElementById("tipFormula").textContent = col.formula || "鈥?;
      document.getElementById("tipMeaning").textContent = col.meaning || "鈥?;
      t.hidden = false;
      const rect = target.getBoundingClientRect();
      const tw = 320;
      let x = rect.left;
      if (x + tw > window.innerWidth - 20) x = window.innerWidth - tw - 20;
      const y = rect.bottom + 6;
      t.style.left = x + "px";
      t.style.top = y + "px";
    }, 300);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipEl().hidden = true;
  }

  // ---------- 鑷畾涔夊垪寮圭獥 ----------
  const MODAL = { draft: [], keyword: "" };
  function openModal() {
    MODAL.draft = TABLE.selected.slice();
    MODAL.keyword = "";
    document.getElementById("colSearch").value = "";
    renderModal();
    document.getElementById("customModal").hidden = false;
  }
  function closeModal() { document.getElementById("customModal").hidden = true; }
  function renderModal() {
    const kw = MODAL.keyword.toLowerCase();
    const avail = document.getElementById("availList");
    const sel = document.getElementById("selectedList");

    avail.innerHTML = "";
    let availCount = 0;
    for (const g of TABLE.groups) {
      const items = g.columns.filter(c => {
        if (!kw) return true;
        return c.label.toLowerCase().includes(kw) || c.key.toLowerCase().includes(kw);
      });
      if (!items.length) continue;
      availCount += items.length;
      const groupHtml = items.map(c => {
        const inSel = MODAL.draft.includes(c.key);
        const locked = TABLE.fixed.includes(c.key);
        const cls = locked ? "disabled" : (inSel ? "selected" : "");
        const derCls = c.derived ? " col-derived" : "";
        return `<div class="col-item ${cls}${derCls}" data-key="${c.key}">
          <span class="cb"></span>
          <span>${c.label}</span>
        </div>`;
      }).join("");
      avail.insertAdjacentHTML("beforeend",
        `<div class="col-group">
          <div class="col-group-head">${g.label} <span class="cnt">${items.length}</span></div>
          <div class="col-group-items">${groupHtml}</div>
        </div>`);
    }
    document.getElementById("availCount").textContent = availCount;

    sel.innerHTML = MODAL.draft.map((k, i) => {
      const c = TABLE.byKey[k];
      if (!c) return "";
      const locked = TABLE.fixed.includes(k);
      const derCls = c.derived ? " col-derived" : "";
      const showSep = i === TABLE.fixed.length && MODAL.draft.length > TABLE.fixed.length;
      const sepHtml = i === TABLE.fixed.length && MODAL.draft.length > TABLE.fixed.length
        ? '<div class="sep">鈥?浠ヤ笂涓哄浐瀹氬垪 鈥?/div>' : "";
      return `${sepHtml}<div class="col-item ${locked ? "locked" : ""}${derCls}" data-key="${k}" draggable="${!locked}">
        ${locked ? '<span class="lock">馃敀</span>' : '<span class="drag-handle">鈰嫯</span>'}
        <span>${c.label}</span>
        ${locked ? "" : `<span class="remove-x" data-remove="${k}">脳</span>`}
      </div>`;
    }).join("");
    document.getElementById("selCount").textContent = MODAL.draft.length;

    avail.querySelectorAll(".col-item").forEach(el => {
      el.addEventListener("click", () => {
        const k = el.dataset.key;
        if (TABLE.fixed.includes(k)) return;
        const idx = MODAL.draft.indexOf(k);
        if (idx >= 0) MODAL.draft.splice(idx, 1);
        else MODAL.draft.push(k);
        renderModal();
      });
    });
    sel.querySelectorAll("[data-remove]").forEach(el => {
      el.addEventListener("click", e => {
        e.stopPropagation();
        const k = el.dataset.remove;
        const idx = MODAL.draft.indexOf(k);
        if (idx >= 0) MODAL.draft.splice(idx, 1);
        renderModal();
      });
    });
    let dragKey = null;
    sel.querySelectorAll(".col-item[draggable='true']").forEach(el => {
      el.addEventListener("dragstart", () => { dragKey = el.dataset.key; el.style.opacity = ".4"; });
      el.addEventListener("dragend", () => { el.style.opacity = "1"; dragKey = null; });
      el.addEventListener("dragover", e => e.preventDefault());
      el.addEventListener("drop", e => {
        e.preventDefault();
        const dropKey = el.dataset.key;
        if (!dragKey || dragKey === dropKey || TABLE.fixed.includes(dropKey)) return;
        const from = MODAL.draft.indexOf(dragKey);
        const to = MODAL.draft.indexOf(dropKey);
        if (from < 0 || to < 0) return;
        MODAL.draft.splice(from, 1);
        MODAL.draft.splice(to, 0, dragKey);
        renderModal();
      });
    });
  }

  function bindModal() {
    document.getElementById("btnCustom").addEventListener("click", openModal);
    document.getElementById("modalClose").addEventListener("click", closeModal);
    document.getElementById("modalCancel").addEventListener("click", closeModal);
    document.getElementById("modalConfirm").addEventListener("click", () => {
      TABLE.selected = MODAL.draft.slice();
      ensureFixedFirst();
      safeSaveSel();
      renderTable();
      closeModal();
    });
    document.getElementById("clearSel").addEventListener("click", () => {
      MODAL.draft = TABLE.fixed.slice();
      renderModal();
    });
    document.getElementById("colSearch").addEventListener("input", e => {
      MODAL.keyword = e.target.value;
      renderModal();
    });
    document.getElementById("customModal").addEventListener("click", e => {
      if (e.target.id === "customModal") closeModal();
    });
  }

  // ---------- 琛ㄦ牸鎼滅储锛坈ombo + 鍏抽敭璇嶈繃婊わ級 ----------
  let tableCombo = null;

  function initTableCombo() {
    tableCombo = makeCombo({
      inputId: "tableSearch", listId: "tableList",
      candidates: DATA.notes,
      filterKeys: ["note_id", "creator"],
      moduleKey: "table",
      emptyPlaceholder: "锛堟棤鏁版嵁锛?,
      onSelect: function (noteId) {
        TABLE.keyword = noteId;
        TABLE.page = 1;
        renderTable();
      },
    });
    // 棰濆鐩戝惉锛氱敤鎴锋墦瀛椾絾涓嶉€変笅鎷夐」鏃讹紝瀹炴椂鍏抽敭璇嶈繃婊よ〃鏍?    const el = document.getElementById("tableSearch");
    let t = null;
    el.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (tableCombo && tableCombo.currentId && el.value.indexOf(tableCombo.currentId) >= 0) return;
        TABLE.keyword = el.value.trim();
        TABLE.page = 1;
        renderTable();
      }, 200);
    });
  }

  // ---------- 鑱斿姩澶嶉€夋缁戝畾锛堥粯璁ゅ嬀閫夛紝寮€绠卞嵆鐢級 ----------
  function bindLinks() {
    var cb1 = document.getElementById("chkLink1");
    var cb2 = document.getElementById("chkLink2");
    var cb3 = document.getElementById("chkLink3");

    // 鍒濆鍖栵細DOM 鍕鹃€夌姸鎬?= STATE 榛樿鍊?    cb1.checked = STATE.links.trend;
    cb2.checked = STATE.links.cost;
    cb3.checked = STATE.links.table;

    cb1.addEventListener("change", function () {
      STATE.links.trend = this.checked;
    });
    cb2.addEventListener("change", function () {
      STATE.links.cost = this.checked;
    });
    cb3.addEventListener("change", function () {
      STATE.links.table = this.checked;
    });
  }

  // ---------- 鍥捐〃涓€ 路 鏃ョ淮搴﹁繘搴楄秼鍔?----------
  const DAILY_RED_PALETTE = [
    "#FF2442","#FF3B57","#FF526B","#FF6980",
    "#FF8194","#FF98A8","#FFAFBD","#FFC6D1",
    "#FFD1D8","#FFE0E5"
  ];
  const DAILY_REST_COLOR = "#D1D5DB";
  let dailyOverviewChart = null;
  let DAILY_SELECTED_DATE = null;

  function colorForRank(rank) {
    return DAILY_RED_PALETTE[rank - 1] || DAILY_REST_COLOR;
  }

  function renderDailyOverview() {
    var dailyNotes = DATA.daily_notes || {};
    var trendsAll = DATA.trends_all || [];
    if (!trendsAll.length) {
      document.getElementById("dailyOverviewChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">鏄熸渤琛ㄦ湭鍔犺浇锛屾棤娉曞睍绀烘棩缁村害鏁版嵁</div>';
      return;
    }

    // KPI cards
    var totalVisit = 0, totalCart = 0, totalDeal = 0, totalNotes = new Set();
    trendsAll.forEach(function(r){ totalVisit += r[1]||0; totalCart += r[2]||0; totalDeal += r[3]||0; });
    Object.keys(dailyNotes).forEach(function(d){ (dailyNotes[d]||[]).forEach(function(n){ totalNotes.add(n.note_id); }); });
    var kpis = [
      { l: "鎬昏繘搴桿V", v: fmt.int(totalVisit), u: "" },
      { l: "鎬诲姞璐璘V", v: fmt.int(totalCart), u: "" },
      { l: "鎬绘垚浜V", v: fmt.int(totalDeal), u: "" },
      { l: "鏈夋暟鎹瑪璁?, v: fmt.int(totalNotes.size), u: "绡? },
      { l: "", v: "馃搳 鏃ョ淮搴﹁仛鍚?, u: "" },
    ];
    document.getElementById("dailyOverviewKpis").innerHTML = kpis.map(function(k){
      return '<div class="trend-kpi"><div class="trend-kpi-label">'+k.l+'</div><div class="trend-kpi-val">'+k.v+'<span class="u"> '+k.u+'</span></div></div>';
    }).join("");

    // Build per-date stacked data
    var dates = trendsAll.map(function(r){ return fmtDate(r[0]); });
    var dateInts = trendsAll.map(function(r){ return r[0]; });
    var nDates = dateInts.length;

    // 11 series: rank1..rank10 + rest
    var rankSeries = [];
    var rankNotes = []; // rankNotes[dateIdx][rank-1] = note object or null
    for (var ri = 0; ri < 10; ri++) {
      rankSeries.push(new Array(nDates).fill(null));
      rankNotes.push(new Array(nDates).fill(null));
    }
    var restSeries = new Array(nDates).fill(null);

    dateInts.forEach(function(dInt, di){
      var notes = (dailyNotes[dInt] || []).slice();
      notes.sort(function(a,b){ return (b.visit_uv||0) - (a.visit_uv||0); });
      for (var i = 0; i < Math.min(notes.length, 10); i++) {
        rankSeries[i][di] = notes[i].visit_uv;
        rankNotes[i][di] = notes[i];
      }
      if (notes.length > 10) {
        var restSum = 0;
        for (var j = 10; j < notes.length; j++) restSum += notes[j].visit_uv || 0;
        restSeries[di] = restSum > 0 ? restSum : null;
      }
    });

    // Build ECharts series (bar only, no lines)
    var barSeries = [];
    for (var ri = 0; ri < 10; ri++) {
      barSeries.push({
        name: "Top" + (ri + 1),
        type: "bar", stack: "daily", yAxisIndex: 0,
        data: rankSeries[ri],
        color: colorForRank(ri + 1),
        barMaxWidth: 44,
        emphasis: { focus: "series" },
        itemStyle: { borderWidth: 0 },
      });
    }
    barSeries.push({
      name: "鍏朵綑绗旇", type: "bar", stack: "daily", yAxisIndex: 0,
      data: restSeries, color: DAILY_REST_COLOR,
      barMaxWidth: 44,
      emphasis: { focus: "series" },
      itemStyle: { borderWidth: 0 },
    });

    // Daily total visit_uv as invisible bar for top label
    var dailyTotalData = trendsAll.map(function(r){ return r[1]; });
    barSeries.push({
      name: "鏃ユ€昏锛堟爣绛撅級", type: "bar", stack: "daily", yAxisIndex: 0,
      data: new Array(nDates).fill(null),
      label: {
        show: true,
        position: "top",
        fontSize: 11,
        fontWeight: 700,
        color: "#FF2442",
        formatter: function(p) {
          var idx = p.dataIndex;
          return idx >= 0 && idx < nDates ? fmt.int(dailyTotalData[idx]) : "";
        },
      },
      color: "transparent",
      barMaxWidth: 44,
      silent: true,
      tooltip: { show: false },
      itemStyle: { borderWidth: 0 },
    });

    var chartDom = document.getElementById("dailyOverviewChart");
    if (!dailyOverviewChart) dailyOverviewChart = echarts.init(chartDom);
    dailyOverviewChart.off("click");

    dailyOverviewChart.setOption({
      backgroundColor: "transparent",
      graphic: [
        {
          type: "text",
          left: 56,
          top: 5,
          style: {
            text: "进店汇总  " + fmt.int(totalVisit),
            fill: "#FF2442",
            font: "bold 13px system-ui, -apple-system, sans-serif",
          },
          z: 100,
        },
      ],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "#fff",
        borderColor: C.border,
        textStyle: { color: C.text, fontSize: 12 },
        extraCssText: "max-width:380px;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.10);z-index:200",
        formatter: function(params) {
          var dateIdx = params[0].dataIndex;
          var dInt = dateInts[dateIdx];
          var notes = (dailyNotes[dInt] || []).slice();
          notes.sort(function(a,b){ return (b.visit_uv||0) - (a.visit_uv||0); });
          var dateLabel = fmtDate(dInt);

          var dSummary = trendsAll[dateIdx];
          var tv = dSummary ? fmt.int(dSummary[1]) : "鈥?;
          var tc = dSummary ? fmt.int(dSummary[2]) : "鈥?;
          var td = dSummary ? fmt.int(dSummary[3]) : "鈥?;

          var html = '<div style="font-weight:700;margin-bottom:6px;font-size:12px">馃搮 ' + dateLabel + '</div>';
          html += '<table style="border-spacing:0 1px;font-size:11px;width:100%">';
          // summary row
          var T = 'text-align:right;font-weight:600;width:58px';
          html += '<tr><td style="width:16px"></td><td style="color:#6B7280;padding-bottom:4px">鎬昏</td>';
          html += '<td style="' + T + ';color:#FF2442">' + tv + '</td>';
          html += '<td style="' + T + ';color:#F97316">' + tc + '</td>';
          html += '<td style="' + T + ';color:#EAB308">' + td + '</td></tr>';

          if (!notes.length) { html += '</table>'; return html; }

          var showCount = notes.length <= 8 ? notes.length : 5;
          html += '<tr><td colspan="5" style="padding:2px 0"><div style="border-top:1px dashed #E5E7EB"></div></td></tr>';
          for (var i = 0; i < showCount; i++) {
            var n = notes[i];
            var rank = i + 1;
            var clr = rank <= 10 ? colorForRank(rank) : DAILY_REST_COLOR;
            var vv = fmt.int(n.visit_uv), cv = fmt.int(n.cart_uv), dv = fmt.int(n.deal_uv);
            html += '<tr>';
            html += '<td style="width:16px"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + clr + ';vertical-align:middle"></span></td>';
            html += '<td style="font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px" title="' + escapeHtml(n.creator || '') + '">' + escapeHtml(n.creator || '鈥?) + '</td>';
            html += '<td style="' + T + ';color:#FF2442">' + vv + '</td>';
            html += '<td style="' + T + ';color:#F97316">' + cv + '</td>';
            html += '<td style="' + T + ';color:#EAB308">' + dv + '</td>';
            html += '</tr>';
          }
          if (notes.length > showCount) {
            var restTotal = 0, restCart = 0, restDeal = 0;
            for (var j = showCount; j < notes.length; j++) {
              restTotal += notes[j].visit_uv || 0;
              restCart += notes[j].cart_uv || 0;
              restDeal += notes[j].deal_uv || 0;
            }
            html += '<tr><td style="width:16px"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + DAILY_REST_COLOR + ';vertical-align:middle"></span></td>';
            html += '<td style="color:#9CA3AF;font-size:10px">绛?' + (notes.length - showCount) + ' 绡?/td>';
            html += '<td style="text-align:right;color:#9CA3AF;font-size:10px">' + fmt.int(restTotal) + '</td>';
            html += '<td style="text-align:right;color:#9CA3AF;font-size:10px">' + fmt.int(restCart) + '</td>';
            html += '<td style="text-align:right;color:#9CA3AF;font-size:10px">' + fmt.int(restDeal) + '</td></tr>';
          }
          html += '</table>';
          html += '<div style="margin-top:4px;font-size:10px;color:#9CA3AF;text-align:center">馃挕 鐐瑰嚮鏌卞瓙灞曞紑鍏ㄩ儴绗旇鏄庣粏</div>';
          return html;
        },
      },
      legend: { show: false },
      grid: { top: 28, left: 56, right: 20, bottom: 40 },
      xAxis: {
        type: "category", data: dates,
        axisLine: { lineStyle: { color: C.border } },
        axisLabel: { fontSize: 11, color: C.muted, rotate: dates.length > 40 ? 45 : 0 },
      },
      yAxis: {
        type: "value", name: "UV", position: "left",
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.muted, fontSize: 11 }, nameTextStyle: { color: C.dim },
      },
      series: barSeries,
    });

    dailyOverviewChart.on("click", function(params) {
      if (params.componentType === "series" && params.seriesType === "bar") {
        var di = params.dataIndex;
        if (di != null && di >= 0 && di < dateInts.length) {
          DAILY_SELECTED_DATE = dateInts[di];
          expandDailyNotes(DAILY_SELECTED_DATE);
        }
      }
    });

    // Close panel if previously open
    document.getElementById("dailyDetailPanel").hidden = true;
  }

  function expandDailyNotes(dateInt) {
    var dailyNotes = DATA.daily_notes || {};
    var notes = (dailyNotes[dateInt] || []).slice();
    notes.sort(function(a,b){ return (b.visit_uv||0) - (a.visit_uv||0); });
    var panel = document.getElementById("dailyDetailPanel");
    var title = document.getElementById("dailyDetailTitle");
    var thead = document.getElementById("dailyDetailHead");
    var tbody = document.getElementById("dailyDetailBody");

    title.textContent = fmtDate(dateInt) + " 绗旇鏄庣粏锛堝叡 " + notes.length + " 绡囷級";
    thead.innerHTML = '<tr><th style="width:40px">#</th><th>杈句汉</th><th>绗旇ID</th><th>杩涘簵UV</th><th>鍔犺喘UV</th><th>鎴愪氦UV</th></tr>';

    tbody.innerHTML = notes.map(function(n, i){
      var rank = i + 1;
      var clr = rank <= 10 ? colorForRank(rank) : DAILY_REST_COLOR;
      return '<tr class="daily-detail-row-note" data-nid="' + escapeHtml(n.note_id) + '">' +
        '<td><span class="daily-rank-badge" style="background:' + clr + ';color:#fff">' + rank + '</span></td>' +
        '<td>' + escapeHtml(n.creator || "鈥?) + '</td>' +
        '<td class="mono-id">' + escapeHtml(n.note_id) + '</td>' +
        '<td>' + fmt.int(n.visit_uv) + '</td>' +
        '<td>' + fmt.int(n.cart_uv) + '</td>' +
        '<td>' + fmt.int(n.deal_uv) + '</td></tr>';
    }).join("");

    // Click note row 鈫?link to chart 2 (single note trend)
    tbody.querySelectorAll(".daily-detail-row-note").forEach(function(tr){
      tr.addEventListener("click", function(){
        var nid = tr.dataset.nid;
        STATE.currentNote = nid;
        // Force chart 2 (single note trend) to select the note
        if (trendCombo && trendCombo.selectById) trendCombo.selectById(nid);
        if (costCombo && costCombo.selectById) costCombo.selectById(nid);
        if (tableCombo && tableCombo.selectById) tableCombo.selectById(nid);
        // Scroll to chart 2
        var el = document.getElementById("modTrend");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.getElementById("dailyDetailClose").addEventListener("click", function(){
    document.getElementById("dailyDetailPanel").hidden = true;
  });

  // ---------- 鍏ㄥ眬鍝嶅簲 ----------
  window.addEventListener("resize", () => {
    if (trendChart) trendChart.resize();
    if (costChart) costChart.resize();
    if (dailyOverviewChart) dailyOverviewChart.resize();
  });

  // ===== boot =====
  bindLinks();
  renderMeta();
  renderKpis();
  renderSources();
  initTableCols();
  initQueryPanel();
  renderTable();
  bindModal();
  initTableCombo();
  renderDailyOverview();
  renderTrendModule();
  renderCostModule();
})();
