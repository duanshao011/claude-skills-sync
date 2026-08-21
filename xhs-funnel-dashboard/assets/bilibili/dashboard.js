/* B站投放数据看板 · 前端渲染
   图表一 · 单篇趋势分析（架构与投放看板单篇趋势模块一致，B站品牌粉蓝配色）
*/
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("dashPayload").textContent);
  const C = {
    text: "#111827", muted: "#6B7280", dim: "#9CA3AF", border: "#E5E7EB",
    grid: "#F3F4F6", panel: "#FFFFFF", brand: "#FB7299",
  };

  function updateToggleCards(containerId, valMap) {
    document.querySelectorAll("#" + containerId + " .metric-toggle-card").forEach(function(btn){
      var m = btn.dataset.metric;
      var el = btn.querySelector("[data-slot=val]");
      if (el && valMap[m] != null) el.textContent = valMap[m];
    });
  }

  // ---------- 格式化 ----------
  const fmt = {
    int(v) { return v == null ? "—" : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 }); },
    ratio(v, d = 2) { return v == null ? "—" : (Number(v) * 100).toFixed(d) + "%"; },
    money(v) { return v == null ? "—" : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // ===== 通用 Combobox =====
  function makeCombo(cfg) {
    /* cfg: { inputId, listId, candidates, onSelect, placeholder, filterKeys } */
    const self = { currentId: null, keyword: "", hi: 0, selectById: null, clear: null };
    const inp = document.getElementById(cfg.inputId);
    const list = document.getElementById(cfg.listId);

    // × 清除按钮：插到 input 后面，绝对定位
    const clearBtn = document.createElement("span");
    clearBtn.className = "combo-clear";
    clearBtn.innerHTML = "×";
    clearBtn.title = "一键清除";
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
      if (!d) return "—";
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
        list.innerHTML = '<li class="combo-empty">无匹配内容</li>';
        return;
      }
      // 下拉选项保持规范统一：日期 | 内容ID | 达人，不加任何状态标注（无数据提示在选中后的详情页占位展示）
      list.innerHTML = items.map((n, i) =>
        `<li class="combo-item ${i === self.hi ? "hi" : ""}" data-id="${n.note_id}">
          <span class="combo-line"><span class="pub-date">${fmtPubDate(n.pub_date)}</span><span class="sep">|</span><span class="id">${n.note_id}</span><span class="sep">|</span><span class="creator">${escapeHtml(n.creator || "—")}</span></span>
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
      if (!n) n = DATA.notes.find(x => x.note_id === self.currentId);
      if (n) {
        inp.value = `${fmtPubDate(n.pub_date)} | ${n.note_id} | ${n.creator || "—"}`;
        inp.classList.add("has-value");
      }
    }

    function select(noteId) {
      self.currentId = noteId;
      list.hidden = true;
      restoreInputDisplay();
      _updateClear();
      if (cfg.onSelect) cfg.onSelect(noteId);
    }

    self.selectById = function (noteId) {
      self.currentId = noteId;
      restoreInputDisplay();
      _updateClear();
      list.hidden = true;
      if (cfg.onSelect) cfg.onSelect(noteId);
    };

    inp.addEventListener("focus", () => {
      self.hi = 0; renderList(); list.hidden = false;
      // 选中全文方便复制或直接输入覆盖，不清空
      inp.select();
    });
    inp.addEventListener("input", () => {
      self.keyword = inp.value.trim().toLowerCase();
      self.hi = 0; renderList(); list.hidden = false;
      _updateClear();
      // If user deleted text and had a note selected, reset to all-notes
      if (!inp.value.trim() && self.currentId) {
        self.currentId = null;
        inp.classList.remove("has-value", "linked-outside");
        if (cfg.onClear) cfg.onClear();
      }
    });
    inp.addEventListener("keydown", e => {
      const items = getFiltered();
      if (e.key === "ArrowDown") { e.preventDefault(); self.hi = Math.min(items.length - 1, self.hi + 1); renderList(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); self.hi = Math.max(0, self.hi - 1); renderList(true); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[self.hi]) select(items[self.hi].note_id); }
      else if (e.key === "Escape") { list.hidden = true; if (self.currentId) restoreInputDisplay(); }
    });
    // Blur: if user cleared input then clicked away, reset to all-notes
    inp.addEventListener("blur", () => {
      if (!inp.value.trim() && self.currentId) {
        self.currentId = null;
        inp.classList.remove("has-value", "linked-outside");
        if (cfg.onClear) cfg.onClear();
      }
    });
    document.addEventListener("click", function (ev) {
      if (!ev.target.closest("#" + cfg.inputId) && !ev.target.closest("#" + cfg.listId)) {
        list.hidden = true;
        if (self.currentId) restoreInputDisplay();
      }
    });

    // 无候选人时禁用
    if (!cfg.candidates || !cfg.candidates.length) {
      inp.placeholder = cfg.emptyPlaceholder || "（无数据）";
      inp.disabled = true;
    }
    return self;
  }

  // ===== 顶部 meta =====
  function renderMeta() {
    const m = DATA.meta;
    document.getElementById("metaPeriod").textContent = "数据周期：" + (m.period || "—");
    document.getElementById("metaFlow").textContent =
      "口径：" + (m.flow_type || "全部流量") + " / 归因 " + (m.attr_period || 15) + " 天";
    document.getElementById("metaGen").textContent = "生成于 " + m.generated;
    document.getElementById("footAlign").textContent = "数据来源于 B站 商家后台内容营销导出";
  }

  // ===== KPI 顶部（B站表无投放消耗字段，不做投入/ROI） =====
  function renderKpis() {
    const s = DATA.summary;
    const m = DATA.meta || {};
    const kpi = [
      { l: "总播放UV", v: fmt.int(s.total_play), u: "", sub: "全部内容 · 播放口径", range: m.period, rangeTip: "数据周期" },
      { l: "总进店UV", v: fmt.int(s.total_visit), u: "", sub: "播放 → 进店" },
      { l: "总成交UV", v: fmt.int(s.total_deal), u: "", sub: "进店 → 成交" },
      { l: '总 GMV <span class="gmv-approx" data-tip="B站按内容维度统计GMV，同一笔订单如果有多条内容共同贡献，该订单GMV会被重复计入每条内容，因此加总后的GMV高于实际成交额。">≈ 参考值</span>', v: fmt.money(s.total_gmv), u: "元", sub: "⚠ 多内容归因存在重复计算", approx: true },
    ];
    document.getElementById("kpiRow").innerHTML = kpi.map(k =>
      `<div class="kpi${k.approx ? " kpi-approx" : ""}">
        <div class="kpi-label">${k.l}${k.range ? `<span class="kpi-range" title="${k.rangeTip || ""}">${k.range}</span>` : ""}</div>
        <div class="kpi-val">${k.v}<span class="kpi-unit">${k.u}</span></div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ""}
      </div>`
    ).join("");
  }

  // ===== 数据源状态条 =====
  function renderSources() {
    const src = DATA.meta.sources || {};
    const s = src.bilibili || { name: "B站", loaded: false, rows: 0 };
    const ok = s.loaded;
    const path = (s.path || "").split(/[\\/]/).pop() || "";
    const countTxt = ok ? fmt.int(s.rows) + " 条" : "未上传";
    const period = ok && s.period ? `<span class="src-period">📅 ${s.period}</span>` : "";
    const card = `<div class="src-card">
      <div class="src-badge ${ok ? "ok" : "miss"}">${ok ? "✓" : "—"}</div>
      <div class="src-info">
        <div class="src-name">${s.name} <span class="src-count ${ok ? "" : "miss"}">${countTxt}</span></div>
        <div class="src-desc">${ok ? path : (s.reason || "缺失该表，无法绘制趋势")}</div>
        ${period}
      </div>
    </div>`;
    document.getElementById("sourceStrip").innerHTML = card;
  }

  // ===== 单篇趋势分析 =====
  let trendChart = null, trendCombo = null;

  function fmtDate(d) {
    if (d == null) return "—";
    const s = String(d);
    return s.length === 8 ? s.slice(4, 6) + "/" + s.slice(6, 8) : s;
  }

  // UV日均虚线：标签放在最右端外侧，避免和折线重叠
  function buildAvgMarkLine(color, label) {
    return {
      symbol: "none",
      silent: true,
      precision: 0,
      lineStyle: { color: color, type: "dashed", width: 1.5, opacity: 0.6 },
      label: {
        formatter: function(p){ return (label || "日均") + " " + Math.round(p.value); },
        position: "insideEndBottom",
        fontSize: 10,
        fontWeight: 600,
        color: "#111827",
        backgroundColor: "rgba(255,255,255,0.92)",
        padding: [2, 6],
        borderRadius: 3,
        distance: 4,
      },
      data: [{ type: "average" }],
    };
  }

  function buildInsideZoom() {
    return [{
      type: "inside",
      start: 0,
      end: 100,
      zoomOnMouseWheel: "shift",
      moveOnMouseMove: true,
      moveOnMouseWheel: false,
      throttle: 40,
    }];
  }

  const CHART_PAN_STATES = new WeakMap();

  function hideChartPanHint(hintId) {
    const hint = document.getElementById(hintId);
    if (!hint) return;
    hint.dataset.dismissed = "true";
    hint.classList.remove("is-visible");
  }

  function resetChartPan(chart) {
    if (!chart || !chart.dispatchAction) return;
    chart.dispatchAction({ type: "dataZoom", dataZoomIndex: 0, start: 0, end: 100 });
  }

  function bindChartPanInteractions(chart, hintId) {
    if (!chart || !chart.getDom) return;
    const dom = chart.getDom();
    let state = CHART_PAN_STATES.get(dom);
    if (state) {
      state.chart = chart;
      state.hintId = hintId;
      resetChartPan(chart);
      return;
    }

    state = {
      chart: chart,
      hintId: hintId,
      pointerDown: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      dragged: false,
      suppressClickUntil: 0,
      lastTouchTap: 0,
      clickTimer: null,
    };
    CHART_PAN_STATES.set(dom, state);

    const hint = document.getElementById(hintId);
    if (hint) hint.dataset.enabled = "true";

    dom.addEventListener("wheel", function (event) {
      if (event.shiftKey) {
        hideChartPanHint(state.hintId);
        return;
      }
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const lineScale = event.deltaMode === 1 ? 16 : 1;
      const scrollX = event.deltaMode === 2 ? event.deltaX * window.innerWidth : event.deltaX * lineScale;
      const scrollY = event.deltaMode === 2 ? event.deltaY * window.innerHeight : event.deltaY * lineScale;
      window.scrollBy({ left: scrollX, top: scrollY, behavior: "auto" });
    }, { passive: false, capture: true });

    dom.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      state.pointerDown = true;
      state.pointerId = event.pointerId;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.dragged = false;
      hideChartPanHint(state.hintId);
    });

    dom.addEventListener("pointermove", function (event) {
      if (!state.pointerDown || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 6) state.dragged = true;
    });

    function finishPointer(event) {
      if (!state.pointerDown || event.pointerId !== state.pointerId) return;
      state.pointerDown = false;
      if (state.dragged) state.suppressClickUntil = Date.now() + 260;
      if (event.pointerType === "touch" && !state.dragged) {
        const now = Date.now();
        if (now - state.lastTouchTap <= 320) {
          state.lastTouchTap = 0;
          state.suppressClickUntil = now + 360;
          clearTimeout(state.clickTimer);
          resetChartPan(state.chart);
        } else {
          state.lastTouchTap = now;
        }
      }
      state.pointerId = null;
    }

    dom.addEventListener("pointerup", finishPointer);
    dom.addEventListener("pointercancel", finishPointer);
    dom.addEventListener("dblclick", function () {
      clearTimeout(state.clickTimer);
      state.suppressClickUntil = Date.now() + 320;
      hideChartPanHint(state.hintId);
      resetChartPan(state.chart);
    });

    resetChartPan(chart);
  }

  function runConfirmedChartClick(chart, callback) {
    if (!chart || !chart.getDom) return callback();
    const state = CHART_PAN_STATES.get(chart.getDom());
    if (!state) return callback();
    if (Date.now() < state.suppressClickUntil || state.dragged) return;
    clearTimeout(state.clickTimer);
    state.clickTimer = setTimeout(function () {
      if (Date.now() >= state.suppressClickUntil) callback();
    }, 360);
  }

  function initChartPanHints() {
    const hints = Array.from(document.querySelectorAll(".chart-pan-hint[data-enabled='true']"));
    if (!hints.length) return;

    function reveal(hint) {
      if (hint.dataset.shown || hint.dataset.dismissed) return;
      hint.dataset.shown = "true";
      hint.classList.add("is-visible");
      setTimeout(function () { hint.classList.remove("is-visible"); }, 4000);
    }

    if (!("IntersectionObserver" in window)) {
      hints.forEach(reveal);
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 1 });
    hints.forEach(function (hint) { observer.observe(hint); });
  }

  function initToc() {
    var toc = document.getElementById("toc");
    var items = Array.from(toc.querySelectorAll(".toc-item"));
    var targets = items.map(function (item) {
      return document.getElementById(item.dataset.target);
    }).filter(Boolean);
    if (!items.length || !targets.length) return;

    // ---- click to scroll ----
    var scrollLock = 0;
    items.forEach(function (item) {
      item.addEventListener("click", function (e) {
        e.preventDefault();
        var target = document.getElementById(item.dataset.target);
        if (!target) return;
        // Highlight immediately on click
        items.forEach(function (it) { it.classList.remove("active"); });
        item.classList.add("active");
        scrollLock = Date.now();
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(function () { scrollLock = 0; }, 900);
      });
    });

    // ---- scroll spy ----
    function syncActive() {
      if (scrollLock && Date.now() - scrollLock < 900) return;
      var bestId = null, closest = Infinity;
      for (var i = 0; i < targets.length; i++) {
        var top = targets[i].getBoundingClientRect().top;
        // section whose top is closest to viewport top (but still in or below viewport)
        if (top >= -50 && top < closest) { closest = top; bestId = targets[i].id; }
      }
      // scrolled past everything → last section
      if (!bestId) bestId = targets[targets.length - 1].id;
      items.forEach(function (it) { it.classList.toggle("active", it.dataset.target === bestId); });
    }
    var scrollTimer;
    window.addEventListener("scroll", function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(syncActive, 80);
    }, { passive: true });
    syncActive();
  }

  // 折线：可切换 播放/进店/加购/成交，默认仅进店；播放UV量级大走右轴
  const TREND_METRICS = {
    play:  { label: "播放UV", col: 5, color: "#00AEEC", avg: true },
    visit: { label: "进店UV", col: 1, color: "#FB7299", avg: true },
    cart:  { label: "加购UV", col: 2, color: "#F97316", avg: true },
    deal:  { label: "成交UV", col: 3, color: "#EAB308", avg: true },
  };
  function activeTrendMetrics() {
    var a = [];
    document.querySelectorAll("#trendToggles .metric-toggle-card.active").forEach(function(b){ a.push(b.dataset.metric); });
    if (!a.length) a = ["visit"];
    return ["play", "visit", "cart", "deal"].filter(function(m){ return a.indexOf(m) >= 0; });
  }
  function buildTrendOption(rows, suffix) {
    var active = activeTrendMetrics();
    var useDual = active.indexOf("play") >= 0 && active.length > 1;
    var series = active.map(function(m){
      var mm = TREND_METRICS[m];
      var s = {
        name: mm.label + suffix, type: "line",
        data: rows.map(function(r){ return r[mm.col]; }),
        smooth: true, symbol: "circle", symbolSize: 5,
        yAxisIndex: (m === "play" && useDual) ? 1 : 0,
        lineStyle: { color: mm.color, width: 2 }, itemStyle: { color: mm.color },
      };
      if (mm.avg) s.markLine = buildAvgMarkLine(mm.color, mm.label);
      return s;
    });
    var yAxis = [
      { type: "value", name: useDual ? "进店/加购/成交 UV" : "UV", position: "left",
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.muted, fontSize: 11 }, nameTextStyle: { color: C.dim } },
      { type: "value", name: "播放UV", position: "right", show: useDual,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: useDual, color: "#00AEEC", fontSize: 11,
          formatter: function(v){ return v >= 1000 ? (v/1000).toFixed(1)+"k" : v; } },
        nameTextStyle: { color: "#00AEEC", fontWeight: 600 } },
    ];
    return { series: series, yAxis: yAxis };
  }
  function initTrendToggles() {
    document.querySelectorAll("#trendToggles .metric-toggle-card").forEach(function(btn){
      btn.addEventListener("click", function(){
        this.classList.toggle("active");
        if (!document.querySelectorAll("#trendToggles .metric-toggle-card.active").length) {
          this.classList.add("active"); return;
        }
        renderTrend(trendCombo ? trendCombo.currentId : null);
      });
    });
  }

  function renderTrendModule() {
    const trendsAll = DATA.trends_all || [];
    // 候选列表：内容ID/达人 可搜；pub_date 用最早出现日期近似（CSV 无发布日字段）
    const candidates = DATA.notes
      .map(n => ({ note_id: n.note_id, creator: n.creator, pub_date: String(n.first_date || "") }))
      .sort((a, b) => (String(b.pub_date || "0") | 0) - (String(a.pub_date || "0") | 0));

    trendCombo = makeCombo({
      inputId: "trendSearch", listId: "trendList", candidates,
      filterKeys: ["note_id", "creator"],
      emptyPlaceholder: "（无趋势明细数据）",
      onSelect: function (noteId) { renderTrend(noteId); },
      onClear: function () { renderTrend(null); },
    });

    // 默认：无选中 → 展示全部内容汇总趋势
    if (trendsAll.length || candidates.length) {
      renderTrend(null);
    } else {
      document.getElementById("trendChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">B站表未加载或无按日明细，无法绘制趋势</div>';
    }
  }

  /** renderTrend(null) = 全部内容汇总；renderTrend(noteId) = 单篇 */
  function renderTrend(noteId) {
    if (trendCombo) trendCombo.currentId = noteId || null;
    const trendsAll = DATA.trends_all || [];

    if (!noteId) {
      // ===== 全部内容汇总模式 =====
      const rows = trendsAll;
      if (!rows.length) {
        if (trendChart) { try { trendChart.dispose(); } catch (ignore) {} trendChart = null; }
        document.getElementById("trendChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">暂无汇总趋势数据</div>';
        return;
      }
      var trendModSub = document.querySelector("#modTrend .mod-sub");
      if (trendModSub) trendModSub.textContent = "全部内容逐日汇总 · 播放 / 进店 / 加购 / 成交 UV 趋势";
      const period = rows.length
        ? fmtDate(rows[0][0]) + " ~ " + fmtDate(rows[rows.length - 1][0])
        : "—";
      const totalVisit = rows.reduce((s, r) => s + (r[1] || 0), 0);
      const totalCart = rows.reduce((s, r) => s + (r[2] || 0), 0);
      const totalDeal = rows.reduce((s, r) => s + (r[3] || 0), 0);
      const totalGmv = rows.reduce((s, r) => s + (r[4] || 0), 0);
      const totalPlay = rows.reduce((s, r) => s + (r[5] || 0), 0);
      const kpis = [
        { l: "总进店UV（全部）", v: fmt.int(totalVisit), u: "" },
        { l: "总加购UV（全部）", v: fmt.int(totalCart), u: "" },
        { l: "总成交UV（全部）", v: fmt.int(totalDeal), u: "" },
        { l: '总GMV（全部）<span class="gmv-approx" data-tip="B站按内容维度统计GMV，同一笔订单被多条内容共同贡献时会重复计入，加总后高于实际成交额。">≈ 参考值</span>', v: fmt.money(totalGmv), u: "元", approx: true },
        { l: "内容数", v: fmt.int(DATA.notes.length), u: "条" },
      ];
      document.getElementById("trendKpis").innerHTML = kpis.map(k =>
        `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
          <div class="trend-kpi-label">${k.l}</div>
          <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
        </div>`
      ).join("");

      updateToggleCards("trendToggles", {
        play: fmt.int(totalPlay),
        visit: fmt.int(totalVisit),
        cart: fmt.int(totalCart),
        deal: fmt.int(totalDeal)
      });

      if (!trendChart) trendChart = echarts.init(document.getElementById("trendChart"));
      const dates = rows.map(r => fmtDate(r[0]));
      const opt = buildTrendOption(rows, "（全部）");
      trendChart.setOption({
        backgroundColor: "transparent",
        tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "#fff", borderColor: C.border, textStyle: { color: C.text } },
        legend: { top: 0, textStyle: { color: C.muted, fontSize: 12 }, itemWidth: 12, itemHeight: 2 },
        grid: { top: 40, left: 60, right: 60, bottom: 40 },
        dataZoom: buildInsideZoom(),
        xAxis: {
          type: "category", data: dates,
          axisLine: { lineStyle: { color: C.border } },
          axisLabel: { fontSize: 11, color: C.muted, rotate: dates.length > 40 ? 45 : 0 },
        },
        yAxis: opt.yAxis,
        series: opt.series,
      }, true);
      bindChartPanInteractions(trendChart, "trendPanHint");
      return;
    }

    // ===== 单篇模式 =====
    var trendModSub2 = document.querySelector("#modTrend .mod-sub");
    if (trendModSub2) trendModSub2.textContent = "逐日转化趋势 · hover 看进店率 / 加购率 / 转化率";
    const rows = (DATA.trends || {})[noteId] || [];
    const note = DATA.notes.find(n => n.note_id === noteId) || {};

    // 无趋势数据：详情页结构化占位（状态/原因/解决），避免误以为系统未加载
    if (!rows.length) {
      if (trendChart) { try { trendChart.dispose(); } catch (ignore) {} trendChart = null; }
      document.getElementById("trendChart").innerHTML =
        '<div class="nodata-card">' +
          '<div class="nodata-head"><span class="nodata-icon">⚠️</span><span class="nodata-title">该内容暂无趋势数据</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-ok">已加载</span><span class="nodata-text">内容已加载，可在数据源状态条确认</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-info">原因</span><span class="nodata-text">B站表尚未覆盖此内容：新内容归因数据未出，或 B站表未更新到该日期</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-act">解决</span><span class="nodata-text">B站表更新后重新生成看板，数据将自动补全</span></div>' +
        '</div>';
      document.getElementById("trendKpis").innerHTML = "";
      var modSubEmpty = document.querySelector("#modTrend .mod-sub");
      if (modSubEmpty) modSubEmpty.textContent = "该内容暂无趋势数据";
      return;
    }

    // 计算复合指标（漏斗口径：播放 → 进店 → 加购 → 成交，统一采用 B站 表 UV）
    const playUv = note.play_uv || 0;
    const visitUv = note.visit_uv || 0;
    const cartUv = note.cart_uv || 0;
    const dealUv = note.deal_uv || 0;
    const gmv = note.gmv || 0;
    const visitRate = playUv > 0 ? (visitUv / playUv * 100) : null;
    const cartRate = visitUv > 0 ? (cartUv / visitUv * 100) : null;
    const dealRate = visitUv > 0 ? (dealUv / visitUv * 100) : null;
    const uvValue = visitUv > 0 ? (gmv / visitUv) : null;

    // 与本期所有有效内容的算术平均转化率比较，避免无分母内容稀释均值。
    function averageRate(fn) {
      const values = (DATA.notes || [])
        .map(fn)
        .filter(v => typeof v === "number" && Number.isFinite(v));
      return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length * 100 : null;
    }
    const visitAvg = averageRate(n => (n.play_uv || 0) > 0 ? (n.visit_uv || 0) / (n.play_uv || 0) : null);
    const cartAvg = averageRate(n => (n.visit_uv || 0) > 0 ? (n.cart_uv || 0) / (n.visit_uv || 0) : null);
    const dealAvg = averageRate(n => (n.visit_uv || 0) > 0 ? (n.deal_uv || 0) / (n.visit_uv || 0) : null);

    function rateCompare(current, average) {
      if (current == null) return { rate: null, average: average };
      if (average == null) return { rate: current, average: null, rateClass: "is-neutral" };
      const diff = current - average;
      const rateClass = Math.abs(diff) < 0.005 ? "is-neutral" : (diff > 0 ? "is-good" : "is-bad");
      return { rate: current, average: average, rateClass: rateClass };
    }
    const visitComp = rateCompare(visitRate, visitAvg);
    const cartComp = rateCompare(cartRate, cartAvg);
    const dealComp = rateCompare(dealRate, dealAvg);

    const kpis = [
      { l: "总播放UV", v: fmt.int(playUv), rate: null, tip: "", u: "" },
      { l: "总进店UV", v: fmt.int(visitUv), rate: visitComp.rate, average: visitComp.average, rateClass: visitComp.rateClass, tip: "进店率 = 进店UV ÷ 播放UV；平均率 = 本期有效内容进店率的算术平均", u: "" },
      { l: "总加购UV", v: fmt.int(cartUv), rate: cartComp.rate, average: cartComp.average, rateClass: cartComp.rateClass, tip: "进店加购率 = 加购UV ÷ 进店UV；平均率 = 本期有效内容加购率的算术平均", u: "" },
      { l: "总成交UV", v: fmt.int(dealUv), rate: dealComp.rate, average: dealComp.average, rateClass: dealComp.rateClass, tip: "进店转化率 = 成交UV ÷ 进店UV；平均率 = 本期有效内容成交率的算术平均", u: "" },
      { l: '总GMV <span class="gmv-approx" data-tip="B站按内容维度统计GMV，同一笔订单被多条内容共同贡献时会重复计入，数值高于实际成交额。">≈ 参考值</span>', v: fmt.money(gmv), rate: null, tip: "⚠ 多内容归因下含重复计算，非精确值", u: "元", approx: true },
      { l: 'UV价值 <span class="gmv-approx" data-tip="UV价值 = GMV ÷ 进店UV，因GMV含多内容归因重复，该值为近似参考。">≈ 参考值</span>', v: uvValue != null ? "¥" + uvValue.toFixed(2) : "—", rate: null, tip: "UV价值 = 总GMV ÷ 进店UV（GMV含归因重复）", u: "", approx: true },
    ];
    document.getElementById("trendKpis").innerHTML = kpis.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span>${k.rate != null ? '<span class="trend-kpi-rate ' + (k.rateClass || "") + '"> ' + k.rate.toFixed(2) + '%</span>' : ""}${k.average != null ? '<span class="trend-kpi-average">平均 ' + k.average.toFixed(2) + '%</span>' : ""}</div>
      </div>`
    ).join("");

    updateToggleCards("trendToggles", {
      play: fmt.int(playUv),
      visit: fmt.int(visitUv),
      cart: fmt.int(cartUv),
      deal: fmt.int(dealUv)
    });

    // 内容首次出现日期（x 轴粉字标注；CSV 无发布日字段，用最早数据日期近似）
    const firstDateRaw = note.first_date ? note.first_date : null;
    const firstDateStr = firstDateRaw ? fmtDate(String(firstDateRaw)) : null;

    if (!trendChart) trendChart = echarts.init(document.getElementById("trendChart"));
    const dates = rows.map(r => fmtDate(r[0]));
    const opt = buildTrendOption(rows, "");
    trendChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "#fff", borderColor: C.border, textStyle: { color: C.text } },
      legend: { top: 0, textStyle: { color: C.muted, fontSize: 12 }, itemWidth: 12, itemHeight: 2 },
      grid: { top: 40, left: 60, right: 60, bottom: 40 },
      dataZoom: buildInsideZoom(),
      xAxis: {
        type: "category", data: dates,
        axisLine: { lineStyle: { color: C.border } },
        axisLabel: {
          fontSize: 11, fontWeight: 600,
          color: function (value) {
            return firstDateStr && value === firstDateStr ? "#E9567C" : C.muted;
          },
          rotate: dates.length > 40 ? 45 : 0,
        },
      },
      yAxis: opt.yAxis,
      series: opt.series,
    }, true);
    bindChartPanInteractions(trendChart, "trendPanHint");
  }

  // ===== 全局 GMV tooltip（避免被 overflow 裁剪） =====
  function initGmvTooltip() {
    var tip = document.getElementById("gmvGlobalTip");
    if (!tip) return;
    document.addEventListener("mouseover", function(e){
      var el = e.target.closest(".gmv-approx");
      if (!el) { tip.hidden = true; return; }
      var text = el.getAttribute("data-tip");
      if (!text) { tip.hidden = true; return; }
      tip.textContent = text;
      tip.hidden = false;
      var rect = el.getBoundingClientRect();
      var left = rect.left;
      var top = rect.bottom + 8;
      // Keep within viewport
      if (left + 300 > window.innerWidth) left = window.innerWidth - 310;
      if (left < 8) left = 8;
      if (top + 80 > window.innerHeight) top = rect.top - tip.offsetHeight - 8;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }, true);
    document.addEventListener("mouseout", function(e){
      if (e.target.closest(".gmv-approx")) return;
      // Small delay to avoid flicker when moving between elements
      setTimeout(function(){
        if (!document.querySelector(".gmv-approx:hover")) tip.hidden = true;
      }, 50);
    }, true);
  }

  // ===== boot =====
  renderMeta();
  renderKpis();
  renderSources();
  initGmvTooltip();
  initTrendToggles();
  renderTrendModule();
  initChartPanHints();
  initToc();

  // ---------- 全局响应 ----------
  window.addEventListener("resize", () => {
    if (trendChart) trendChart.resize();
  });
})();
