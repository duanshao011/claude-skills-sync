/* 小红书全链路投放看板 · 前端渲染
   图表一 · 单篇趋势分析 | 图表二 · 单篇成本分析 | 图表三 · 全链路数据
*/
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("dashPayload").textContent);
  const C = {
    text: "#111827", muted: "#6B7280", dim: "#9CA3AF", border: "#E5E7EB",
    grid: "#F3F4F6", panel: "#FFFFFF", brand: "#FF2442",
  };

  // ===== 联动 state：每个图表各自的联动开关，默认全开，独立控制 =====
  const STATE = { links: { trend: true, cost: true, table: true }, currentNote: null };

  /** 安全联动的核心：从 sourceModule 把选中笔记推送给所有参与联动的模块 */
  function onNoteChange(sourceModule, noteId) {
    console.log('[onNoteChange] source=' + sourceModule + ' noteId=' + noteId + ' links=' + JSON.stringify(STATE.links));
    STATE.currentNote = noteId;
    // 源模块必须勾选联动才往外推
    if (!STATE.links[sourceModule]) { console.log('[onNoteChange] 源模块未勾选联动，跳过'); return; }

    // 解析模块名 → 对应的 combo 引用（延迟求值，处理 boot 时序）
    function _comboFor(mod) {
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
      // combo 还未初始化 → 延迟 300ms 重试一次（重新取值而非用闭包捕获的旧引用）
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

  // ---------- 格式化 ----------
  const fmt = {
    int(v) { return v == null ? "—" : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 0 }); },
    // 数字类：严格2位小数（用于 ROI/兑换比等非金额比值）
    num(v, d = 2) { return v == null ? "—" : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d }); },
    // 率类：*100 后严格2位小数带 %
    ratio(v, d = 2) { return v == null ? "—" : (Number(v) * 100).toFixed(d) + "%"; },
    // 金额类：严格2位小数（元）
    money(v) { return v == null ? "—" : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    val(v, col) {
      if (v == null || (typeof v === "number" && !isFinite(v))) return "—";
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

  // ===== 通用 Combobox =====
  function makeCombo(cfg) {
    /* cfg: { inputId, listId, candidates, onSelect, placeholder, filterKeys, moduleKey }
       moduleKey: "trend" | "cost" — 用于联动推送 */
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
        list.innerHTML = '<li class="combo-empty">无匹配笔记</li>';
        return;
      }
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
      const isOutside = !n;
      if (!n) n = DATA.notes.find(x => x.note_id === self.currentId);
      if (n) {
        inp.value = `${fmtPubDate(n.pub_date)} | ${n.note_id} | ${n.creator || "—"}`;
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
      // 选中全文方便复制或直接输入覆盖，不清空
      inp.select();
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
      "口径：" + (m.flow_type || "全部流量") + " / 归因 " + (m.attr_period || 30) + " 天";
    document.getElementById("metaGen").textContent = "生成于 " + m.generated;
    document.getElementById("footAlign").textContent = m.align_ok
      ? "窗口对齐 ✓ 已对齐"
      : (m.align_msg ? "⚠ " + m.align_msg : "—");
  }

  // ===== KPI 顶部 =====
  function renderKpis() {
    const s = DATA.summary;
    const m = DATA.meta || {};
    const kpi = [
      { l: "总投入（薯条实付）", v: fmt.money(s.total_spend), u: "元", sub: "仅推广完成·实际支付，不含达人合作费", range: m.chili_period, rangeTip: "薯条投放周期" },
      { l: '总 GMV <span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单如果有多条笔记共同贡献，该订单GMV会被重复计入每条笔记，因此加总后的GMV高于实际成交额。">≈ 参考值</span>', v: fmt.money(s.total_gmv), u: "元", sub: "⚠ 多内容归因存在重复计算", range: m.star_period, rangeTip: "星河数据周期", approx: true },
      { l: '整体 ROI <span class="gmv-approx" data-tip="ROI = GMV / 薯条实付，因分子GMV含多内容归因重复计算，该ROI为近似参考值，实际ROI会偏低。">≈ 参考值</span>', v: s.overall_roi == null ? "—" : Number(s.overall_roi).toFixed(2), u: "", sub: "口径：GMV / 薯条实付（GMV含归因重复）", approx: true },
      { l: "笔记数",        v: fmt.int(s.note_count),    u: "篇", sub: "已投 " + fmt.int(s.invested_count) + " 篇" },
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
    const cards = ["pgy", "star", "chili", "lx"].map(k => {
      const s = src[k] || { name: k, loaded: false, rows: 0 };
      const ok = s.loaded;
      const path = (s.path || "").split(/[\\/]/).pop() || "";
      let countTxt = ok ? fmt.int(s.rows) + " 条" : "未上传";
      if (ok && k === "lx" && s.hit != null) {
        countTxt = fmt.int(s.rows) + " 条 · 命中本期 " + fmt.int(s.hit) + " 条";
      }
      const period = ok && s.period ? `<span class="src-period">📅 ${s.period}</span>` : "";
      return `<div class="src-card">
        <div class="src-badge ${ok ? "ok" : "miss"}">${ok ? "✓" : "—"}</div>
        <div class="src-info">
          <div class="src-name">${s.name} <span class="src-count ${ok ? "" : "miss"}">${countTxt}</span></div>
          <div class="src-desc">${ok ? path : (s.reason || "缺失该表，相关字段列将标注")}</div>
          ${period}
        </div>
      </div>`;
    }).join("");
    document.getElementById("sourceStrip").innerHTML = cards;
  }

  // ===== 图表一 · 单篇趋势分析 =====
  let trendChart = null, trendCombo = null;

  function fmtDate(d) {
    if (d == null) return "—";
    const s = String(d);
    return s.length === 8 ? s.slice(4, 6) + "/" + s.slice(6, 8) : s;
  }

  // 进店UV日均值虚线（type=average，UV类按整数显示）
  function buildAvgMarkLine(color) {
    return {
      symbol: "none",
      silent: true,
      precision: 0,
      lineStyle: { color: color, type: "dashed", width: 1.5, opacity: 0.75 },
      label: {
        formatter: function(p){ return "日均 " + Math.round(p.value); },
        position: "insideEndTop",
        fontSize: 11,
        fontWeight: 600,
        color: color,
        backgroundColor: "rgba(255,255,255,0.85)",
        padding: [2, 4],
        borderRadius: 3,
      },
      data: [{ type: "average", name: "进店UV日均" }],
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
      emptyPlaceholder: "（无趋势明细数据）",
      onSelect: function (noteId) { renderTrend(noteId); },
      onClear: function () { renderTrend(null); },
    });

    // 默认：无选中 → 展示全部笔记汇总趋势
    if (trendsAll.length || candidates.length) {
      renderTrend(null);
    } else {
      document.getElementById("trendChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">星河表未加载或无按日明细，无法绘制趋势</div>';
    }
  }

  /** renderTrend(null) = 全部笔记汇总；renderTrend(noteId) = 单篇 */
  function renderTrend(noteId) {
    if (trendCombo) trendCombo.currentId = noteId || null;
    const trendsAll = DATA.trends_all || [];

    if (!noteId) {
      // ===== 全部笔记汇总模式 =====
      const rows = trendsAll;
      if (!rows.length) {
        document.getElementById("trendChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">暂无汇总趋势数据</div>';
        return;
      }
      const period = rows.length
        ? fmtDate(rows[0][0]) + " ~ " + fmtDate(rows[rows.length - 1][0])
        : "—";
      const totalVisit = rows.reduce((s, r) => s + (r[1] || 0), 0);
      const totalCart = rows.reduce((s, r) => s + (r[2] || 0), 0);
      const totalDeal = rows.reduce((s, r) => s + (r[3] || 0), 0);
      const totalGmv = rows.reduce((s, r) => s + (r[4] || 0), 0);
      const kpis = [
        { l: "总进店UV（全部）", v: fmt.int(totalVisit), u: "" },
        { l: "总加购UV（全部）", v: fmt.int(totalCart), u: "" },
        { l: "总成交UV（全部）", v: fmt.int(totalDeal), u: "" },
        { l: '总GMV（全部）<span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单被多条笔记共同贡献时会重复计入，加总后高于实际成交额。">≈ 参考值</span>', v: fmt.money(totalGmv), u: "元", approx: true },
        { l: "笔记数", v: fmt.int(DATA.notes.length), u: "篇" },
        { l: "", v: "📊 全部笔记汇总", u: "" },
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
        { name: "进店UV（全部）", data: rows.map(r => r[1]), col: "#FF2442", avg: true },
        { name: "加购UV（全部）", data: rows.map(r => r[2]), col: "#F97316" },
        { name: "成交UV（全部）", data: rows.map(r => r[3]), col: "#EAB308" },
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

    // ===== 单篇笔记模式 =====
    const rows = (DATA.trends || {})[noteId] || [];
    const note = DATA.notes.find(n => n.note_id === noteId) || {};

    const period = rows.length
      ? fmtDate(rows[0][0]) + " ~ " + fmtDate(rows[rows.length - 1][0])
      : "—";

    // 计算复合指标
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
      { l: "总阅读UV", v: fmt.int(readUv), rate: null, tip: "", u: "" },
      { l: "总进店UV", v: fmt.int(visitUv), rate: visitRate != null ? visitRate.toFixed(2) + "%" : null, tip: "进店率 = 进店UV ÷ 阅读UV", u: "" },
      { l: "总加购UV", v: fmt.int(cartUv), rate: cartRate != null ? cartRate.toFixed(2) + "%" : null, tip: "进店加购率 = 加购UV ÷ 进店UV", u: "" },
      { l: "总成交UV", v: fmt.int(dealUv), rate: dealRate != null ? dealRate.toFixed(2) + "%" : null, tip: "进店转化率 = 成交UV ÷ 进店UV", u: "" },
      { l: '总GMV <span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单被多条笔记共同贡献时会重复计入，数值高于实际成交额。">≈ 参考值</span>', v: fmt.money(gmv), rate: null, tip: "⚠ 多内容归因下含重复计算，非精确值", u: "元", approx: true },
      { l: 'UV价值 <span class="gmv-approx" data-tip="UV价值 = GMV ÷ 进店UV，因GMV含多内容归因重复，该值为近似参考。">≈ 参考值</span>', v: uvValue != null ? "¥" + uvValue.toFixed(2) : "—", rate: null, tip: "UV价值 = 总GMV ÷ 进店UV（GMV含归因重复）", u: "", approx: true },
    ];
    document.getElementById("trendKpis").innerHTML = kpis.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span>${k.rate ? '<span class="trend-kpi-rate"> ' + k.rate + '</span>' : ""}</div>
      </div>`
    ).join("");

    // 笔记发布日期（x 轴红字标注，与图表二一致）
    const pubDateRaw = note.pub_date ? note.pub_date : null;
    const pubDateStr = pubDateRaw ? fmtDate(pubDateRaw.replace(/-/g, "")) : null;

    if (!trendChart) trendChart = echarts.init(document.getElementById("trendChart"));
    const dates = rows.map(r => fmtDate(r[0]));
    const series = [
      { name: "进店UV", data: rows.map(r => r[1]), col: "#FF2442", avg: true },
      { name: "加购UV", data: rows.map(r => r[2]), col: "#F97316" },
      { name: "成交UV", data: rows.map(r => r[3]), col: "#EAB308" },
    ];
    trendChart.setOption({
      backgroundColor: "transparent",
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

  // ===== 图表二 · 单篇成本分析 =====
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
      emptyPlaceholder: "（无已投放笔记）",
      onSelect: function (noteId) { renderCost(noteId); },
      onClear: function () { renderCost(null); },
    });

    // 默认：无选中 → 展示全部笔记汇总消耗
    if (costAll || candidates.length) {
      renderCost(null);
    } else {
      document.getElementById("costChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">薯条表未加载或无消耗数据，无法展示成本分析</div>';
    }
  }

  /** renderCost(null) = 全部笔记汇总；renderCost(noteId) = 单篇 */
  function renderCost(noteId) {
    console.log('[renderCost] called with noteId:', JSON.stringify(noteId), 'type:', typeof noteId);
    if (costCombo) costCombo.currentId = noteId || null;
    const costData = DATA.cost || {};

    if (!noteId) {
      console.log('[renderCost] → 汇总模式（!noteId）');
      // ===== 全部笔记汇总模式 =====
      const ca = DATA.cost_all;
      if (!ca || !ca.daily || !ca.daily.length) {
        document.getElementById("costChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">暂无消耗汇总数据</div>';
        return;
      }
      const s = ca.summary || {};
      const daily = ca.daily || [];
      const kpiItems = [
        { l: "总消耗（全部）", v: fmt.money(s.spend), u: "元" },
        { l: '总GMV（全部）<span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单被多条笔记共同贡献时会重复计入，加总后高于实际成交额。">≈ 参考值</span>', v: fmt.money(s.gmv), u: "元", approx: true },
        { l: "总进店UV（全部）", v: fmt.int(s.visit_uv), u: "" },
        { l: "总加购UV（全部）", v: fmt.int(s.cart_uv), u: "" },
        { l: "总成交UV（全部）", v: fmt.int(s.deal_uv), u: "" },
        { l: "笔记数", v: fmt.int(s.note_count), u: "篇" },
        { l: "", v: "📊 全部笔记汇总", u: "" },
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
            const sp = row[1] != null ? "¥" + Number(row[1]).toFixed(2) : "—";
            const tdL2 = "color:#6B7280;text-align:right;padding-right:10px;white-space:nowrap";
            const tdR2 = "font-weight:600;text-align:right";
            return `<div style="font-weight:700;margin-bottom:4px">${fmtDate(row[0])}</div>
              <table style="border-spacing:0 2px;font-size:13px;line-height:1.6">
              <tr><td style="${tdL2}">当日总消耗</td><td style="${tdR2}">${sp}</td></tr>
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
          { type: "value", name: "元", position: "left",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { lineStyle: { color: C.grid } },
            axisLabel: { color: "#FF2442", fontSize: 11, fontWeight: 600, formatter: function(v){ return v>=1000 ? (v/1000).toFixed(1)+"k" : Math.round(v); } }, nameTextStyle: { color: "#FF2442", fontWeight: 600 },
          },
          { type: "value", name: "元/UV", position: "right",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { color: "#F97316", fontSize: 11, fontWeight: 600, formatter: function(v){ return "¥"+v.toFixed(1); } },
            nameTextStyle: { color: "#F97316", fontWeight: 600 },
          },
        ],
        series: [
          { name: "当日总实付", type: "bar", yAxisIndex: 0, data: spendVals,
            itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#FF4D6A" }, { offset: 1, color: "#FF2442" }
            ]) },
            barMaxWidth: 30,
          },
          { name: "累计进店成本（全部）", type: "line", yAxisIndex: 1,
            data: daily.map(r => r[3]),
            smooth: true, symbol: "none",
            lineStyle: { color: "#FF2442", width: 2, type: "dashed" },
          },
        ],
      });
      return;
    }

    // ===== 单篇笔记模式 =====
    const entry = costData[noteId];
    if (!entry) {
      if (costChart) { try { costChart.dispose(); } catch (ignore) {} costChart = null; }
      document.getElementById("costChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">该笔记无成本数据</div>';
      // 清空指标卡，避免残留汇总数据
      document.getElementById("costKpis").innerHTML = "";
      return;
    }
    const s = entry.summary || {};
    const daily = entry.daily || [];

    // 7 指标卡
    const kpiItems = [
      { l: "累计消耗", v: fmt.money(s.spend), u: "元" },
      { l: '累计GMV <span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单被多条笔记共同贡献时会重复计入，数值高于实际成交额。">≈ 参考值</span>', v: fmt.money(s.gmv), u: "元", approx: true },
      { l: 'ROI <span class="gmv-approx" data-tip="ROI = GMV / 薯条实付，因分子GMV含多内容归因重复，该值为近似参考，实际ROI会偏低。">≈ 参考值</span>', v: s.roi == null ? "—" : Number(s.roi).toFixed(2), u: "", approx: true },
      { l: "进店UV成本", v: s.visit_uv_cost == null ? "—" : "¥" + Number(s.visit_uv_cost).toFixed(2), u: "" },
      { l: "加购成本",  v: s.cart_cost == null ? "—" : "¥" + Number(s.cart_cost).toFixed(2), u: "" },
      { l: "成交成本",  v: s.deal_cost == null ? "—" : "¥" + Number(s.deal_cost).toFixed(2), u: "" },
      { l: "历史最高单日", v: s.max_daily == null ? "—" : "¥" + Number(s.max_daily).toFixed(2), u: "" },
    ];
    document.getElementById("costKpis").innerHTML = kpiItems.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
      </div>`
    ).join("");

    // 笔记发布日期（用于 x 轴标注，对齐 fmtDate 格式 MM/DD）
    const noteInfo = DATA.notes.find(n => n.note_id === noteId);
    const pubDateRaw = noteInfo && noteInfo.pub_date ? noteInfo.pub_date : null;
    const pubDateStr = pubDateRaw ? fmtDate(pubDateRaw.replace(/-/g, "")) : null;

    // ECharts 柱状图（加固：try-catch + 自动恢复）
    try {
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
            const sp = row[1] != null ? "¥" + Number(row[1]).toFixed(2) : "—";
            let vc = "—";
            const visit = row[2], spend = row[1];
            if (spend && spend > 0 && visit && visit > 0) vc = "¥" + (spend / visit).toFixed(2);
            const dStr = fmtDate(row[0]);
            const isPub = pubDateStr && dStr === pubDateStr;
            const cumCost = row[6] != null ? "¥" + Number(row[6]).toFixed(2) : "—";
            const tdL = "color:#6B7280;text-align:right;padding-right:10px;white-space:nowrap";
            const tdR = "font-weight:600;text-align:right;font-variant-numeric:tabular-nums";
            const pubTag = isPub ? ' <span style="color:#FF2442;font-size:11px">笔记发布日期</span>' : "";
            return `<div style="font-weight:700;margin-bottom:6px">${dStr}${pubTag}</div>
              <table style="border-spacing:0 2px;font-size:13px;line-height:1.6">
              <tr><td style="${tdL}">当日消耗</td><td style="${tdR}">${sp}</td></tr>
              <tr><td style="${tdL}">当日进店成本</td><td style="${tdR}">${vc}</td></tr>
              <tr><td style="${tdL}">累计进店成本</td><td style="${tdR}">${cumCost}</td></tr>
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
          { type: "value", name: "元", position: "left",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { lineStyle: { color: C.grid } },
            axisLabel: { color: "#FF2442", fontSize: 11, fontWeight: 600, formatter: function(v){ return v>=1000 ? (v/1000).toFixed(1)+"k" : v.toFixed(2); } }, nameTextStyle: { color: "#FF2442", fontWeight: 600 },
          },
          { type: "value", name: "元/UV", position: "right",
            axisLine: { show: false }, axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { color: "#F97316", fontSize: 11, fontWeight: 600, formatter: function(v){ return "¥"+v.toFixed(2); } },
            nameTextStyle: { color: "#F97316", fontWeight: 600 },
          },
        ],
        series: [
          { name: "当日实付", type: "bar", yAxisIndex: 0, data: spendVals,
            itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#FF4D6A" }, { offset: 1, color: "#FF2442" }
            ]) },
            barMaxWidth: 30,
          },
          { name: "累计进店成本", type: "line", yAxisIndex: 1,
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
        '<div style="padding:80px;text-align:center;color:#DC2626">图表渲染失败：' + (e.message || e) + '<br><small>请刷新页面后重试</small></div>';
    }
  }

  // ===== 图表三 · 全链路表格 =====
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
    // 查询面板筛选状态（图表三独立筛选，不参与联动）
    filter: {
      creator: "",       // 达人昵称（模糊包含匹配）
      noteId: "",        // 笔记ID（模糊包含匹配）
      pubDateStart: "",  // YYYY-MM-DD
      pubDateEnd: "",    // YYYY-MM-DD
    },
  };

  function initTableCols() {
    for (const g of TABLE.groups) {
      for (const c of g.columns) {
        c.group = g.key;
        c.groupLabel = g.label;
        // 派生字段标记：source=="系统计算" → derived
        c.derived = (c.source === "系统计算");
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
      "蒲公英": !!(src.pgy && src.pgy.loaded),
      "星河": !!(src.star && src.star.loaded),
      "薯条": !!(src.chili && src.chili.loaded),
      "灵犀": !!(src.lx && src.lx.loaded),
    };
    const deps = [];
    const need = col.source || "";
    for (const t of ["蒲公英", "星河", "薯条", "灵犀"]) if (need.includes(t)) deps.push(t);
    if (Array.isArray(col.needs)) for (const t of col.needs) if (!deps.includes(t)) deps.push(t);
    for (const t of deps) if (!loaded[t]) return "需上传" + t;
    return null;
  }

  // ===== 图表三 · 查询面板：字段筛选 + CSV 导出 =====


  // 应用查询面板所有筛选
  function applyPanelFilter(notes) {
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

    // 输入即过滤：达人昵称/笔记ID 打字实时匹配（150ms debounce 避免抖动），日期改动立即触发
    let debounceTimer = null;
    function debouncedApply() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyQuery, 150);
    }
    [qCreator, qNoteId].forEach(el => el.addEventListener("input", debouncedApply));
    [qStart, qEnd].forEach(el => el.addEventListener("change", applyQuery));

    // Enter 键也可以手动触发（不用等 debounce）
    [qCreator, qNoteId, qStart, qEnd].forEach(el => {
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
      // 保留数据精度：整数不加小数、小数保留 4 位
      s = Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
    }
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    const cols = TABLE.selected.map(k => TABLE.byKey[k]).filter(Boolean);
    if (!cols.length) { alert("没有可导出的列"); return; }
    // 复用筛选（不含分页和排序，导出全部筛选结果）
    let notes = DATA.notes.slice();
    notes = applyPanelFilter(notes);
    if (TABLE.keyword) {
      const terms = TABLE.keyword.toLowerCase().split(/\s+/).filter(Boolean);
      notes = notes.filter(n => {
        const hay = ((n.note_id || "") + " " + (n.creator || "")).toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    // 保持当前排序
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
    const csv = "﻿" + header + "\r\n" + rows.join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = (new Date()).toISOString().slice(0, 10);
    a.href = url;
    a.download = "全链路数据_" + stamp + ".csv";
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
      const arrow = !active ? "↕" : (TABLE.sortDir === "desc" ? "↓" : "↑");
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
    // 查询面板筛选（达人昵称/笔记ID/发布日期/自然语言）
    notes = applyPanelFilter(notes);
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
      `<span>共 <b>${total}</b> 篇 · 显示 ${total === 0 ? 0 : start + 1}-${Math.min(start + TABLE.pageSize, total)} · ${cols.length} 列</span>
       <span class="pager">
         <button class="pg-btn" data-pg="first" ${TABLE.page === 1 ? "disabled" : ""}>«</button>
         <button class="pg-btn" data-pg="prev" ${TABLE.page === 1 ? "disabled" : ""}>‹</button>
         <span class="pg-cur">${TABLE.page} / ${pageCount}</span>
         <button class="pg-btn" data-pg="next" ${TABLE.page >= pageCount ? "disabled" : ""}>›</button>
         <button class="pg-btn" data-pg="last" ${TABLE.page >= pageCount ? "disabled" : ""}>»</button>
         <select class="pg-size" id="pgSize">
           <option value="20" ${TABLE.pageSize === 20 ? "selected" : ""}>20 行/页</option>
           <option value="30" ${TABLE.pageSize === 30 ? "selected" : ""}>30 行/页</option>
           <option value="50" ${TABLE.pageSize === 50 ? "selected" : ""}>50 行/页</option>
           <option value="100" ${TABLE.pageSize === 100 ? "selected" : ""}>100 行/页</option>
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
    if (tableMiss) return `<td class="col-missing${fzCls}"${fzStyle} title="${tableMiss}">—</td>`;

    const src = c.source || "";
    const rm = (tip) => `<td class="row-missing${fzCls}"${fzStyle} title="${tip}">—</td>`;
    if (src === "蒲公英" && !n.in_pgy) return rm("该笔记不在蒲公英合作报备名单");
    if (src === "星河" && !n.in_star) return rm("该笔记无星河转化数据");
    if (src === "薯条" && !n.in_chili) return rm("该笔记未投薯条");
    if (src === "灵犀" && !n.in_lx) return rm("该笔记不在灵犀种草贡献榜单");

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
    const t = String(text == null || text === "" ? "—" : text);
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

  // ---------- 悬停 tip ----------
  const tipEl = () => document.getElementById("tipCard");
  let tipTimer = null;
  function showTip(e, col) {
    if (!col) return;
    clearTimeout(tipTimer);
    const target = e.currentTarget;
    tipTimer = setTimeout(() => {
      const t = tipEl();
      document.getElementById("tipTitle").textContent = col.label;
      document.getElementById("tipSub").textContent = "分组：" + (col.groupLabel || "") + " · 来源：" + (col.source || "—") + (col.unit ? " · 单位：" + col.unit : "") + (col.derived ? " · 派生字段" : "");
      document.getElementById("tipFormula").textContent = col.formula || "—";
      document.getElementById("tipMeaning").textContent = col.meaning || "—";
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

  // ---------- 自定义列弹窗 ----------
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
        ? '<div class="sep">— 以上为固定列 —</div>' : "";
      return `${sepHtml}<div class="col-item ${locked ? "locked" : ""}${derCls}" data-key="${k}" draggable="${!locked}">
        ${locked ? '<span class="lock">🔒</span>' : '<span class="drag-handle">⋮⋮</span>'}
        <span>${c.label}</span>
        ${locked ? "" : `<span class="remove-x" data-remove="${k}">×</span>`}
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

  // ---------- 表格搜索（combo + 关键词过滤） ----------
  let tableCombo = null;

  function initTableCombo() {
    tableCombo = makeCombo({
      inputId: "tableSearch", listId: "tableList",
      candidates: DATA.notes,
      filterKeys: ["note_id", "creator"],
      moduleKey: "table",
      emptyPlaceholder: "（无数据）",
      onSelect: function (noteId) {
        TABLE.keyword = noteId;
        TABLE.page = 1;
        renderTable();
      },
    });
    // 额外监听：用户打字但不选下拉项时，实时关键词过滤表格
    const el = document.getElementById("tableSearch");
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

  // ---------- 联动复选框绑定（默认勾选，开箱即用） ----------
  function bindLinks() {
    var cb1 = document.getElementById("chkLink1");
    var cb2 = document.getElementById("chkLink2");
    var cb3 = document.getElementById("chkLink3");

    // 初始化：DOM 勾选状态 = STATE 默认值
    cb1.checked = STATE.links.trend;
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

  // ---------- 图表一 · 日维度进店趋势 ----------
  const DAILY_RED_PALETTE = [
    "#FF2442","#FF3B57","#FF526B","#FF6980",
    "#FF8194","#FF98A8","#FFAFBD","#FFC6D1",
    "#FFD1D8","#FFE0E5"
  ];
  const DAILY_ORANGE_PALETTE = [
    "#F97316","#FA8530","#FB9749","#FCA961",
    "#FDBB7A","#FDCD93","#FEDFAC","#FEEDC5",
    "#FFF3D8","#FFF8E8"
  ];
  const DAILY_GOLD_PALETTE = [
    "#EAB308","#ECBD14","#EFC724","#F1D137",
    "#F4DA4D","#F6E263","#F8EB79","#FAF290",
    "#FCF7A7","#FDFABF"
  ];
  const DAILY_REST_COLOR = "#D1D5DB";

  const METRIC_META = {
    visit: { label: "进店", palette: DAILY_RED_PALETTE, key: "visit_uv" },
    cart:  { label: "加购", palette: DAILY_ORANGE_PALETTE, key: "cart_uv" },
    deal:  { label: "成交", palette: DAILY_GOLD_PALETTE, key: "deal_uv" },
  };

  let DAILY_ACTIVE_METRICS = new Set(["visit"]);
  let dailyOverviewChart = null;
  let DAILY_SELECTED_DATE = null;

  function colorForRank(rank, metric) {
    metric = metric || "visit";
    var pal = METRIC_META[metric] ? METRIC_META[metric].palette : DAILY_RED_PALETTE;
    return pal[rank - 1] || DAILY_REST_COLOR;
  }

  function renderDailyOverview() {
    var dailyNotes = DATA.daily_notes || {};
    var trendsAll = DATA.trends_all || [];
    if (!trendsAll.length) {
      document.getElementById("dailyOverviewChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">星河表未加载，无法展示日维度数据</div>';
      return;
    }

    // Read active metrics from toggles
    var activeMetrics = [];
    document.querySelectorAll(".metric-toggle.active").forEach(function(btn){
      activeMetrics.push(btn.dataset.metric);
    });
    if (!activeMetrics.length) activeMetrics = ["visit"]; // at least one

    // KPI cards — show all three totals regardless of toggle
    var totalVisit = 0, totalCart = 0, totalDeal = 0, totalNotes = new Set();
    trendsAll.forEach(function(r){ totalVisit += r[1]||0; totalCart += r[2]||0; totalDeal += r[3]||0; });
    Object.keys(dailyNotes).forEach(function(d){ (dailyNotes[d]||[]).forEach(function(n){ totalNotes.add(n.note_id); }); });
    var kpis = [
      { l: "总进店UV", v: fmt.int(totalVisit), u: "" },
      { l: "总加购UV", v: fmt.int(totalCart), u: "" },
      { l: "总成交UV", v: fmt.int(totalDeal), u: "" },
      { l: "有数据笔记", v: fmt.int(totalNotes.size), u: "篇" },
      { l: "", v: "📊 日维度聚合", u: "" },
    ];
    document.getElementById("dailyOverviewKpis").innerHTML = kpis.map(function(k){
      return '<div class="trend-kpi"><div class="trend-kpi-label">'+k.l+'</div><div class="trend-kpi-val">'+k.v+'<span class="u"> '+k.u+'</span></div></div>';
    }).join("");

    // Build per-date stacked data
    var dates = trendsAll.map(function(r){ return fmtDate(r[0]); });
    var dateInts = trendsAll.map(function(r){ return r[0]; });
    var nDates = dateInts.length;

    // Build series dynamically for each active metric
    var barSeries = [];
    activeMetrics.forEach(function(metric){
      var mm = METRIC_META[metric];
      var metricKey = mm.key;
      var pal = mm.palette;
      var stackName = metric + "_stack";

      // Build rank data for this metric
      var rankSeries = [];
      for (var ri = 0; ri < 10; ri++) {
        rankSeries.push(new Array(nDates).fill(null));
      }
      var restSeries = new Array(nDates).fill(null);

      dateInts.forEach(function(dInt, di){
        var notes = (dailyNotes[dInt] || []).slice();
        notes.sort(function(a,b){ return (b[metricKey]||0) - (a[metricKey]||0); });
        for (var i = 0; i < Math.min(notes.length, 10); i++) {
          rankSeries[i][di] = notes[i][metricKey];
        }
        if (notes.length > 10) {
          var restSum = 0;
          for (var j = 10; j < notes.length; j++) restSum += notes[j][metricKey] || 0;
          restSeries[di] = restSum > 0 ? restSum : null;
        }
      });

      // Top10 stacked bars
      for (var ri2 = 0; ri2 < 10; ri2++) {
        barSeries.push({
          name: metric + "_Top" + (ri2 + 1),
          type: "bar", stack: stackName, yAxisIndex: 0,
          data: rankSeries[ri2],
          color: pal[ri2],
          barMaxWidth: activeMetrics.length > 1 ? 24 : 44,
          emphasis: { focus: "series" },
          itemStyle: { borderWidth: 0 },
        });
      }
      // Rest bar
      barSeries.push({
        name: metric + "_rest",
        type: "bar", stack: stackName, yAxisIndex: 0,
        data: restSeries, color: DAILY_REST_COLOR,
        barMaxWidth: activeMetrics.length > 1 ? 24 : 44,
        emphasis: { focus: "series" },
        itemStyle: { borderWidth: 0 },
      });

      // Daily total label (invisible bar on top of this stack)
      var dailyTotalData = trendsAll.map(function(r){
        var idx = {visit:1, cart:2, deal:3}[metric] || 1;
        return r[idx];
      });
      barSeries.push({
        name: metric + "_label",
        type: "bar", stack: stackName, yAxisIndex: 0,
        data: new Array(nDates).fill(null),
        label: {
          show: true,
          position: "top",
          fontSize: 10,
          fontWeight: 700,
          color: pal[0],
          formatter: function(p) {
            var idx = p.dataIndex;
            return idx >= 0 && idx < nDates ? fmt.int(dailyTotalData[idx]) : "";
          },
        },
        color: "transparent",
        barMaxWidth: activeMetrics.length > 1 ? 24 : 44,
        silent: true,
        tooltip: { show: false },
        itemStyle: { borderWidth: 0 },
      });
    });

    var chartDom = document.getElementById("dailyOverviewChart");
    if (!dailyOverviewChart) dailyOverviewChart = echarts.init(chartDom);
    dailyOverviewChart.off("click");

    var zoomOpt = activeMetrics.length > 1
      ? [{ type: "slider", bottom: 4, height: 20, start: 0, end: nDates > 40 ? 30 : 100 }]
      : (nDates > 40 ? [{ type: "slider", bottom: 4, height: 20, start: 0, end: 30 }] : []);

    dailyOverviewChart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "#fff",
        borderColor: C.border,
        textStyle: { color: C.text, fontSize: 12 },
        extraCssText: "max-width:420px;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.10);z-index:200",
        formatter: function(params) {
          if (!params || !params.length) return "";
          var dateIdx = params[0].dataIndex;
          var dInt = dateInts[dateIdx];
          var notes = (dailyNotes[dInt] || []).slice();
          notes.sort(function(a,b){ return (b.visit_uv||0) - (a.visit_uv||0); });
          var dateLabel = fmtDate(dInt);

          var dSummary = trendsAll[dateIdx];
          var tv = dSummary ? fmt.int(dSummary[1]) : "—";
          var tc = dSummary ? fmt.int(dSummary[2]) : "—";
          var td = dSummary ? fmt.int(dSummary[3]) : "—";

          var html = '<div style="font-weight:700;margin-bottom:6px;font-size:12px">📅 ' + dateLabel + '</div>';
          html += '<table style="border-spacing:0 1px;font-size:11px;width:100%">';
          var TH = 'text-align:right;font-size:10px;color:#9CA3AF;font-weight:400;width:58px;padding-bottom:2px';
          html += '<tr><td style="width:16px"></td><td></td>';
          html += '<td style="' + TH + '">进店</td>';
          html += '<td style="' + TH + '">加购</td>';
          html += '<td style="' + TH + '">成交</td></tr>';
          var T = 'text-align:right;font-weight:600;width:58px';
          html += '<tr><td style="width:16px"></td><td style="color:#6B7280;padding-bottom:4px">总计</td>';
          html += '<td style="' + T + ';color:#FF2442">' + tv + '</td>';
          html += '<td style="' + T + ';color:#F97316">' + tc + '</td>';
          html += '<td style="' + T + ';color:#EAB308">' + td + '</td></tr>';

          if (!notes.length) { html += '</table>'; return html; }

          var showCount = notes.length <= 8 ? notes.length : 5;
          html += '<tr><td colspan="5" style="padding:2px 0"><div style="border-top:1px dashed #E5E7EB"></div></td></tr>';
          for (var i = 0; i < showCount; i++) {
            var n = notes[i];
            var rank = i + 1;
            var clr = rank <= 10 ? DAILY_RED_PALETTE[rank - 1] : DAILY_REST_COLOR;
            var vv = fmt.int(n.visit_uv), cv = fmt.int(n.cart_uv), dv = fmt.int(n.deal_uv);
            html += '<tr>';
            html += '<td style="width:16px"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + clr + ';vertical-align:middle"></span></td>';
            html += '<td style="font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px" title="' + escapeHtml(n.creator || '') + '">' + escapeHtml(n.creator || '—') + '</td>';
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
            html += '<td style="color:#9CA3AF;font-size:10px">等 ' + (notes.length - showCount) + ' 篇</td>';
            html += '<td style="text-align:right;color:#9CA3AF;font-size:10px">' + fmt.int(restTotal) + '</td>';
            html += '<td style="text-align:right;color:#9CA3AF;font-size:10px">' + fmt.int(restCart) + '</td>';
            html += '<td style="text-align:right;color:#9CA3AF;font-size:10px">' + fmt.int(restDeal) + '</td></tr>';
          }
          html += '</table>';
          html += '<div style="margin-top:4px;font-size:10px;color:#9CA3AF;text-align:center">💡 点击柱子展开全部笔记明细</div>';
          return html;
        },
      },
      legend: { show: false },
      grid: { top: 28, left: 56, right: 20, bottom: zoomOpt.length ? 50 : 40 },
      dataZoom: zoomOpt,
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
    }, true);

    dailyOverviewChart.resize();
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

  function initDailyToggles() {
    document.querySelectorAll(".metric-toggle").forEach(function(btn){
      btn.addEventListener("click", function(){
        this.classList.toggle("active");
        var metric = this.dataset.metric;
        if (this.classList.contains("active")) {
          DAILY_ACTIVE_METRICS.add(metric);
        } else {
          DAILY_ACTIVE_METRICS.delete(metric);
        }
        // Ensure at least one active
        if (!DAILY_ACTIVE_METRICS.size) {
          this.classList.add("active");
          DAILY_ACTIVE_METRICS.add(metric);
          return;
        }
        renderDailyOverview();
      });
    });
  }

  function expandDailyNotes(dateInt) {
    var dailyNotes = DATA.daily_notes || {};
    var notes = (dailyNotes[dateInt] || []).slice();
    notes.sort(function(a,b){ return (b.visit_uv||0) - (a.visit_uv||0); });
    var panel = document.getElementById("dailyDetailPanel");
    var title = document.getElementById("dailyDetailTitle");
    var thead = document.getElementById("dailyDetailHead");
    var tbody = document.getElementById("dailyDetailBody");

    title.textContent = fmtDate(dateInt) + " 笔记明细（共 " + notes.length + " 篇）";
    thead.innerHTML = '<tr><th style="width:40px">#</th><th>达人</th><th>笔记ID</th><th>进店UV</th><th>加购UV</th><th>成交UV</th></tr>';

    tbody.innerHTML = notes.map(function(n, i){
      var rank = i + 1;
      var clr = rank <= 10 ? colorForRank(rank) : DAILY_REST_COLOR;
      return '<tr class="daily-detail-row-note" data-nid="' + escapeHtml(n.note_id) + '">' +
        '<td><span class="daily-rank-badge" style="background:' + clr + ';color:#fff">' + rank + '</span></td>' +
        '<td>' + escapeHtml(n.creator || "—") + '</td>' +
        '<td class="mono-id">' + escapeHtml(n.note_id) + '</td>' +
        '<td>' + fmt.int(n.visit_uv) + '</td>' +
        '<td>' + fmt.int(n.cart_uv) + '</td>' +
        '<td>' + fmt.int(n.deal_uv) + '</td></tr>';
    }).join("");

    // Click note row → link to chart 2 (single note trend)
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

  // ---------- 全局响应 ----------
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
  initDailyToggles();
  renderDailyOverview();
  renderTrendModule();
  renderCostModule();
})();
