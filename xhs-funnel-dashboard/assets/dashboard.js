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

  function updateToggleCards(containerId, valMap) {
    document.querySelectorAll("#" + containerId + " .metric-toggle-card").forEach(function(btn){
      var m = btn.dataset.metric;
      var el = btn.querySelector("[data-slot=val]");
      if (el && valMap[m] != null) el.textContent = valMap[m];
    });
  }

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
    _push("table");
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
      // 下拉选项保持规范统一：日期 | 笔记ID | 达人，不加任何状态标注（无数据提示在选中后的详情页占位展示）
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
      { l: "总投入（薯条+聚光）", v: fmt.money(s.total_spend), u: "元", sub: "薯条 " + fmt.money(s.total_chili_spend) + " · 聚光 " + fmt.money(s.total_juguang_spend) },
      { l: '总 GMV <span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单如果有多条笔记共同贡献，该订单GMV会被重复计入每条笔记，因此加总后的GMV高于实际成交额。">≈ 参考值</span>', v: fmt.money(s.total_gmv), u: "元", sub: "⚠ 多内容归因存在重复计算", range: m.star_period, rangeTip: "星河数据周期", approx: true },
      { l: '整体 ROI <span class="gmv-approx" data-tip="ROI使用薯条或聚光与星河同时命中的笔记，从每篇首个付费日开始并截止星河最新日。因GMV含多内容归因重复，该ROI仅作相对比较。">≈ 参考值</span>', v: s.overall_roi == null ? "—" : Number(s.overall_roi).toFixed(2), u: "", sub: "同样本 " + fmt.int(s.matched_note_count || 0) + " 篇 · GMV / 有效合计成本", approx: true },
      { l: "笔记数", v: fmt.int(s.note_count), u: "篇", sub: "薯条 " + fmt.int(s.chili_note_count) + " · 聚光 " + fmt.int(s.juguang_note_count) + " · 双投 " + fmt.int(s.both_note_count) },
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
  /** 数据源状态条（平台化）：keys = 该平台的数据表键；containerId = 平台页内容器 */
  function renderSources(keys, containerId) {
    const src = DATA.meta.sources || {};
    const cards = keys.map(k => {
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
    // 数据质量提示仅小红书（五表口径）
    let qualityHtml = "";
    if (containerId === "sourceStrip") {
      const quality = [];
      if ((DATA.summary.funnel_violation_count || 0) > 0) {
        quality.push(DATA.summary.funnel_violation_count + "篇成交UV高于加购UV，请结合星河归因链路判断");
      }
      if ((DATA.meta.latest_data_gap_days || 0) > 0) {
        quality.push("投放数据比星河晚" + DATA.meta.latest_data_gap_days + "天，等待归因金额 ¥" + fmt.money(DATA.summary.waiting_attribution_spend || 0));
      }
      if ((DATA.summary.unmatched_paid_spend || 0) > 0) {
        quality.push(fmt.int(DATA.summary.unmatched_paid_count || 0) + "篇付费笔记未命中星河，¥" + fmt.money(DATA.summary.unmatched_paid_spend) + "未进入ROI和成本");
      }
      const jg = src.juguang || {};
      if (jg.loaded && jg.summary_diff != null && Math.abs(Number(jg.summary_diff)) >= 0.005) {
        quality.push("聚光汇总行与逐日明细相差 ¥" + Math.abs(Number(jg.summary_diff)).toFixed(2) + "，已按逐日明细求和");
      }
      if (jg.loaded && (jg.invalid_spend || 0) > 0) {
        quality.push("聚光有 ¥" + Number(jg.invalid_spend).toFixed(2) + " 无法关联有效笔记ID，已排除");
      }
      if (!(src.chili && src.chili.loaded) || !(src.juguang && src.juguang.loaded)) {
        quality.push("总投入仅包含已上传渠道，当前成本口径不完整");
      }
      qualityHtml = quality.length
        ? '<div class="data-quality-note"><strong>数据质量提示</strong><span>' + quality.join("；") + "</span></div>"
        : "";
    } else if (containerId === "biliSourceStrip") {
      const bm = (DATA.bilibili && DATA.bilibili.meta) || {};
      const quality = [];
      if ((bm.excluded_after_cutoff_spend || 0) > 0) {
        quality.push("成本按星河最新日期 " + fmtDate(bm.effective_end) + " 截止；其后 ¥" +
          Number(bm.excluded_after_cutoff_spend).toFixed(2) + " 花费等待星河回补");
      }
      if ((bm.unmatched_spend || 0) > 0) {
        quality.push("有 ¥" + Number(bm.unmatched_spend).toFixed(2) + " 花费未匹配到星河BV号，已排除");
      }
      if ((bm.invalid_id_spend || 0) > 0) {
        quality.push("有 ¥" + Number(bm.invalid_id_spend).toFixed(2) + " 花费缺少有效BV号，已排除");
      }
      if ((bm.unmatched_trilan_spend || 0) > 0) {
        quality.push("三联有 ¥" + Number(bm.unmatched_trilan_spend).toFixed(2) + " 未命中星河BVID，已排除");
      }
      if ((bm.unmatched_bihuo_spend || 0) > 0) {
        quality.push("必火有 ¥" + Number(bm.unmatched_bihuo_spend).toFixed(2) + " 昵称未命中星河，已排除");
      }
      if ((bm.ambiguous_bihuo_spend || 0) > 0) {
        quality.push("必火有 ¥" + Number(bm.ambiguous_bihuo_spend).toFixed(2) + " 昵称对应多个BVID，已排除");
      }
      if ((bm.funnel_violation_count || 0) > 0) {
        quality.push(bm.funnel_violation_count + " 条日记录成交UV高于加购UV，请结合15天归因链路判断");
      }
      qualityHtml = quality.length
        ? '<div class="data-quality-note"><strong>数据质量提示</strong><span>' + quality.join("；") + "</span></div>"
        : "";
    }
    document.getElementById(containerId).innerHTML = cards + qualityHtml;
  }

  // ===== 图表底部数据来源 =====
  function sourceInfo(key) {
    const sources = (DATA.meta && DATA.meta.sources) || {};
    return sources[key] || { name: key, loaded: false, path: "", period: "" };
  }

  function sourcePaths(key) {
    const source = sourceInfo(key);
    if (!source.loaded || !source.path) return [];
    return String(source.path).split(" · ").map(function(path) {
      return path.trim();
    }).filter(Boolean);
  }

  function relativeSourcePath(path) {
    const normalized = String(path || "").replace(/\//g, "\\");
    const marker = "数据看板文件\\";
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length);
    const parts = normalized.split("\\");
    return parts[parts.length - 1] || normalized;
  }

  function sourceRole(key, role) {
    const source = sourceInfo(key);
    return source.loaded
      ? escapeHtml(source.name || key) + "（" + escapeHtml(role) + "）"
      : escapeHtml(source.name || key) + "（未上传）";
  }

  function sourceFileRow(key, label) {
    const source = sourceInfo(key);
    const paths = sourcePaths(key);
    const period = source.loaded && source.period
      ? '<span class="source-note-period">' + escapeHtml(source.period) + "</span>"
      : "";
    const files = paths.length
      ? paths.map(function(path) {
          return '<code class="source-note-path" title="' + escapeHtml(path) + '">' +
            escapeHtml(relativeSourcePath(path)) + "</code>";
        }).join('<span class="source-note-sep">；</span>')
      : '<span class="source-note-missing">' + escapeHtml(source.reason || "未上传") + "</span>";
    return '<div class="source-note-row" data-source-key="' + escapeHtml(key) + '">' +
      '<span class="source-note-label">' + escapeHtml(label) + "</span>" +
      '<span class="source-note-files">' + files + period + "</span>" +
      "</div>";
  }

  function sourceDisclosure(content) {
    return '<details class="source-note-disclosure">' +
      '<summary>数据来源</summary>' +
      '<div class="source-note-expanded">' + content + "</div>" +
      "</details>";
  }

  function renderSourceNotes() {
    const daily = document.getElementById("dailySourceNote");
    const trend = document.getElementById("trendSourceNote");
    const cost = document.getElementById("costSourceNote");
    const table = document.getElementById("tableSourceNote");
    const biliDaily = document.getElementById("biliDailySourceNote");
    const biliTrend = document.getElementById("biliTrendSourceNote");
    const biliCost = document.getElementById("biliCostSourceNote");

    if (daily) {
      daily.innerHTML = sourceDisclosure(
        '<div class="source-note-summary">' + sourceRole("star", "日维度阅读与转化指标") + "</div>" +
        '<div class="source-note-detail">指标口径：阅读、进店、加购、成交数据均采用星河“全部流量 · 归因30天”。</div>' +
        sourceFileRow("star", "文件路径")
      );
    }

    if (trend) {
      trend.innerHTML = sourceDisclosure(
        '<div class="source-note-summary">' +
        sourceRole("star", "趋势与转化指标") + " + " + sourceRole("pgy", "发布日期、达人信息") + "</div>" +
        sourceFileRow("star", "星河文件") + sourceFileRow("pgy", "蒲公英文件")
      );
    }

    if (cost) {
      cost.innerHTML = sourceDisclosure(
        '<div class="source-note-summary">' +
        sourceRole("chili", "实际支付、启动日") + " + " + sourceRole("juguang", "实际消耗、自然日") + " + " + sourceRole("star", "阅读及转化UV") + "</div>" +
        '<div class="source-note-detail">辅助信息：蒲公英提供发布日期和达人信息。</div>' +
        sourceFileRow("chili", "薯条文件") + sourceFileRow("juguang", "聚光文件") + sourceFileRow("star", "星河文件") + sourceFileRow("pgy", "蒲公英文件")
      );
    }

    if (table) {
      const tableKeys = ["pgy", "star", "chili", "juguang", "lx"];
      const fileCount = tableKeys.reduce(function(total, key) {
        return total + sourcePaths(key).length;
      }, 0);
      table.innerHTML = sourceDisclosure(
        '<div class="source-note-summary">' +
        sourceRole("pgy", "内容表现") + " + " + sourceRole("star", "后端转化") + " + " +
        sourceRole("chili", "薯条成本") + " + " + sourceRole("juguang", "聚光成本") + " + " + sourceRole("lx", "人群资产") + "</div>" +
        '<div class="source-note-detail">投放汇总由薯条与聚光相加；当前共使用 ' + fileCount + " 份小红书数据文件。</div>" +
        sourceFileRow("pgy", "蒲公英") + sourceFileRow("star", "淘宝星河") +
        sourceFileRow("chili", "薯条") + sourceFileRow("juguang", "聚光") + sourceFileRow("lx", "灵犀")
      );
    }

    if (biliDaily) {
      biliDaily.innerHTML = sourceDisclosure(
        '<div class="source-note-summary">' + sourceRole("bili", "日维度播放与转化指标") + "</div>" +
        '<div class="source-note-detail">指标口径：播放、进店、加购、成交均采用B站星河“全部流量 · 归因15天”。</div>' +
        sourceFileRow("bili", "B站星河文件")
      );
    }
    if (biliTrend) {
      biliTrend.innerHTML = sourceDisclosure(
        '<div class="source-note-summary">' + sourceRole("bili", "单篇趋势与转化指标") + "</div>" +
        sourceFileRow("bili", "B站星河文件")
      );
    }
    if (biliCost) {
      const bm = (DATA.bilibili && DATA.bilibili.meta) || {};
      biliCost.innerHTML = sourceDisclosure(
        '<div class="source-note-summary">' + sourceRole("bili_fire", "必火订单消耗") + " + " +
        sourceRole("bili_ads", "三联逐日花费") + " + " + sourceRole("bili", "播放及转化UV") + "</div>" +
        '<div class="source-note-detail">有效成本周期：' + escapeHtml(bm.effective_period || "—") +
        '；必火整单按推广开始日归集，每条视频从首个付费日开始，统一截止星河最新日。</div>' +
        sourceFileRow("bili_fire", "必火文件") + sourceFileRow("bili_ads", "三联文件") + sourceFileRow("bili", "B站星河文件")
      );
    }
  }

  // ===== 图表一 · 单篇趋势分析 =====
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

  // ===== 平台页切换（小红书 / 抖音 / B站） =====
  const PLATFORMS = {
    xhs:  { pageId: "page-xhs",  tocId: "tocSub-xhs",  charts: ["dailyOverviewChart", "trendChart", "costChart"], title: "小红书投放数据看板" },
    dy:   { pageId: "page-dy",   tocId: "tocSub-dy",   charts: [], title: "抖音投放数据看板" },
    bili: { pageId: "page-bili", tocId: "tocSub-bili", charts: ["biliDailyOverviewChart", "biliTrendChart", "biliCostChart"], title: "B站投放数据看板" },
  };
  let currentPlatform = "xhs";

  function chartInstance(id) {
    if (id === "dailyOverviewChart") return dailyOverviewChart;
    if (id === "trendChart") return trendChart;
    if (id === "costChart") return costChart;
    if (id === "biliDailyOverviewChart") return biliDailyOverviewChart;
    if (id === "biliTrendChart") return biliTrendChart;
    if (id === "biliCostChart") return biliCostChart;
    return null;
  }

  function switchPlatform(p) {
    if (!PLATFORMS[p]) return;
    currentPlatform = p;
    const cfg = PLATFORMS[p];
    Object.keys(PLATFORMS).forEach(function (k) {
      const c = PLATFORMS[k];
      const group = document.querySelector('.platform-group[data-platform="' + k + '"]');
      const button = group && group.querySelector(".platform-group-toggle");
      const isActive = k === p;
      document.getElementById(c.pageId).hidden = (k !== p);
      document.getElementById(c.tocId).hidden = !isActive;
      if (group) group.classList.toggle("active", isActive);
      if (button) {
        button.setAttribute("aria-expanded", String(isActive));
        const chevron = button.querySelector(".platform-chevron");
        if (chevron) chevron.textContent = isActive ? "⌃" : "⌄";
      }
    });
    document.title = cfg.title + " · 投放数据看板";
    // 图表在 hidden 容器里初始化为 0 尺寸，切回后必须 resize
    setTimeout(function () {
      cfg.charts.forEach(function (id) {
        const c = chartInstance(id);
        if (c && c.resize) c.resize();
      });
    }, 80);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function initToc() {
    var toc = document.getElementById("toc");
    if (!toc.querySelectorAll(".toc-item").length) return;

    // 当前平台的子目录项/目标（hidden 平台不参与）
    function currentItems() {
      return Array.from(toc.querySelectorAll(".toc-sub:not([hidden]) .toc-item"));
    }
    function currentTargets() {
      return currentItems().map(function (item) {
        return document.getElementById(item.dataset.target);
      }).filter(Boolean);
    }
    // ---- 平台分组切换 ----
    document.querySelectorAll(".platform-group-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const p = Object.keys(PLATFORMS).find(function (k) { return PLATFORMS[k].pageId === btn.dataset.page; });
        if (p) switchPlatform(p);
      });
    });

    // ---- click to scroll（委托，动态取当前平台 items）----
    var scrollLock = 0;
    toc.addEventListener("click", function (e) {
      const item = e.target.closest(".toc-item");
      if (!item) return;
      e.preventDefault();
      const target = document.getElementById(item.dataset.target);
      if (!target) return;
      // Highlight immediately on click
      currentItems().forEach(function (it) { it.classList.remove("active"); });
      item.classList.add("active");
      scrollLock = Date.now();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { scrollLock = 0; }, 900);
    });

    // ---- scroll spy（只 spy 当前平台的模块）----
    function syncActive() {
      if (scrollLock && Date.now() - scrollLock < 900) return;
      const items = currentItems(), targets = currentTargets();
      if (!targets.length) return;
      var bestId = null, closest = Infinity;
      for (var i = 0; i < targets.length; i++) {
        const top = targets[i].getBoundingClientRect().top;
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

  // 图表二折线：可切换 阅读/进店/加购/成交，默认仅进店；阅读UV量级大走右轴
  const TREND_METRICS = {
    read:  { label: "阅读UV", col: 5, color: "#CC3300", avg: true },
    visit: { label: "进店UV", col: 1, color: "#FF2442", avg: true },
    cart:  { label: "加购UV", col: 2, color: "#F97316", avg: true },
    deal:  { label: "成交UV", col: 3, color: "#EAB308", avg: true },
  };
  function activeTrendMetrics() {
    var a = [];
    document.querySelectorAll("#trendToggles .metric-toggle-card.active").forEach(function(b){ a.push(b.dataset.metric); });
    if (!a.length) a = ["visit"];
    return ["read", "visit", "cart", "deal"].filter(function(m){ return a.indexOf(m) >= 0; });
  }
  function buildTrendOption(rows, suffix) {
    var active = activeTrendMetrics();
    var useDual = active.indexOf("read") >= 0 && active.length > 1;
    var series = active.map(function(m){
      var mm = TREND_METRICS[m];
      var s = {
        name: mm.label + suffix, type: "line",
        data: rows.map(function(r){ return r[mm.col]; }),
        smooth: true, symbol: "circle", symbolSize: 5,
        yAxisIndex: (m === "read" && useDual) ? 1 : 0,
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
      { type: "value", name: "阅读UV", position: "right", show: useDual,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: useDual, color: "#CC3300", fontSize: 11,
          formatter: function(v){ return v >= 1000 ? (v/1000).toFixed(1)+"k" : v; } },
        nameTextStyle: { color: "#CC3300", fontWeight: 600 } },
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
    const trends = DATA.trends || {};
    const trendsAll = DATA.trends_all || [];
    const candidates = DATA.notes
      .filter(n => n.pub_date || n.creator)                     // 全量蒲公英笔记（排除灵犀空壳），无数据的在选中后详情页提示
      .sort((a, b) => (String(b.pub_date || "0").replace(/-/g, "") | 0) - (String(a.pub_date || "0").replace(/-/g, "") | 0));

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
        if (trendChart) { try { trendChart.dispose(); } catch (ignore) {} trendChart = null; }
        document.getElementById("trendChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">暂无汇总趋势数据</div>';
        return;
      }
      var trendModSub = document.querySelector("#modTrend .mod-sub");
      if (trendModSub) trendModSub.textContent = "全部笔记逐日汇总 · 进店 / 加购 / 成交 UV 趋势";
      const period = rows.length
        ? fmtDate(rows[0][0]) + " ~ " + fmtDate(rows[rows.length - 1][0])
        : "—";
      const totalVisit = rows.reduce((s, r) => s + (r[1] || 0), 0);
      const totalCart = rows.reduce((s, r) => s + (r[2] || 0), 0);
      const totalDeal = rows.reduce((s, r) => s + (r[3] || 0), 0);
      const totalGmv = rows.reduce((s, r) => s + (r[4] || 0), 0);
      const totalRead = rows.reduce((s, r) => s + (r[5] || 0), 0);
      const kpis = [
        { l: "总阅读UV（全部）", v: fmt.int(totalRead), u: "" },
        { l: "总进店UV（全部）", v: fmt.int(totalVisit), u: "" },
        { l: "总加购UV（全部）", v: fmt.int(totalCart), u: "" },
        { l: "总成交UV（全部）", v: fmt.int(totalDeal), u: "" },
        { l: '总GMV（全部）<span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单被多条笔记共同贡献时会重复计入，加总后高于实际成交额。">≈ 参考值</span>', v: fmt.money(totalGmv), u: "元", approx: true },
        { l: "笔记数", v: fmt.int(DATA.notes.length), u: "篇" },
      ];
      document.getElementById("trendKpis").innerHTML = kpis.map(k =>
        `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
          <div class="trend-kpi-label">${k.l}</div>
          <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
        </div>`
      ).join("");

      updateToggleCards("trendToggles", {
        read: fmt.int(totalRead),
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

    // ===== 单篇笔记模式 =====
    var trendModSub2 = document.querySelector("#modTrend .mod-sub");
    if (trendModSub2) trendModSub2.textContent = "逐日转化趋势 · hover 看进店率 / 加购率 / 转化率";
    const rows = (DATA.trends || {})[noteId] || [];
    const note = DATA.notes.find(n => n.note_id === noteId) || {};

    // 无趋势数据：详情页结构化占位（状态/原因/解决），避免误以为系统未加载
    if (!rows.length) {
      if (trendChart) { try { trendChart.dispose(); } catch (ignore) {} trendChart = null; }
      document.getElementById("trendChart").innerHTML =
        '<div class="nodata-card">' +
          '<div class="nodata-head"><span class="nodata-icon">⚠️</span><span class="nodata-title">该笔记暂无星河趋势数据</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-ok">已加载</span><span class="nodata-text">笔记已加载，可在「全链路数据」表格中查看</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-info">原因</span><span class="nodata-text">星河表尚未覆盖此笔记：新笔记归因数据未出，或星河表未更新到该日期</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-act">解决</span><span class="nodata-text">星河表更新后重新生成看板，数据将自动补全</span></div>' +
        '</div>';
      document.getElementById("trendKpis").innerHTML = "";
      var modSubEmpty = document.querySelector("#modTrend .mod-sub");
      if (modSubEmpty) modSubEmpty.textContent = "该笔记暂无趋势数据";
      return;
    }

    const period = rows.length
      ? fmtDate(rows[0][0]) + " ~ " + fmtDate(rows[rows.length - 1][0])
      : "—";

    // 计算复合指标
    // 阅读/进店/加购/成交业务漏斗统一采用淘宝星河UV。
    const readUv = note.read_uv_funnel || 0;
    const visitUv = note.visit_uv || 0;
    const cartUv = note.cart_uv || 0;
    const dealUv = note.deal_uv || 0;
    const gmv = note.gmv || 0;
    const visitRate = readUv > 0 ? (visitUv / readUv * 100) : null;
    const cartRate = visitUv > 0 ? (cartUv / visitUv * 100) : null;
    const dealRate = visitUv > 0 ? (dealUv / visitUv * 100) : null;
    const uvValue = visitUv > 0 ? (gmv / visitUv) : null;

    // 与本期所有有效笔记的算术平均转化率比较，避免无分母笔记稀释均值。
    function averageRate(key) {
      const values = (DATA.notes || [])
        .map(n => n[key])
        .filter(v => typeof v === "number" && Number.isFinite(v));
      return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length * 100 : null;
    }
    function rateCompare(current, average) {
      if (current == null) return { rate: null, average: average };
      if (average == null) return { rate: current, average: null, rateClass: "is-neutral" };
      const diff = current - average;
      const rateClass = Math.abs(diff) < 0.005 ? "is-neutral" : (diff > 0 ? "is-good" : "is-bad");
      return { rate: current, average: average, rateClass: rateClass };
    }

    const visitComp = rateCompare(visitRate, averageRate("visit_rate"));
    const cartComp = rateCompare(cartRate, averageRate("cart_rate"));
    const dealComp = rateCompare(dealRate, averageRate("deal_rate"));

    const kpis = [
      { l: "总阅读UV", v: fmt.int(readUv), rate: null, tip: "", u: "" },
      { l: "总进店UV", v: fmt.int(visitUv), rate: visitComp.rate, average: visitComp.average, rateClass: visitComp.rateClass, tip: "进店率 = 进店UV ÷ 阅读UV；平均率 = 本期有效笔记进店率的算术平均", u: "" },
      { l: "总加购UV", v: fmt.int(cartUv), rate: cartComp.rate, average: cartComp.average, rateClass: cartComp.rateClass, tip: "进店加购率 = 加购UV ÷ 进店UV；平均率 = 本期有效笔记加购率的算术平均", u: "" },
      { l: "总成交UV", v: fmt.int(dealUv), rate: dealComp.rate, average: dealComp.average, rateClass: dealComp.rateClass, tip: "进店转化率 = 成交UV ÷ 进店UV；平均率 = 本期有效笔记成交率的算术平均", u: "" },
      { l: '总GMV <span class="gmv-approx" data-tip="星河按内容维度统计GMV，同一笔订单被多条笔记共同贡献时会重复计入，数值高于实际成交额。">≈ 参考值</span>', v: fmt.money(gmv), rate: null, tip: "⚠ 多内容归因下含重复计算，非精确值", u: "元", approx: true },
      { l: 'UV价值 <span class="gmv-approx" data-tip="UV价值 = GMV ÷ 进店UV，因GMV含多内容归因重复，该值为近似参考。">≈ 参考值</span>', v: uvValue != null ? "¥" + uvValue.toFixed(2) : "—", rate: null, tip: "UV价值 = 总GMV ÷ 进店UV（GMV含归因重复）", u: "", approx: true },
    ];
    document.getElementById("trendKpis").innerHTML = kpis.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span>${k.rate != null ? '<span class="trend-kpi-rate ' + (k.rateClass || "") + '"> ' + k.rate.toFixed(2) + '%</span>' : ""}${k.average != null ? '<span class="trend-kpi-average">平均 ' + k.average.toFixed(2) + '%</span>' : ""}</div>
      </div>`
    ).join("");

    updateToggleCards("trendToggles", {
      read: fmt.int(readUv),
      visit: fmt.int(visitUv),
      cart: fmt.int(cartUv),
      deal: fmt.int(dealUv)
    });

    // 笔记发布日期（x 轴红字标注，与图表二一致）
    const pubDateRaw = note.pub_date ? note.pub_date : null;
    const pubDateStr = pubDateRaw ? fmtDate(pubDateRaw.replace(/-/g, "")) : null;

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
            return pubDateStr && value === pubDateStr ? "#FF2442" : C.muted;
          },
          rotate: dates.length > 40 ? 45 : 0,
        },
      },
      yAxis: opt.yAxis,
      series: opt.series,
    }, true);
    bindChartPanInteractions(trendChart, "trendPanHint");
  }

  // ===== B站（独立模块，B站粉蓝配色；不参与小红书五表联动） =====
  let biliDailyOverviewChart = null, biliTrendChart = null, biliCostChart = null;
  let biliTrendCombo = null, biliCostCombo = null;

  const BILI_TREND_METRICS = {
    play:  { label: "播放UV", col: 5, color: "#00AEEC", avg: true },
    visit: { label: "进店UV", col: 1, color: "#FB7299", avg: true },
    cart:  { label: "加购UV", col: 2, color: "#F97316", avg: true },
    deal:  { label: "成交UV", col: 3, color: "#EAB308", avg: true },
  };
  function biliActiveMetrics() {
    var a = [];
    document.querySelectorAll("#biliToggles .metric-toggle-card.active").forEach(function(b){ a.push(b.dataset.metric); });
    if (!a.length) a = ["visit"];
    return ["play", "visit", "cart", "deal"].filter(function(m){ return a.indexOf(m) >= 0; });
  }
  function buildBiliTrendOption(rows, suffix) {
    var active = biliActiveMetrics();
    var useDual = active.indexOf("play") >= 0 && active.length > 1;
    var series = active.map(function(m){
      var mm = BILI_TREND_METRICS[m];
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
  function initBiliToggles() {
    document.querySelectorAll("#biliToggles .metric-toggle-card").forEach(function(btn){
      btn.addEventListener("click", function(){
        this.classList.toggle("active");
        if (!document.querySelectorAll("#biliToggles .metric-toggle-card.active").length) {
          this.classList.add("active"); return;
        }
        renderBiliTrend(biliTrendCombo ? biliTrendCombo.currentId : null);
      });
    });
  }
  // ===== B站 页头 meta + 顶部 KPI =====
  function renderBiliMeta() {
    const b = DATA.bilibili || {};
    const m = b.meta || {};
    document.getElementById("biliPeriod").textContent = "数据周期：" + (m.period || "—");
    document.getElementById("biliFlow").textContent =
      "口径：" + (m.flow_type || "全部流量") + " / 归因 " + (m.attr_period || 15) + " 天";
    document.getElementById("biliGen").textContent = "生成于 " + (DATA.meta.generated || "");
  }

  function renderBiliKpis() {
    const b = DATA.bilibili || {};
    const rows = b.trends_all || [];
    if (!rows.length) return;
    const totalPlay = rows.reduce((s, r) => s + (r[5] || 0), 0);
    const totalVisit = rows.reduce((s, r) => s + (r[1] || 0), 0);
    const totalCart = rows.reduce((s, r) => s + (r[2] || 0), 0);
    const totalDeal = rows.reduce((s, r) => s + (r[3] || 0), 0);
    const totalGmv = rows.reduce((s, r) => s + (r[4] || 0), 0);
    const ca = b.cost_all && b.cost_all.summary;
    const kpi = ca ? [
      { l: "总花费（必火+三联）", v: fmt.money((b.meta && b.meta.source_spend) || ca.spend), u: "元", sub: "必火 " + fmt.money((b.meta && b.meta.source_bihuo_spend) || 0) + " · 三联 " + fmt.money((b.meta && b.meta.source_trilan_spend) || 0), range: (b.meta && b.meta.source_period) || "", rangeTip: "全量投放周期" },
      { l: '总 GMV <span class="gmv-approx" data-tip="B站按内容维度统计GMV，同一笔订单如果有多条内容共同贡献，该订单GMV会被重复计入每条内容，因此加总后的GMV高于实际成交额。">≈ 参考值</span>', v: fmt.money(totalGmv), u: "元", sub: "全部内容 · 多内容归因参考值", range: (b.meta && b.meta.period) || "", rangeTip: "星河数据周期", approx: true },
      { l: '整体 ROI <span class="gmv-approx" data-tip="ROI使用必火或三联与星河安全匹配的内容，从首个付费日开始并截止星河最新日。GMV存在多内容归因重复，仅作相对比较。">≈ 参考值</span>', v: ca.roi == null ? "—" : Number(ca.roi).toFixed(2), u: "", sub: "同样本 " + fmt.int(ca.note_count || 0) + " 条 · GMV / 有效成本", approx: true },
      { l: "视频数", v: fmt.int((b.notes || []).length), u: "条", sub: "必火 " + fmt.int((b.meta && b.meta.bihuo_note_count) || 0) + " · 三联 " + fmt.int((b.meta && b.meta.trilan_note_count) || 0) + " · 双投 " + fmt.int((b.meta && b.meta.both_note_count) || 0) },
    ] : [
      { l: "总播放UV", v: fmt.int(totalPlay), u: "", sub: "全部内容 · 播放口径", range: (b.meta && b.meta.period) || "", rangeTip: "数据周期" },
      { l: "总进店UV", v: fmt.int(totalVisit), u: "", sub: "播放 → 进店" },
      { l: "总加购UV", v: fmt.int(totalCart), u: "", sub: "进店 → 加购" },
      { l: '总 GMV <span class="gmv-approx" data-tip="B站按内容维度统计GMV，同一笔订单如果有多条内容共同贡献，该订单GMV会被重复计入每条内容，因此加总后的GMV高于实际成交额。">≈ 参考值</span>', v: fmt.money(totalGmv), u: "元", sub: "⚠ 多内容归因存在重复计算", approx: true },
    ];
    document.getElementById("biliKpiRow").innerHTML = kpi.map(k =>
      `<div class="kpi${k.approx ? " kpi-approx" : ""}">
        <div class="kpi-label">${k.l}${k.range ? `<span class="kpi-range" title="${k.rangeTip || ""}">${k.range}</span>` : ""}</div>
        <div class="kpi-val">${k.v}<span class="kpi-unit">${k.u}</span></div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ""}
      </div>`
    ).join("");
  }

  const BILI_DAILY_REST_COLOR = "#D1D5DB";
  const BILI_DAILY_METRICS = {
    play:  { label: "播放", key: "play_uv", idx: 5, axis: "播放UV", palette: ["#00AEEC","#25B9EF","#48C5F2","#6BD1F5","#8DDBF7","#A9E4F9","#BFEAFA","#D3F1FC","#E5F7FD","#F1FBFE"] },
    visit: { label: "进店", key: "visit_uv", idx: 1, axis: "进店/加购/成交 UV", palette: ["#FB7299","#FC87A7","#FC9BB5","#FDAFC3","#FDC1D0","#FED1DC","#FEDDE5","#FFE7EC","#FFF0F4","#FFF7F9"] },
    cart:  { label: "加购", key: "cart_uv", idx: 2, axis: "进店/加购/成交 UV", palette: ["#F97316","#FA8737","#FA9A55","#FBAD73","#FCC08F","#FCD0A9","#FDE0C2","#FEEAD5","#FEF3E7","#FFF9F2"] },
    deal:  { label: "成交", key: "deal_uv", idx: 3, axis: "进店/加购/成交 UV", palette: ["#EAB308","#EDBF2D","#F0CA50","#F3D573","#F5DF93","#F7E7AE","#F9EFC8","#FBF5DC","#FDF9EB","#FEFCF5"] },
  };

  function biliDailyActiveMetrics() {
    var active = [];
    document.querySelectorAll("#biliDailyToggles .metric-toggle-card.active").forEach(function(btn){
      active.push(btn.dataset.metric);
    });
    return active.length ? ["play", "visit", "cart", "deal"].filter(function(m){ return active.indexOf(m) >= 0; }) : ["visit"];
  }

  function initBiliDailyToggles() {
    document.querySelectorAll("#biliDailyToggles .metric-toggle-card").forEach(function(btn){
      btn.addEventListener("click", function(){
        this.classList.toggle("active");
        if (!document.querySelectorAll("#biliDailyToggles .metric-toggle-card.active").length) {
          this.classList.add("active"); return;
        }
        renderBiliDailyOverview();
      });
    });
  }

  function renderBiliDailyOverview() {
    var b = DATA.bilibili || {};
    var dailyNotes = b.daily_notes || {};
    var trendsAll = b.trends_all || [];
    var chartEl = document.getElementById("biliDailyOverviewChart");
    if (!trendsAll.length) {
      chartEl.innerHTML = '<div style="padding:80px;text-align:center;color:#9CA3AF">B站星河未加载，无法展示日维度数据</div>';
      return;
    }
    var active = biliDailyActiveMetrics();
    var useDual = active.indexOf("play") >= 0 && active.length > 1;
    var totals = { play: 0, visit: 0, cart: 0, deal: 0 };
    var noteIds = new Set();
    trendsAll.forEach(function(r){
      totals.play += r[5] || 0; totals.visit += r[1] || 0;
      totals.cart += r[2] || 0; totals.deal += r[3] || 0;
    });
    Object.keys(dailyNotes).forEach(function(d){
      (dailyNotes[d] || []).forEach(function(n){ noteIds.add(n.note_id); });
    });
    var kpis = [
      ["总播放UV", totals.play, ""], ["总进店UV", totals.visit, ""],
      ["总加购UV", totals.cart, ""], ["总成交UV", totals.deal, ""],
      ["有数据视频", noteIds.size, "条"],
    ];
    document.getElementById("biliDailyOverviewKpis").innerHTML = kpis.map(function(k){
      return '<div class="trend-kpi"><div class="trend-kpi-label">' + k[0] + '</div><div class="trend-kpi-val">' + fmt.int(k[1]) + '<span class="u"> ' + k[2] + '</span></div></div>';
    }).join("");
    updateToggleCards("biliDailyToggles", {
      play: fmt.int(totals.play), visit: fmt.int(totals.visit),
      cart: fmt.int(totals.cart), deal: fmt.int(totals.deal),
    });

    var dates = trendsAll.map(function(r){ return fmtDate(r[0]); });
    var dateInts = trendsAll.map(function(r){ return r[0]; });
    var series = [];
    active.forEach(function(metric){
      var conf = BILI_DAILY_METRICS[metric];
      var yAxisIndex = metric === "play" && useDual ? 1 : 0;
      var rankData = Array.from({length: 10}, function(){ return new Array(dateInts.length).fill(null); });
      var restData = new Array(dateInts.length).fill(null);
      dateInts.forEach(function(d, di){
        var items = (dailyNotes[d] || []).slice().sort(function(a, z){ return (z[conf.key] || 0) - (a[conf.key] || 0); });
        items.slice(0, 10).forEach(function(item, rank){ rankData[rank][di] = item[conf.key]; });
        if (items.length > 10) {
          var rest = items.slice(10).reduce(function(sum, item){ return sum + (item[conf.key] || 0); }, 0);
          restData[di] = rest || null;
        }
      });
      rankData.forEach(function(data, rank){
        series.push({ name: metric + "_Top" + (rank + 1), type: "bar", stack: metric + "_stack", yAxisIndex: yAxisIndex,
          data: data, color: conf.palette[rank], barMaxWidth: active.length > 1 ? 24 : 44,
          emphasis: { focus: "series" }, itemStyle: { borderWidth: 0 } });
      });
      series.push({ name: metric + "_rest", type: "bar", stack: metric + "_stack", yAxisIndex: yAxisIndex,
        data: restData, color: BILI_DAILY_REST_COLOR, barMaxWidth: active.length > 1 ? 24 : 44,
        emphasis: { focus: "series" }, itemStyle: { borderWidth: 0 } });
      var dailyTotals = trendsAll.map(function(r){ return r[conf.idx] || 0; });
      series.push({ name: metric + "_label", type: "bar", stack: metric + "_stack", yAxisIndex: yAxisIndex,
        data: new Array(dateInts.length).fill(null), color: "transparent", silent: true,
        barMaxWidth: active.length > 1 ? 24 : 44, itemStyle: { borderWidth: 0 },
        label: { show: true, position: "top", fontSize: 10, fontWeight: 700, color: conf.palette[0],
          formatter: function(p){ return fmt.int(dailyTotals[p.dataIndex]); } } });
    });

    if (!biliDailyOverviewChart) biliDailyOverviewChart = echarts.init(chartEl);
    biliDailyOverviewChart.off("click");
    biliDailyOverviewChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#fff", borderColor: C.border,
        textStyle: { color: C.text, fontSize: 12 }, extraCssText: "max-width:430px;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.10)",
        formatter: function(params){
          if (!params || !params.length) return "";
          var idx = params[0].dataIndex, d = dateInts[idx];
          var items = (dailyNotes[d] || []).slice().sort(function(a, z){ return (z.visit_uv || 0) - (a.visit_uv || 0); });
          var summary = trendsAll[idx] || [];
          var html = '<div style="font-weight:700;margin-bottom:6px">' + fmtDate(d) + '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(4,auto);gap:5px 14px;margin-bottom:6px;font-size:11px">' +
            '<span>播放 <b style="color:#00AEEC">' + fmt.int(summary[5]) + '</b></span>' +
            '<span>进店 <b style="color:#FB7299">' + fmt.int(summary[1]) + '</b></span>' +
            '<span>加购 <b style="color:#F97316">' + fmt.int(summary[2]) + '</b></span>' +
            '<span>成交 <b style="color:#EAB308">' + fmt.int(summary[3]) + '</b></span></div>';
          html += items.slice(0, 6).map(function(n, rank){
            return '<div style="display:grid;grid-template-columns:14px minmax(72px,1fr) repeat(4,48px);gap:5px;align-items:center;font-size:10px;line-height:1.8">' +
              '<i style="width:7px;height:7px;background:' + BILI_DAILY_METRICS.visit.palette[rank] + '"></i>' +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(n.creator || n.note_id) + '</span>' +
              '<b>' + fmt.int(n.play_uv) + '</b><b>' + fmt.int(n.visit_uv) + '</b><b>' + fmt.int(n.cart_uv) + '</b><b>' + fmt.int(n.deal_uv) + '</b></div>';
          }).join("");
          if (items.length > 6) html += '<div style="margin-top:4px;color:#9CA3AF;font-size:10px">其余 ' + (items.length - 6) + ' 条点击柱子展开</div>';
          return html;
        } },
      legend: { show: false }, grid: { top: 28, left: 56, right: useDual ? 56 : 20, bottom: 40 },
      dataZoom: buildInsideZoom(),
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: C.border } }, axisLabel: { fontSize: 11, color: C.muted, rotate: dates.length > 40 ? 45 : 0 } },
      yAxis: [
        { type: "value", name: useDual ? "进店/加购/成交 UV" : "UV", position: "left", axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 11 } },
        { type: "value", name: "播放UV", position: "right", show: useDual, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: useDual, color: "#00AEEC", fontSize: 11, formatter: function(v){ return v >= 1000 ? (v / 1000).toFixed(1) + "k" : v; } } },
      ],
      series: series,
    }, true);
    bindChartPanInteractions(biliDailyOverviewChart, "biliDailyPanHint");
    biliDailyOverviewChart.resize();
    biliDailyOverviewChart.on("click", function(params){
      if (params.componentType === "series" && params.seriesType === "bar" && params.dataIndex != null) {
        runConfirmedChartClick(biliDailyOverviewChart, function(){ expandBiliDailyNotes(dateInts[params.dataIndex]); });
      }
    });
    document.getElementById("biliDailyDetailPanel").hidden = true;
  }

  function expandBiliDailyNotes(dateInt) {
    var b = DATA.bilibili || {};
    var notes = ((b.daily_notes || {})[dateInt] || []).slice().sort(function(a, z){ return (z.visit_uv || 0) - (a.visit_uv || 0); });
    document.getElementById("biliDailyDetailTitle").textContent = fmtDate(dateInt) + " 视频明细（共 " + notes.length + " 条）";
    document.getElementById("biliDailyDetailHead").innerHTML = '<tr><th>#</th><th>达人</th><th>BV号</th><th>播放UV</th><th>进店UV</th><th>加购UV</th><th>成交UV</th></tr>';
    var body = document.getElementById("biliDailyDetailBody");
    body.innerHTML = notes.map(function(n, i){
      var color = i < 10 ? BILI_DAILY_METRICS.visit.palette[i] : BILI_DAILY_REST_COLOR;
      return '<tr class="daily-detail-row-note" data-nid="' + escapeHtml(n.note_id) + '"><td><span class="daily-rank-badge" style="background:' + color + ';color:#fff">' + (i + 1) + '</span></td>' +
        '<td>' + escapeHtml(n.creator || "—") + '</td><td class="mono-id">' + escapeHtml(n.note_id) + '</td>' +
        '<td>' + fmt.int(n.play_uv) + '</td><td>' + fmt.int(n.visit_uv) + '</td><td>' + fmt.int(n.cart_uv) + '</td><td>' + fmt.int(n.deal_uv) + '</td></tr>';
    }).join("");
    body.querySelectorAll(".daily-detail-row-note").forEach(function(row){
      row.addEventListener("click", function(){
        var nid = row.dataset.nid;
        if (biliTrendCombo && biliTrendCombo.selectById) biliTrendCombo.selectById(nid);
        if (biliCostCombo && biliCostCombo.selectById) biliCostCombo.selectById(nid);
        document.getElementById("modBiliTrend").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    var panel = document.getElementById("biliDailyDetailPanel");
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.getElementById("biliDailyDetailClose").addEventListener("click", function(){
    document.getElementById("biliDailyDetailPanel").hidden = true;
  });

  function renderBiliTrendModule() {
    const bili = DATA.bilibili;
    const trendsAll = (bili && bili.trends_all) || [];
    const notes = (bili && bili.notes) || [];
    // 候选列表：内容ID/达人 可搜；pub_date 用最早出现日期近似（B站表无发布日字段）
    const candidates = notes
      .map(n => ({ note_id: n.note_id, creator: n.creator, pub_date: String(n.first_date || "") }))
      .sort((a, b) => (String(b.pub_date || "0") | 0) - (String(a.pub_date || "0") | 0));

    biliTrendCombo = makeCombo({
      inputId: "biliTrendSearch", listId: "biliTrendList", candidates,
      filterKeys: ["note_id", "creator"],
      emptyPlaceholder: "（无趋势明细数据）",
      onSelect: function (noteId) { renderBiliTrend(noteId); },
      onClear: function () { renderBiliTrend(null); },
    });

    // 默认：无选中 → 展示全部内容汇总趋势
    if (trendsAll.length || candidates.length) {
      renderBiliTrend(null);
    } else {
      document.getElementById("biliTrendChart").innerHTML =
        '<div style="padding:80px;text-align:center;color:#9CA3AF">B站表未加载或无按日明细，无法绘制趋势</div>';
    }
  }

  /** renderBiliTrend(null) = 全部内容汇总；renderBiliTrend(noteId) = 单篇 */
  function renderBiliTrend(noteId) {
    if (biliTrendCombo) biliTrendCombo.currentId = noteId || null;
    const bili = DATA.bilibili || {};
    const trendsAll = bili.trends_all || [];

    if (!noteId) {
      // ===== B站 全部内容汇总模式 =====
      const rows = trendsAll;
      if (!rows.length) {
        if (biliTrendChart) { try { biliTrendChart.dispose(); } catch (ignore) {} biliTrendChart = null; }
        document.getElementById("biliTrendChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">暂无汇总趋势数据</div>';
        return;
      }
      var biliModSub = document.querySelector("#modBiliTrend .mod-sub");
      if (biliModSub) biliModSub.textContent = "全部内容逐日汇总 · 播放 / 进店 / 加购 / 成交 UV 趋势";
      const totalVisit = rows.reduce((s, r) => s + (r[1] || 0), 0);
      const totalCart = rows.reduce((s, r) => s + (r[2] || 0), 0);
      const totalDeal = rows.reduce((s, r) => s + (r[3] || 0), 0);
      const totalGmv = rows.reduce((s, r) => s + (r[4] || 0), 0);
      const totalPlay = rows.reduce((s, r) => s + (r[5] || 0), 0);
      const kpis = [
        { l: "总播放UV（全部）", v: fmt.int(totalPlay), u: "" },
        { l: "总进店UV（全部）", v: fmt.int(totalVisit), u: "" },
        { l: "总加购UV（全部）", v: fmt.int(totalCart), u: "" },
        { l: "总成交UV（全部）", v: fmt.int(totalDeal), u: "" },
        { l: '总GMV（全部）<span class="gmv-approx" data-tip="B站按内容维度统计GMV，同一笔订单被多条内容共同贡献时会重复计入，加总后高于实际成交额。">≈ 参考值</span>', v: fmt.money(totalGmv), u: "元", approx: true },
        { l: "内容数", v: fmt.int((bili.notes || []).length), u: "条" },
      ];
      document.getElementById("biliTrendKpis").innerHTML = kpis.map(k =>
        `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
          <div class="trend-kpi-label">${k.l}</div>
          <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
        </div>`
      ).join("");

      updateToggleCards("biliToggles", {
        play: fmt.int(totalPlay),
        visit: fmt.int(totalVisit),
        cart: fmt.int(totalCart),
        deal: fmt.int(totalDeal)
      });

      if (!biliTrendChart) biliTrendChart = echarts.init(document.getElementById("biliTrendChart"));
      const dates = rows.map(r => fmtDate(r[0]));
      const opt = buildBiliTrendOption(rows, "（全部）");
      biliTrendChart.setOption({
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
      bindChartPanInteractions(biliTrendChart, "biliTrendPanHint");
      return;
    }

    // ===== B站 单篇模式 =====
    var biliModSub2 = document.querySelector("#modBiliTrend .mod-sub");
    if (biliModSub2) biliModSub2.textContent = "逐日转化趋势 · hover 看进店率 / 加购率 / 转化率";
    const rows = (bili.trends || {})[noteId] || [];
    const note = (bili.notes || []).find(n => n.note_id === noteId) || {};

    // 无趋势数据：结构化占位
    if (!rows.length) {
      if (biliTrendChart) { try { biliTrendChart.dispose(); } catch (ignore) {} biliTrendChart = null; }
      document.getElementById("biliTrendChart").innerHTML =
        '<div class="nodata-card">' +
          '<div class="nodata-head"><span class="nodata-icon">⚠️</span><span class="nodata-title">该内容暂无趋势数据</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-ok">已加载</span><span class="nodata-text">内容已加载，可在数据源状态条确认</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-info">原因</span><span class="nodata-text">B站表尚未覆盖此内容：新内容归因数据未出，或 B站表未更新到该日期</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-act">解决</span><span class="nodata-text">B站表更新后重新生成看板，数据将自动补全</span></div>' +
        '</div>';
      document.getElementById("biliTrendKpis").innerHTML = "";
      var biliModSubEmpty = document.querySelector("#modBiliTrend .mod-sub");
      if (biliModSubEmpty) biliModSubEmpty.textContent = "该内容暂无趋势数据";
      return;
    }

    // 复合指标（漏斗口径：播放 → 进店 → 加购 → 成交，统一采用 B站 表 UV）
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
    function biliAverageRate(fn) {
      const values = (bili.notes || [])
        .map(fn)
        .filter(v => typeof v === "number" && Number.isFinite(v));
      return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length * 100 : null;
    }
    const bVisitAvg = biliAverageRate(n => (n.play_uv || 0) > 0 ? (n.visit_uv || 0) / (n.play_uv || 0) : null);
    const bCartAvg = biliAverageRate(n => (n.visit_uv || 0) > 0 ? (n.cart_uv || 0) / (n.visit_uv || 0) : null);
    const bDealAvg = biliAverageRate(n => (n.visit_uv || 0) > 0 ? (n.deal_uv || 0) / (n.visit_uv || 0) : null);

    function biliRateCompare(current, average) {
      if (current == null) return { rate: null, average: average };
      if (average == null) return { rate: current, average: null, rateClass: "is-neutral" };
      const diff = current - average;
      const rateClass = Math.abs(diff) < 0.005 ? "is-neutral" : (diff > 0 ? "is-good" : "is-bad");
      return { rate: current, average: average, rateClass: rateClass };
    }
    const bVisitComp = biliRateCompare(visitRate, bVisitAvg);
    const bCartComp = biliRateCompare(cartRate, bCartAvg);
    const bDealComp = biliRateCompare(dealRate, bDealAvg);

    const kpis = [
      { l: "总播放UV", v: fmt.int(playUv), rate: null, tip: "", u: "" },
      { l: "总进店UV", v: fmt.int(visitUv), rate: bVisitComp.rate, average: bVisitComp.average, rateClass: bVisitComp.rateClass, tip: "进店率 = 进店UV ÷ 播放UV；平均率 = 本期有效内容进店率的算术平均", u: "" },
      { l: "总加购UV", v: fmt.int(cartUv), rate: bCartComp.rate, average: bCartComp.average, rateClass: bCartComp.rateClass, tip: "进店加购率 = 加购UV ÷ 进店UV；平均率 = 本期有效内容加购率的算术平均", u: "" },
      { l: "总成交UV", v: fmt.int(dealUv), rate: bDealComp.rate, average: bDealComp.average, rateClass: bDealComp.rateClass, tip: "进店转化率 = 成交UV ÷ 进店UV；平均率 = 本期有效内容成交率的算术平均", u: "" },
      { l: '总GMV <span class="gmv-approx" data-tip="B站按内容维度统计GMV，同一笔订单被多条内容共同贡献时会重复计入，数值高于实际成交额。">≈ 参考值</span>', v: fmt.money(gmv), rate: null, tip: "⚠ 多内容归因下含重复计算，非精确值", u: "元", approx: true },
      { l: 'UV价值 <span class="gmv-approx" data-tip="UV价值 = GMV ÷ 进店UV，因GMV含多内容归因重复，该值为近似参考。">≈ 参考值</span>', v: uvValue != null ? "¥" + uvValue.toFixed(2) : "—", rate: null, tip: "UV价值 = 总GMV ÷ 进店UV（GMV含归因重复）", u: "", approx: true },
    ];
    document.getElementById("biliTrendKpis").innerHTML = kpis.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span>${k.rate != null ? '<span class="trend-kpi-rate ' + (k.rateClass || "") + '"> ' + k.rate.toFixed(2) + '%</span>' : ""}${k.average != null ? '<span class="trend-kpi-average">平均 ' + k.average.toFixed(2) + '%</span>' : ""}</div>
      </div>`
    ).join("");

    updateToggleCards("biliToggles", {
      play: fmt.int(playUv),
      visit: fmt.int(visitUv),
      cart: fmt.int(cartUv),
      deal: fmt.int(dealUv)
    });

    // 内容首次出现日期（x 轴粉字标注；B站表无发布日字段，用最早数据日期近似）
    const bFirstDateRaw = note.first_date ? note.first_date : null;
    const bFirstDateStr = bFirstDateRaw ? fmtDate(String(bFirstDateRaw)) : null;

    if (!biliTrendChart) biliTrendChart = echarts.init(document.getElementById("biliTrendChart"));
    const dates = rows.map(r => fmtDate(r[0]));
    const opt = buildBiliTrendOption(rows, "");
    biliTrendChart.setOption({
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
            return bFirstDateStr && value === bFirstDateStr ? "#E9567C" : C.muted;
          },
          rotate: dates.length > 40 ? 45 : 0,
        },
      },
      yAxis: opt.yAxis,
      series: opt.series,
    }, true);
    bindChartPanInteractions(biliTrendChart, "biliTrendPanHint");
  }

  // ===== B站 · 单篇成本分析 =====
  const BILI_COST_METRICS = {
    play:  { label: "播放成本", color: "#00AEEC" },
    visit: { label: "进店成本", color: "#FB7299" },
    cart:  { label: "加购成本", color: "#F97316" },
    deal:  { label: "成交成本", color: "#EAB308" },
  };

  function biliActiveCostMetrics() {
    var active = [];
    document.querySelectorAll("#biliCostToggles .metric-toggle-card.active").forEach(function(btn){ active.push(btn.dataset.metric); });
    if (!active.length) active = ["visit"];
    return ["play", "visit", "cart", "deal"].filter(function(m){ return active.indexOf(m) >= 0; });
  }

  function initBiliCostToggles() {
    document.querySelectorAll("#biliCostToggles .metric-toggle-card").forEach(function(btn){
      btn.addEventListener("click", function(){
        this.classList.toggle("active");
        if (!document.querySelectorAll("#biliCostToggles .metric-toggle-card.active").length) {
          this.classList.add("active"); return;
        }
        renderBiliCost(biliCostCombo ? biliCostCombo.currentId : null);
      });
    });
  }

  function biliCostChartOptions() {
    return {
      metricConfig: BILI_COST_METRICS,
      activeMetrics: biliActiveCostMetrics(),
      accentColor: "#FB7299", accentTop: "#FF9BBA",
      spendTitle: "每日花费（元）", dailySpendLabel: "当日花费",
      dateTag: "内容首个数据日", itemLabel: "投放视频", itemUnit: "条",
      averageSpendLabel: "条均花费", clickHint: "点击金额柱查看当天双渠道投放明细",
      channels: [
        { index: 8, label: "必火消耗", color: "#E9567C" },
        { index: 9, label: "三联花费", color: "#00AEEC" },
      ],
    };
  }

  function renderBiliCostChart(daily, uvIdxMap, isSummary, firstDateStr) {
    var chartEl = document.getElementById("biliCostChart");
    var metricCount = biliActiveCostMetrics().length;
    chartEl.style.height = (metricCount > 1 ? 188 + metricCount * 160 : 400) + "px";
    if (!biliCostChart) biliCostChart = echarts.init(chartEl);
    biliCostChart.setOption(buildCostChartOption(daily, uvIdxMap, isSummary, firstDateStr, biliCostChartOptions()), true);
    bindChartPanInteractions(biliCostChart, "biliCostPanHint");
    biliCostChart.resize();
  }

  function renderBiliCostModule() {
    var b = DATA.bilibili || {};
    var notes = (b.notes || []).slice().sort(function(a, z){ return Number(z.first_date || 0) - Number(a.first_date || 0); });
    var candidates = notes.map(function(n){ return { note_id: n.note_id, creator: n.creator, pub_date: String(n.first_date || "") }; });
    biliCostCombo = makeCombo({
      inputId: "biliCostSearch", listId: "biliCostList", candidates: candidates,
      filterKeys: ["note_id", "creator"], emptyPlaceholder: "（无双渠道成本数据）",
      onSelect: function(noteId){ renderBiliCost(noteId); },
      onClear: function(){ renderBiliCost(null); },
    });
    if (b.cost_all || candidates.length) renderBiliCost(null);
    else document.getElementById("biliCostChart").innerHTML = '<div style="padding:80px;text-align:center;color:#9CA3AF">必火与三联均未加载，无法展示成本分析</div>';
  }

  function biliCostCompare(value, average) {
    if (value == null || average == null) return { color: null, mean: null };
    var diff = Number(value) - Number(average);
    return {
      color: Math.abs(diff) < 0.005 ? "#9CA3AF" : (diff < 0 ? "#10B981" : "#EF4444"),
      mean: '<span style="color:#9CA3AF">均 ¥' + Number(average).toFixed(2) + '</span>',
    };
  }

  function renderBiliCost(noteId) {
    var b = DATA.bilibili || {};
    var costData = b.cost || {};
    var panel = document.getElementById("biliCostDetailPanel");
    if (panel) panel.hidden = true;
    var input = document.getElementById("biliCostSearch");
    if (noteId && input && !input.value.trim()) noteId = null;
    if (biliCostCombo) biliCostCombo.currentId = noteId || null;

    if (!noteId) {
      var ca = b.cost_all;
      if (!ca || !ca.daily || !ca.daily.length) {
        if (biliCostChart) { try { biliCostChart.dispose(); } catch (ignore) {} biliCostChart = null; }
        document.getElementById("biliCostKpis").innerHTML = "";
        document.getElementById("biliCostChart").innerHTML = '<div style="padding:80px;text-align:center;color:#9CA3AF">暂无星河有效窗口内的双渠道成本数据</div>';
        return;
      }
      var s = ca.summary || {}, daily = ca.daily || [];
      var playCost = s.play_uv > 0 ? s.spend / s.play_uv : null;
      var visitCost = s.visit_uv > 0 ? s.spend / s.visit_uv : null;
      var cartCost = s.cart_uv > 0 ? s.spend / s.cart_uv : null;
      var dealCost = s.deal_uv > 0 ? s.spend / s.deal_uv : null;
      document.querySelector("#modBiliCost .mod-sub").textContent = "全部投放视频汇总 · 必火+三联合计成本";
      var kpis = [
        { label: "有效累计花费", value: fmt.money(s.spend), unit: "元", sub: "必火 " + fmt.money(s.bihuo_spend) + " · 三联 " + fmt.money(s.trilan_spend) },
        { label: "播放UV成本", value: playCost == null ? "—" : "¥" + playCost.toFixed(2), unit: "" },
        { label: "进店UV成本", value: visitCost == null ? "—" : "¥" + visitCost.toFixed(2), unit: "" },
        { label: "加购成本", value: cartCost == null ? "—" : "¥" + cartCost.toFixed(2), unit: "" },
        { label: "成交成本", value: dealCost == null ? "—" : "¥" + dealCost.toFixed(2), unit: "" },
        { label: "合计投放天数", value: fmt.int(s.days), unit: "天", sub: "必火 " + fmt.int(s.bihuo_days) + " · 三联 " + fmt.int(s.trilan_days) },
      ];
      document.getElementById("biliCostKpis").innerHTML = kpis.map(function(k){
        return '<div class="trend-kpi"><div class="trend-kpi-label">' + k.label + '</div><div class="trend-kpi-val">' + k.value + '<span class="u"> ' + k.unit + '</span></div>' +
          (k.sub ? '<div class="trend-kpi-sub">' + k.sub + '</div>' : '') + '</div>';
      }).join("");
      updateToggleCards("biliCostToggles", {
        play: playCost == null ? "—" : "¥" + playCost.toFixed(2),
        visit: visitCost == null ? "—" : "¥" + visitCost.toFixed(2),
        cart: cartCost == null ? "—" : "¥" + cartCost.toFixed(2),
        deal: dealCost == null ? "—" : "¥" + dealCost.toFixed(2),
      });
      renderBiliCostChart(daily, { play: 5, visit: 2, cart: 3, deal: 4 }, true, null);
      biliCostChart.off("click");
      biliCostChart.on("click", function(p){
        if (p.componentType === "series" && p.seriesType === "bar" && p.dataIndex != null) {
          runConfirmedChartClick(biliCostChart, function(){ expandBiliCostDailyNotes(daily[p.dataIndex][0]); });
        }
      });
      return;
    }

    var entry = costData[noteId];
    if (!entry) {
      if (biliCostChart) { try { biliCostChart.dispose(); } catch (ignore) {} biliCostChart = null; }
      document.getElementById("biliCostKpis").innerHTML = "";
      document.getElementById("biliCostChart").innerHTML = '<div class="nodata-card">' +
        '<div class="nodata-head"><span class="nodata-icon">!</span><span class="nodata-title">该视频暂无双渠道成本数据</span></div>' +
        '<div class="nodata-row"><span class="nodata-tag tag-ok">已加载</span><span class="nodata-text">视频已存在于B站星河数据</span></div>' +
        '<div class="nodata-row"><span class="nodata-tag tag-info">原因</span><span class="nodata-text">必火与三联均未覆盖该内容，或付费数据未能安全匹配星河</span></div>' +
        '<div class="nodata-row"><span class="nodata-tag tag-act">解决</span><span class="nodata-text">更新必火、三联和星河后重新生成看板</span></div></div>';
      document.querySelector("#modBiliCost .mod-sub").textContent = "该视频暂无双渠道成本数据";
      return;
    }

    var s = entry.summary || {}, daily = entry.daily || [];
    var all = (b.cost_all && b.cost_all.summary) || {};
    var averages = {
      play: all.play_uv > 0 ? all.spend / all.play_uv : null,
      visit: all.visit_uv > 0 ? all.spend / all.visit_uv : null,
      cart: all.cart_uv > 0 ? all.spend / all.cart_uv : null,
      deal: all.deal_uv > 0 ? all.spend / all.deal_uv : null,
    };
    var comps = {
      play: biliCostCompare(s.uv_cost, averages.play), visit: biliCostCompare(s.visit_uv_cost, averages.visit),
      cart: biliCostCompare(s.cart_cost, averages.cart), deal: biliCostCompare(s.deal_cost, averages.deal),
    };
    document.querySelector("#modBiliCost .mod-sub").textContent = "视频粒度双渠道合计成本 · 对比全部投放视频均值";
    var kpis = [
      { label: "有效累计花费", value: fmt.money(s.spend), unit: "元", sub: "必火 " + fmt.money(s.bihuo_spend) + " · 三联 " + fmt.money(s.trilan_spend) },
      { label: "播放UV成本", value: s.uv_cost == null ? "—" : "¥" + Number(s.uv_cost).toFixed(2), comp: comps.play },
      { label: "进店UV成本", value: s.visit_uv_cost == null ? "—" : "¥" + Number(s.visit_uv_cost).toFixed(2), comp: comps.visit },
      { label: "加购成本", value: s.cart_cost == null ? "—" : "¥" + Number(s.cart_cost).toFixed(2), comp: comps.cart },
      { label: "成交成本", value: s.deal_cost == null ? "—" : "¥" + Number(s.deal_cost).toFixed(2), comp: comps.deal },
      { label: "合计投放天数", value: fmt.int(s.days), unit: "天", sub: "必火 " + fmt.int(s.bihuo_days) + " · 三联 " + fmt.int(s.trilan_days) },
    ];
    document.getElementById("biliCostKpis").innerHTML = kpis.map(function(k){
      return '<div class="trend-kpi"><div class="trend-kpi-label">' + k.label + '</div><div class="trend-kpi-val"' +
        (k.comp && k.comp.color ? ' style="color:' + k.comp.color + '"' : '') + '>' + k.value +
        '<span class="u"> ' + (k.unit || "") + '</span></div>' +
        ((k.sub || (k.comp && k.comp.mean)) ? '<div class="trend-kpi-sub">' + (k.sub || k.comp.mean) + '</div>' : '') + '</div>';
    }).join("");
    updateToggleCards("biliCostToggles", {
      play: s.uv_cost == null ? "—" : "¥" + Number(s.uv_cost).toFixed(2),
      visit: s.visit_uv_cost == null ? "—" : "¥" + Number(s.visit_uv_cost).toFixed(2),
      cart: s.cart_cost == null ? "—" : "¥" + Number(s.cart_cost).toFixed(2),
      deal: s.deal_cost == null ? "—" : "¥" + Number(s.deal_cost).toFixed(2),
    });
    var note = (b.notes || []).find(function(n){ return n.note_id === noteId; }) || {};
    var firstDate = note.first_date ? fmtDate(note.first_date) : null;
    try {
      renderBiliCostChart(daily, { play: 6, visit: 2, cart: 3, deal: 4 }, false, firstDate);
      biliCostChart.off("click");
    } catch (error) {
      console.error("biliCostChart render error:", error);
      if (biliCostChart) { try { biliCostChart.dispose(); } catch (ignore) {} biliCostChart = null; }
      document.getElementById("biliCostChart").innerHTML = '<div style="padding:80px;text-align:center;color:#DC2626">图表渲染失败：' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  function expandBiliCostDailyNotes(dateInt) {
    var b = DATA.bilibili || {};
    var notes = (((b.cost_all || {}).daily_notes || {})[dateInt] || []).slice().sort(function(a, z){ return (z.spend || 0) - (a.spend || 0); });
    document.getElementById("biliCostDetailTitle").textContent = fmtDate(dateInt) + " 双渠道投放明细（共 " + notes.length + " 条）";
    document.getElementById("biliCostDetailHead").innerHTML = '<tr><th>#</th><th>达人</th><th>BV号</th><th>合计花费</th><th>必火消耗</th><th>三联花费</th></tr>';
    var body = document.getElementById("biliCostDetailBody");
    body.innerHTML = notes.map(function(n, i){
      var color = i < 10 ? BILI_DAILY_METRICS.visit.palette[i] : BILI_DAILY_REST_COLOR;
      return '<tr class="daily-detail-row-note" data-nid="' + escapeHtml(n.note_id) + '"><td><span class="daily-rank-badge" style="background:' + color + ';color:#fff">' + (i + 1) + '</span></td>' +
        '<td>' + escapeHtml(n.creator || "—") + '</td><td class="mono-id">' + escapeHtml(n.note_id) + '</td>' +
        '<td>' + fmt.money(n.spend) + '</td><td>' + fmt.money(n.bihuo_spend) + '</td><td>' + fmt.money(n.trilan_spend) + '</td></tr>';
    }).join("");
    body.querySelectorAll(".daily-detail-row-note").forEach(function(row){
      row.addEventListener("click", function(){
        if (biliCostCombo && biliCostCombo.selectById) biliCostCombo.selectById(row.dataset.nid);
        document.getElementById("modBiliCost").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    var panel = document.getElementById("biliCostDetailPanel");
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.getElementById("biliCostDetailClose").addEventListener("click", function(){
    document.getElementById("biliCostDetailPanel").hidden = true;
  });

  // ===== 小红书 · 单篇成本分析 =====
  let costChart = null, costCombo = null;

  // 图表三成本曲线：阅读/进店/加购/成交，默认仅进店；实线为3日滚动成本，灰虚线为累计成本基线
  const COST_METRICS = {
    read:  { label: "阅读成本", color: "#991B1B" },
    visit: { label: "进店成本", color: "#FF2442" },
    cart:  { label: "加购成本", color: "#E11D48" },
    deal:  { label: "成交成本", color: "#FB7185" },
  };
  function activeCostMetrics() {
    var a = [];
    document.querySelectorAll("#costToggles .metric-toggle-card.active").forEach(function(b){ a.push(b.dataset.metric); });
    if (!a.length) a = ["visit"];
    return ["read", "visit", "cart", "deal"].filter(function(m){ return a.indexOf(m) >= 0; });
  }
  function initCostToggles() {
    document.querySelectorAll("#costToggles .metric-toggle-card").forEach(function(btn){
      btn.addEventListener("click", function(){
        this.classList.toggle("active");
        if (!document.querySelectorAll("#costToggles .metric-toggle-card.active").length) {
          this.classList.add("active"); return;
        }
        renderCost(costCombo ? costCombo.currentId : null);
      });
    });
  }
  // 图表三 daily 已补齐自然日：实线=当前日及前2个自然日的滚动成本；灰虚线=截至当前日的累计成本。
  function costRatio(spend, uv) {
    var denominator = Number(uv) || 0;
    return denominator > 0 ? +(Number(spend || 0) / denominator).toFixed(4) : null;
  }

  function buildCostTrendData(daily, spendIdx, uvIdxMap, metrics) {
    metrics = metrics || activeCostMetrics();
    var spendPrefix = [0];
    daily.forEach(function(row){
      spendPrefix.push(spendPrefix[spendPrefix.length - 1] + (Number(row[spendIdx]) || 0));
    });
    var byMetric = {};
    metrics.forEach(function(metric){
      var uvIdx = uvIdxMap[metric];
      var uvPrefix = [0];
      daily.forEach(function(row){
        uvPrefix.push(uvPrefix[uvPrefix.length - 1] + (Number(row[uvIdx]) || 0));
      });
      byMetric[metric] = {
        daily: daily.map(function(row){ return costRatio(row[spendIdx], row[uvIdx]); }),
        rolling: daily.map(function(row, index){
          var start = Math.max(0, index - 2);
          return costRatio(spendPrefix[index + 1] - spendPrefix[start], uvPrefix[index + 1] - uvPrefix[start]);
        }),
        cumulative: daily.map(function(row, index){
          return costRatio(spendPrefix[index + 1], uvPrefix[index + 1]);
        }),
      };
    });
    return { metrics: metrics, byMetric: byMetric };
  }

  function formatCostValue(value) {
    return value == null || !isFinite(value) ? "—" : "¥" + Number(value).toFixed(2);
  }

  function buildCostTooltip(daily, trendData, isSummary, pubDateStr, options) {
    options = options || {};
    var metricConfig = options.metricConfig || COST_METRICS;
    var accentColor = options.accentColor || "#FF2442";
    return function(params) {
      if (!params || !params.length) return "";
      var index = params[0].dataIndex;
      var row = daily[index];
      if (!row) return "";
      var dateText = fmtDate(row[0]);
      var pubTag = !isSummary && pubDateStr && dateText === pubDateStr
        ? '<span style="color:' + accentColor + ';font-size:11px;font-weight:600">' + (options.dateTag || "笔记发布日期") + '</span>' : "";
      var spend = row[1] == null ? "—" : "¥" + Number(row[1]).toFixed(2);
      var summaryItems = [
        '<span style="color:#6B7280">' + (options.dailySpendLabel || "当日消耗") + '</span><b style="font-variant-numeric:tabular-nums">' + spend + "</b>"
      ];
      var channels = options.channels || [];
      channels.forEach(function(channel){
        summaryItems.push('<span style="color:#6B7280">' + channel.label + '</span><b style="color:' + channel.color + ';font-variant-numeric:tabular-nums">' + formatCostValue(row[channel.index]) + '</b>');
      });
      if (isSummary) {
        var noteCount = row[7] != null ? Number(row[7]) : 0;
        var avgSpend = noteCount > 0 && row[1] != null ? "¥" + (Number(row[1]) / noteCount).toFixed(2) : "—";
        summaryItems.push('<span style="color:#6B7280">' + (options.itemLabel || "投放笔记") + '</span><b>' + noteCount + " " + (options.itemUnit || "篇") + "</b>");
        summaryItems.push('<span style="color:#6B7280">' + (options.averageSpendLabel || "篇均消耗") + '</span><b style="font-variant-numeric:tabular-nums">' + avgSpend + "</b>");
      }
      var summaryHtml = '<div style="display:grid;grid-template-columns:repeat(' + Math.min(summaryItems.length, 3) + ',auto);gap:8px 18px;padding:9px 10px;background:#F7F7F8;border:1px solid #ECEDEF">'
        + summaryItems.map(function(item){ return '<div style="display:grid;gap:2px">' + item + "</div>"; }).join("") + "</div>";
      var isMultiMetric = trendData.metrics.length > 1;
      var metricContent;
      if (isMultiMetric) {
        var metricRows = trendData.metrics.map(function(metric){
          var conf = metricConfig[metric];
          var values = trendData.byMetric[metric];
          return '<tr>'
            + '<th style="padding:6px 8px;text-align:left;border-top:1px solid #ECEDEF;color:' + conf.color + ';font-weight:700;white-space:nowrap">'
            + '<span style="display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:2px;background:' + conf.color + ';vertical-align:1px"></span>' + conf.label + "</th>"
            + '<td style="padding:6px 8px;text-align:right;border-top:1px solid #ECEDEF;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">' + formatCostValue(values.daily[index]) + "</td>"
            + '<td style="padding:6px 8px;text-align:right;border-top:1px solid #ECEDEF;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">' + formatCostValue(values.rolling[index]) + "</td>"
            + '<td style="padding:6px 8px;text-align:right;border-top:1px solid #ECEDEF;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">' + formatCostValue(values.cumulative[index]) + "</td>"
            + "</tr>";
        }).join("");
        metricContent = '<div style="margin-top:6px;border:1px solid #ECEDEF;background:#fff;overflow:hidden">'
          + '<table style="width:100%;border-collapse:collapse;font-size:11px">'
          + '<thead><tr style="background:#F7F7F8;color:#6B7280">'
          + '<th style="padding:6px 8px;text-align:left;font-weight:600;white-space:nowrap">成本指标</th>'
          + '<th style="padding:6px 8px;text-align:right;font-weight:600;white-space:nowrap">当日成本</th>'
          + '<th style="padding:6px 8px;text-align:right;font-weight:600;white-space:nowrap">3日滚动</th>'
          + '<th style="padding:6px 8px;text-align:right;font-weight:600;white-space:nowrap">累计基线</th>'
          + "</tr></thead><tbody>" + metricRows + "</tbody></table></div>";
      } else {
        var metric = trendData.metrics[0];
        var conf = metricConfig[metric];
        var values = trendData.byMetric[metric];
        var rows = [
          ["当日", values.daily[index]],
          ["3日滚动", values.rolling[index]],
          ["累计基线", values.cumulative[index]],
        ];
        metricContent = '<div style="margin-top:8px;min-width:168px;padding:9px 10px;border:1px solid #ECEDEF;border-left:3px solid ' + conf.color + ';background:#fff">'
          + '<div style="margin-bottom:6px;color:' + conf.color + ';font-size:12px;font-weight:700">' + conf.label + "</div>"
          + rows.map(function(item){
              return '<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.8">'
                + '<span style="color:#6B7280;white-space:nowrap">' + item[0] + "</span>"
                + '<b style="font-variant-numeric:tabular-nums;white-space:nowrap">' + formatCostValue(item[1]) + "</b></div>";
            }).join("") + "</div>";
      }
      var clickHint = isSummary ? '<div style="margin-top:8px;font-size:10px;color:#9CA3AF;text-align:center">' + (options.clickHint || "点击每日实付柱查看当天投放明细") + '</div>' : "";
      return '<div style="' + (isMultiMetric ? 'width:400px;max-width:calc(100vw - 32px)' : 'min-width:230px;max-width:460px') + '">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:700">'
        + '<span>' + dateText + "</span>" + pubTag + "</div>" + summaryHtml
        + metricContent
        + clickHint + "</div>";
    };
  }

  function costXAxis(dates, gridIndex, showLabels, pubDateStr, accentColor) {
    return {
      type: "category", gridIndex: gridIndex, data: dates,
      axisLine: { lineStyle: { color: C.border } }, axisTick: { show: false },
      axisLabel: {
        show: showLabels, fontSize: 11, fontWeight: 600,
        color: function(value){ return pubDateStr && value === pubDateStr ? (accentColor || "#FF2442") : "#111827"; },
        rotate: dates.length > 40 ? 45 : 0,
      },
      axisPointer: { show: true, snap: true },
    };
  }

  function spendYAxis(gridIndex, accentColor) {
    return {
      type: "value", gridIndex: gridIndex, position: "left",
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { margin: 12, color: accentColor || "#FF2442", fontSize: 11, fontWeight: 600, formatter: function(v){ return v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v); } },
    };
  }

  function costYAxis(gridIndex, color, position) {
    return {
      type: "value", gridIndex: gridIndex, position: position || "left",
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { margin: 12, color: color, fontSize: 11, fontWeight: 600, formatter: function(v){ return "¥" + Number(v).toFixed(2); } },
    };
  }

  function rollingCostSeries(metric, data, xAxisIndex, yAxisIndex, metricConfig) {
    var conf = (metricConfig || COST_METRICS)[metric];
    return {
      name: conf.label + "（3日滚动）", type: "line",
      xAxisIndex: xAxisIndex, yAxisIndex: yAxisIndex, data: data,
      smooth: true, symbol: "none", connectNulls: false,
      lineStyle: { color: conf.color, width: 2.5, type: "solid" },
      itemStyle: { color: conf.color },
    };
  }

  function cumulativeCostSeries(metric, data, xAxisIndex, yAxisIndex, metricConfig) {
    var conf = (metricConfig || COST_METRICS)[metric];
    return {
      name: conf.label + "（累计基线）", type: "line",
      xAxisIndex: xAxisIndex, yAxisIndex: yAxisIndex, data: data,
      smooth: true, symbol: "none", connectNulls: false,
      lineStyle: { color: "#9CA3AF", width: 1.5, type: "dashed", opacity: 0.9 },
      itemStyle: { color: "#9CA3AF" },
    };
  }

  function buildCostChartOption(daily, uvIdxMap, isSummary, pubDateStr, options) {
    options = options || {};
    var metricConfig = options.metricConfig || COST_METRICS;
    var accentColor = options.accentColor || "#FF2442";
    var accentTop = options.accentTop || "#FF4D6A";
    var activeMetrics = options.activeMetrics || activeCostMetrics();
    var dates = daily.map(function(row){ return fmtDate(row[0]); });
    var spendVals = daily.map(function(row){ return row[1]; });
    var trendData = buildCostTrendData(daily, 1, uvIdxMap, activeMetrics);
    var multi = trendData.metrics.length > 1;
    var grids = [], xAxes = [], yAxes = [], series = [], titles = [];
    function addSpendSeries(xAxisIndex, yAxisIndex) {
      if (options.channels && options.channels.length) {
        options.channels.forEach(function(channel){
          series.push({
            name: channel.label, type: "bar", stack: "paid_spend", xAxisIndex: xAxisIndex, yAxisIndex: yAxisIndex,
            data: daily.map(function(row){ return row[channel.index] || 0; }),
            itemStyle: { color: channel.color }, barMaxWidth: 30,
          });
        });
      } else {
        series.push({
          name: isSummary ? "当日总实付" : "当日实付", type: "bar", xAxisIndex: xAxisIndex, yAxisIndex: yAxisIndex, data: spendVals,
          itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: accentTop }, { offset: 1, color: accentColor }
          ]) }, barMaxWidth: 30,
        });
      }
    }

    if (!multi) {
      var metric = trendData.metrics[0];
      grids.push({ top: 30, left: 88, right: 96, bottom: 52, containLabel: false });
      xAxes.push(costXAxis(dates, 0, true, pubDateStr, accentColor));
      yAxes.push(spendYAxis(0, accentColor));
      var singleCostAxis = costYAxis(0, metricConfig[metric].color, "right");
      singleCostAxis.splitLine = { show: false };
      yAxes.push(singleCostAxis);
      addSpendSeries(0, 0);
      series.push(rollingCostSeries(metric, trendData.byMetric[metric].rolling, 0, 1, metricConfig));
      series.push(cumulativeCostSeries(metric, trendData.byMetric[metric].cumulative, 0, 1, metricConfig));
    } else {
      grids.push({ top: 34, height: 92, left: 96, right: 48, containLabel: false });
      xAxes.push(costXAxis(dates, 0, false, pubDateStr, accentColor));
      yAxes.push(spendYAxis(0, accentColor));
      titles.push({ text: options.spendTitle || "每日实付（元）", left: 98, top: 6, textStyle: { color: accentColor, fontSize: 12, fontWeight: 700 } });
      addSpendSeries(0, 0);
      trendData.metrics.forEach(function(metric, index){
        var axisIndex = index + 1;
        var top = 166 + index * 160;
        grids.push({ top: top, height: 108, left: 96, right: 48, containLabel: false });
        xAxes.push(costXAxis(dates, axisIndex, index === trendData.metrics.length - 1, pubDateStr, accentColor));
        yAxes.push(costYAxis(axisIndex, metricConfig[metric].color, "left"));
        titles.push({ text: metricConfig[metric].label + "（元/UV）", left: 98, top: top - 28, textStyle: { color: metricConfig[metric].color, fontSize: 12, fontWeight: 700 } });
        series.push(rollingCostSeries(metric, trendData.byMetric[metric].rolling, axisIndex, axisIndex, metricConfig));
        series.push(cumulativeCostSeries(metric, trendData.byMetric[metric].cumulative, axisIndex, axisIndex, metricConfig));
      });
    }

    var zoom = buildInsideZoom();
    zoom[0].xAxisIndex = xAxes.map(function(axis, index){ return index; });
    return {
      backgroundColor: "transparent",
      title: titles,
      tooltip: {
        trigger: "axis", axisPointer: { type: "cross" },
        appendToBody: true, confine: false, enterable: false,
        backgroundColor: "#fff", borderColor: C.border, padding: 10,
        extraCssText: "box-shadow:0 10px 30px rgba(17,24,39,.12);border-radius:2px;",
        textStyle: { color: C.text, fontSize: 12 },
        formatter: buildCostTooltip(daily, trendData, isSummary, pubDateStr, {
          metricConfig: metricConfig, accentColor: accentColor, dateTag: options.dateTag,
          itemLabel: options.itemLabel, itemUnit: options.itemUnit,
          averageSpendLabel: options.averageSpendLabel, dailySpendLabel: options.dailySpendLabel,
          clickHint: options.clickHint, channels: options.channels,
        }),
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: grids, dataZoom: zoom, xAxis: xAxes, yAxis: yAxes, series: series,
    };
  }

  function renderCostChart(daily, uvIdxMap, isSummary, pubDateStr) {
    var chartEl = document.getElementById("costChart");
    var metricCount = activeCostMetrics().length;
    chartEl.style.height = (metricCount > 1 ? 188 + metricCount * 160 : 400) + "px";
    if (!costChart) costChart = echarts.init(chartEl);
    costChart.setOption(buildCostChartOption(daily, uvIdxMap, isSummary, pubDateStr, {
      metricConfig: COST_METRICS, activeMetrics: activeCostMetrics(),
      accentColor: "#FF2442", accentTop: "#FF6B82",
      spendTitle: "每日合计（元）", dailySpendLabel: "当日合计",
      itemLabel: "投放笔记", itemUnit: "篇", averageSpendLabel: "篇均合计",
      clickHint: "点击金额柱查看当天双渠道投放明细",
      channels: [
        { index: 8, label: "薯条实付", color: "#C8102E" },
        { index: 9, label: "聚光消耗", color: "#FF8FA3" },
      ],
    }), true);
    bindChartPanInteractions(costChart, "costPanHint");
    costChart.resize();
  }

  function renderCostModule() {
    const costData = DATA.cost || {};
    const costAll = DATA.cost_all;
    const candidates = DATA.notes
      .filter(n => n.pub_date || n.creator)                     // 全量蒲公英笔记（排除灵犀空壳），无数据的在选中后详情页提示
      .sort((a, b) => (String(b.pub_date || "0").replace(/-/g, "") | 0) - (String(a.pub_date || "0").replace(/-/g, "") | 0));

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
    // 每次重渲染先收起「当天投放明细」面板（仅汇总模式点柱后再展开）
    var _costDetailPanel = document.getElementById("costDetailPanel");
    if (_costDetailPanel) _costDetailPanel.hidden = true;
    // If user cleared the search input manually, force all-notes mode
    var costInp = document.getElementById("costSearch");
    if (noteId && costInp && !costInp.value.trim()) {
      noteId = null;
      if (costCombo) { costCombo.currentId = null; costCombo.keyword = ""; }
    }
    if (costCombo) costCombo.currentId = noteId || null;
    const costData = DATA.cost || {};

    if (!noteId) {
      console.log('[renderCost] → 汇总模式（!noteId）');
      // ===== 全部笔记汇总模式 =====
      const ca = DATA.cost_all;
      if (!ca || !ca.daily || !ca.daily.length) {
        if (costChart) { try { costChart.dispose(); } catch (ignore) {} costChart = null; }
        document.getElementById("costChart").innerHTML =
          '<div style="padding:80px;text-align:center;color:#9CA3AF">暂无消耗汇总数据</div>';
        return;
      }
      const s = ca.summary || {};
      const daily = ca.daily || [];
      // Average cost per UV type
      var avgVisitCost2 = s.visit_uv > 0 ? s.spend / s.visit_uv : null;
      var avgCartCost2 = s.cart_uv > 0 ? s.spend / s.cart_uv : null;
      var avgDealCost2 = s.deal_uv > 0 ? s.spend / s.deal_uv : null;
      // Update title bar to indicate all-notes mode
      var modSub = document.querySelector("#modCost .mod-sub");
      if (modSub) modSub.textContent = "全部付费笔记汇总 · 薯条+聚光合计成本趋势";
      const kpiItems = [
        { l: "有效累计消耗", v: fmt.money(s.spend), u: "元", rate: "薯条 " + fmt.money(s.chili_spend) + " · 聚光 " + fmt.money(s.juguang_spend) },
        { l: "阅读UV成本", v: s.read_uv > 0 ? "¥" + (s.spend / s.read_uv).toFixed(2) : "—", u: "" },
        { l: "进店UV成本", v: avgVisitCost2 != null ? "¥" + avgVisitCost2.toFixed(2) : "—", u: "" },
        { l: "加购成本", v: avgCartCost2 != null ? "¥" + avgCartCost2.toFixed(2) : "—", u: "" },
        { l: "成交成本", v: avgDealCost2 != null ? "¥" + avgDealCost2.toFixed(2) : "—", u: "" },
        { l: "合计投放天数", v: fmt.int(s.days), u: "天", rate: "薯条 " + fmt.int(s.chili_days) + " · 聚光 " + fmt.int(s.juguang_days) },
      ];
      document.getElementById("costKpis").innerHTML = kpiItems.map(k =>
        `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
          <div class="trend-kpi-label">${k.l}</div>
          <div class="trend-kpi-val">${k.v}<span class="u"> ${k.u}</span></div>
          ${k.rate ? '<div class="trend-kpi-sub">' + k.rate + '</div>' : ""}
        </div>`
      ).join("");

      var avgReadCost2 = s.read_uv > 0 ? s.spend / s.read_uv : null;
      updateToggleCards("costToggles", {
        read: avgReadCost2 != null ? "¥" + avgReadCost2.toFixed(2) : "—",
        visit: avgVisitCost2 != null ? "¥" + avgVisitCost2.toFixed(2) : "—",
        cart: avgCartCost2 != null ? "¥" + avgCartCost2.toFixed(2) : "—",
        deal: avgDealCost2 != null ? "¥" + avgDealCost2.toFixed(2) : "—"
      });

      renderCostChart(daily, { read: 5, visit: 2, cart: 3, deal: 4 }, true, null);
      // 汇总模式：点柱展开当天投放明细
      costChart.off("click");
      costChart.on("click", function (p) {
        if (p.componentType === "series" && p.seriesType === "bar") {
          var di2 = p.dataIndex;
          if (di2 != null && di2 >= 0 && di2 < daily.length) {
            runConfirmedChartClick(costChart, function () {
              expandCostDailyNotes(daily[di2][0]);
            });
          }
        }
      });
      return;
    }

    // ===== 单篇笔记模式 =====
    const entry = costData[noteId];
    if (!entry) {
      if (costChart) { try { costChart.dispose(); } catch (ignore) {} costChart = null; }
      document.getElementById("costChart").innerHTML =
        '<div class="nodata-card">' +
          '<div class="nodata-head"><span class="nodata-icon">⚠️</span><span class="nodata-title">该笔记暂无成本数据</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-ok">已加载</span><span class="nodata-text">笔记已加载，可在「全链路数据」表格中查看</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-info">原因</span><span class="nodata-text">薯条与聚光均未投放，或付费笔记未命中星河同样本</span></div>' +
          '<div class="nodata-row"><span class="nodata-tag tag-act">解决</span><span class="nodata-text">更新薯条、聚光与星河后重新生成看板</span></div>' +
        '</div>';
      // 清空指标卡，避免残留汇总数据
      document.getElementById("costKpis").innerHTML = "";
      var modSubCost = document.querySelector("#modCost .mod-sub");
      if (modSubCost) modSubCost.textContent = "该笔记暂无成本数据";
      return;
    }
    const s = entry.summary || {};
    const daily = entry.daily || [];

    // Overall averages for comparison (from cost_all summary)
    var caSummary = (DATA.cost_all || {}).summary || {};
    var avgReadCost = caSummary.read_uv > 0 ? caSummary.spend / caSummary.read_uv : null;
    var avgVisitCost = caSummary.visit_uv > 0 ? caSummary.spend / caSummary.visit_uv : null;
    var avgCartCost = caSummary.cart_uv > 0 ? caSummary.spend / caSummary.cart_uv : null;
    var avgDealCost = caSummary.deal_uv > 0 ? caSummary.spend / caSummary.deal_uv : null;

    // Cost comparison helper: {valColor, hasMean, meanHtml}
    function costCompare(noteVal, avgVal) {
      if (noteVal == null || avgVal == null) return { valColor: null, meanHtml: null };
      var diff = noteVal - avgVal;
      var color;
      if (Math.abs(diff) < 0.005) color = "#9CA3AF";
      else if (diff < 0) color = "#10B981"; // below avg = good (green)
      else color = "#EF4444"; // above avg = bad (red)
      return {
        valColor: color,
        meanHtml: '<span style="color:#9CA3AF">均 ¥' + avgVal.toFixed(2) + '</span>'
      };
    }

    // Restore title bar to single-note mode
    var modSub2 = document.querySelector("#modCost .mod-sub");
    if (modSub2) modSub2.textContent = "笔记粒度双渠道合计成本 · 对比同样本均值";

    var readComp  = costCompare(s.uv_cost, avgReadCost);
    var visitComp = costCompare(s.visit_uv_cost, avgVisitCost);
    var cartComp  = costCompare(s.cart_cost, avgCartCost);
    var dealComp  = costCompare(s.deal_cost, avgDealCost);

    const kpiItems = [
      { l: "有效累计消耗", v: fmt.money(s.spend), u: "元", valColor: null, rate: '<span style="color:#9CA3AF">薯条 ' + fmt.money(s.chili_spend) + ' · 聚光 ' + fmt.money(s.juguang_spend) + '</span>' },
      { l: "阅读UV成本", v: s.uv_cost == null ? "—" : "¥" + Number(s.uv_cost).toFixed(2), u: "", valColor: readComp.valColor, rate: readComp.meanHtml, tip: "累计实际支付金额 ÷ 星河阅读/播放UV" },
      { l: "进店UV成本", v: s.visit_uv_cost == null ? "—" : "¥" + Number(s.visit_uv_cost).toFixed(2), u: "", valColor: visitComp.valColor, rate: visitComp.meanHtml },
      { l: "加购成本",  v: s.cart_cost == null ? "—" : "¥" + Number(s.cart_cost).toFixed(2), u: "", valColor: cartComp.valColor, rate: cartComp.meanHtml },
      { l: "成交成本",  v: s.deal_cost == null ? "—" : "¥" + Number(s.deal_cost).toFixed(2), u: "", valColor: dealComp.valColor, rate: dealComp.meanHtml },
      { l: "合计投放天数", v: s.days == null ? "—" : s.days, u: "天", valColor: null, rate: '<span style="color:#9CA3AF">薯条 ' + fmt.int(s.chili_days) + ' · 聚光 ' + fmt.int(s.juguang_days) + '</span>' },
    ];
    document.getElementById("costKpis").innerHTML = kpiItems.map(k =>
      `<div class="trend-kpi${k.approx ? " kpi-approx" : ""}"${k.tip ? ' title="' + k.tip + '"' : ""}>
        <div class="trend-kpi-label">${k.l}</div>
        <div class="trend-kpi-val"${k.valColor ? ' style="color:' + k.valColor + '"' : ""}>${k.v}<span class="u"> ${k.u}</span></div>
        ${k.rate ? '<div class="trend-kpi-sub">' + k.rate + '</div>' : ""}
      </div>`
    ).join("");

    // 图表三成本统一使用淘宝星河UV口径；阅读成本与折线、KPI保持一致。
    var singleReadCost = s.uv_cost != null ? Number(s.uv_cost) : null;
    updateToggleCards("costToggles", {
      read: singleReadCost != null ? "¥" + singleReadCost.toFixed(2) : "—",
      visit: s.visit_uv_cost != null ? "¥" + Number(s.visit_uv_cost).toFixed(2) : "—",
      cart: s.cart_cost != null ? "¥" + Number(s.cart_cost).toFixed(2) : "—",
      deal: s.deal_cost != null ? "¥" + Number(s.deal_cost).toFixed(2) : "—"
    });

    // 笔记发布日期（用于 x 轴标注，对齐 fmtDate 格式 MM/DD）
    const noteInfo = DATA.notes.find(n => n.note_id === noteId);
    const pubDateRaw = noteInfo && noteInfo.pub_date ? noteInfo.pub_date : null;
    const pubDateStr = pubDateRaw ? fmtDate(pubDateRaw.replace(/-/g, "")) : null;

    // ECharts 成本趋势（加固：try-catch + 自动恢复）
    try {
      renderCostChart(daily, { read: 6, visit: 2, cart: 3, deal: 4 }, false, pubDateStr);
      // 单篇模式不支持点柱展开（当天恒 1 篇），解绑避免残留监听
      costChart.off("click");
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
    defaults: DATA.default_columns || [],
    selected: [],
    sortKey: "pub_date",
    sortDir: "desc",
    keyword: "",
    selectedIds: [],
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
      const v = localStorage.getItem("xhs_dash_cols_v5");
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  }
  function safeSaveSel() {
    try { localStorage.setItem("xhs_dash_cols_v5", JSON.stringify(TABLE.selected)); } catch {}
  }

  function isColMissing(col) {
    if (col.key === "note_id" || col.key === "creator") return null;
    const src = DATA.meta.sources || {};
    const loaded = {
      "蒲公英": !!(src.pgy && src.pgy.loaded),
      "星河": !!(src.star && src.star.loaded),
      "薯条": !!(src.chili && src.chili.loaded),
      "聚光": !!(src.juguang && src.juguang.loaded),
      "灵犀": !!(src.lx && src.lx.loaded),
    };
    const deps = [];
    const need = col.source || "";
    for (const t of ["蒲公英", "星河", "薯条", "聚光", "灵犀"]) if (need.includes(t)) deps.push(t);
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
    if (!qCreator) return;

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
    const averageBody = document.getElementById("tableAverage");
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
    if (TABLE.selectedIds.length) {
      const selected = new Set(TABLE.selectedIds);
      notes = notes.filter(n => selected.has(n.note_id));
    }
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
    const useSelectedAverage = TABLE.selectedIds.length > 1;
    const averageIds = useSelectedAverage ? new Set(TABLE.selectedIds) : null;
    const averageNotes = useSelectedAverage ? DATA.notes.filter(n => averageIds.has(n.note_id)) : DATA.notes;
    averageBody.innerHTML = buildAverageRow(averageNotes, cols, FZ, useSelectedAverage ? "已选平均" : "平均值");
    requestAnimationFrame(syncAverageDock);

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

  function noteHasColumnSource(n, c) {
    const src = c.source || "";
    if (src === "蒲公英") return !!n.in_pgy;
    if (src === "星河") return !!n.in_star;
    if (src === "薯条") return !!n.in_chili;
    if (src === "聚光") return !!n.in_juguang;
    if (src === "灵犀") return !!n.in_lx;
    return true;
  }

  function averageValue(notes, c) {
    if (!c || !["int", "num", "ratio"].includes(c.type) || isColMissing(c)) return null;
    const values = notes
      .filter(n => noteHasColumnSource(n, c))
      .map(n => n[c.key])
      .filter(value => value != null && value !== "")
      .map(Number)
      .filter(Number.isFinite);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function formatAverage(v, c) {
    if (v == null) return "—";
    return fmt.val(v, c);
  }

  function buildAverageRow(notes, cols, FZ, label) {
    return "<tr>" + cols.map((c, index) => {
      const fz = FZ && FZ.map[c.key];
      const fzCls = fz ? " frozen-col" + (c.key === FZ.lastKey ? " last-frozen" : "") : "";
      const fzStyle = fz ? ` style="left:${fz.left}px;min-width:${fz.width}px;max-width:${fz.width}px"` : "";
      if (index === 0) return `<td class="average-label${fzCls}"${fzStyle}>${label}</td>`;
      return `<td class="average-value${fzCls}"${fzStyle}>${formatAverage(averageValue(notes, c), c)}</td>`;
    }).join("") + "</tr>";
  }

  function syncAverageDock() {
    const wrap = document.querySelector(".table-wrap");
    const shell = document.querySelector(".table-shell");
    const track = document.getElementById("tableAverageTrack");
    const avgTable = track && track.querySelector(".average-table");
    const colgroup = document.getElementById("tableAverageCols");
    const headers = Array.from(document.querySelectorAll("#tableHead tr:last-child th"));
    if (!wrap || !shell || !track || !avgTable || !colgroup || !headers.length) return;
    const widths = headers.map(th => th.getBoundingClientRect().width);
    const total = widths.reduce((sum, width) => sum + width, 0);
    colgroup.innerHTML = widths.map(width => `<col style="width:${width}px">`).join("");
    avgTable.style.width = total + "px";
    track.style.width = total + "px";
    shell.style.setProperty("--table-h-scrollbar", Math.max(0, wrap.offsetHeight - wrap.clientHeight) + "px");
    shell.style.setProperty("--table-v-scrollbar", Math.max(0, wrap.offsetWidth - wrap.clientWidth) + "px");
    syncAverageDockScroll();
  }

  function syncAverageDockScroll() {
    const wrap = document.querySelector(".table-wrap");
    const track = document.getElementById("tableAverageTrack");
    if (!wrap || !track) return;
    const x = wrap.scrollLeft;
    track.style.transform = `translateX(${-x}px)`;
    track.querySelectorAll("td.frozen-col").forEach(td => {
      td.style.transform = `translateX(${x}px)`;
    });
  }

  function initAverageDock() {
    const wrap = document.querySelector(".table-wrap");
    if (wrap) wrap.addEventListener("scroll", syncAverageDockScroll, { passive: true });
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
    if (src === "聚光" && !n.in_juguang) return rm("该笔记未投聚光");
    if (src === "灵犀" && !n.in_lx) return rm("该笔记不在灵犀种草贡献榜单");

    let v = n[c.key];
    const tier = (n.tiers || {})[c.key];
    let cls = "";
    if (tier === "good") cls = "num-good";
    else if (tier === "warn") cls = "num-warn";
    else if (tier === "na") cls = "num-na";
    const kw = TABLE.keyword;
    if (c.key === "note_id") {
      return `<td class="mono-id${fzCls}"${fzStyle} title="${v || ''}">${escapeHtml(v)}</td>`;
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
        const fixedOnly = TABLE.fixed.includes(c.key);
        const isDefault = TABLE.defaults.includes(c.key);
        const cls = fixedOnly ? "disabled" : (inSel ? "selected" : "");
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

    // Right panel: grouped by source
    sel.innerHTML = "";
    for (const g of TABLE.groups) {
      const groupKeys = MODAL.draft.filter(k => {
        const c = TABLE.byKey[k];
        return c && c.group === g.key;
      });
      if (!groupKeys.length) continue;
      const nowrap = groupKeys.length <= 3 ? " col-group-nowrap" : "";
      const itemsHtml = groupKeys.map((k, i) => {
        const c = TABLE.byKey[k];
        if (!c) return "";
        const fixed = TABLE.fixed.includes(k);
        const def = !fixed && TABLE.defaults.includes(k);
        const removable = !fixed && !def;
        const dragOk = !fixed;
        const derCls = c.derived ? " col-derived" : "";
        const cls = fixed ? "locked" : (def ? "default-col" : "");
        return `<div class="col-item ${cls}${derCls}" data-key="${k}" draggable="${dragOk}">
          ${fixed ? '<span class="lock">🔒</span>' : '<span class="drag-handle">⋮⋮</span>'}
          <span>${c.label}</span>
          ${removable ? `<span class="remove-x" data-remove="${k}">×</span>` : `<span class="default-dot" title="默认字段，不可删除">·</span>`}
        </div>`;
      }).join("");
      sel.insertAdjacentHTML("beforeend",
        `<div class="col-group">
          <div class="col-group-head">${g.label} <span class="cnt">${groupKeys.length}</span></div>
          <div class="col-group-items${nowrap}">${itemsHtml}</div>
        </div>`);
    }
    document.getElementById("selCount").textContent = MODAL.draft.length;

    avail.querySelectorAll(".col-item").forEach(el => {
      el.addEventListener("click", () => {
        const k = el.dataset.key;
        if (TABLE.fixed.includes(k) || TABLE.defaults.includes(k)) return;
        const idx = MODAL.draft.indexOf(k);
        if (idx >= 0) { MODAL.draft.splice(idx, 1); }
        else {
          // Insert at end of its group
          const c = TABLE.byKey[k];
          const grp = c ? c.group : null;
          let insertAt = MODAL.draft.length;
          if (grp) {
            for (let i = MODAL.draft.length - 1; i >= 0; i--) {
              const pc = TABLE.byKey[MODAL.draft[i]];
              if (pc && pc.group === grp) { insertAt = i + 1; break; }
            }
            // If no column from this group exists, insert after the last column of the previous group
            if (insertAt === MODAL.draft.length) {
              const groupOrder = TABLE.groups.map(g => g.key);
              const grpIdx = groupOrder.indexOf(grp);
              for (let gi = grpIdx - 1; gi >= 0; gi--) {
                for (let i = MODAL.draft.length - 1; i >= 0; i--) {
                  const pc = TABLE.byKey[MODAL.draft[i]];
                  if (pc && pc.group === groupOrder[gi]) { insertAt = i + 1; break; }
                }
                if (insertAt < MODAL.draft.length) break;
              }
            }
          }
          MODAL.draft.splice(insertAt, 0, k);
        }
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
      el.addEventListener("dragstart", () => { dragKey = el.dataset.key; el.classList.add("dragging"); });
      el.addEventListener("dragend", () => { el.classList.remove("dragging"); sel.querySelectorAll(".col-item").forEach(it => it.classList.remove("drag-over")); dragKey = null; });
      el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("drag-over"); });
      el.addEventListener("dragleave", () => { el.classList.remove("drag-over"); });
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

  // ---------- 表格笔记多选 ----------
  let tableCombo = null;

  function makeTableMultiCombo() {
    const inp = document.getElementById("tableSearch");
    const list = document.getElementById("tableList");
    const candidates = DATA.notes.slice().sort((a, b) =>
      (String(b.pub_date || "0").replace(/-/g, "") | 0) - (String(a.pub_date || "0").replace(/-/g, "") | 0));
    const self = { currentId: null, keyword: "", hi: 0, selectById: null, clear: null };
    let draftIds = [];
    let draftActive = false;

    const clearBtn = document.createElement("span");
    clearBtn.className = "combo-clear";
    clearBtn.innerHTML = "×";
    clearBtn.title = "清空已选笔记";
    inp.parentNode.insertBefore(clearBtn, inp.nextSibling);

    function fmtPubDate(d) {
      if (!d) return "—";
      const s = String(d).slice(0, 10);
      const parts = s.split("-");
      if (parts.length === 3) return parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
      if (s.length === 8) return s.slice(4, 6).replace(/^0/, "") + "/" + s.slice(6, 8).replace(/^0/, "");
      return s;
    }

    function findNote(noteId) {
      return candidates.find(n => n.note_id === noteId) || DATA.notes.find(n => n.note_id === noteId);
    }

    function updateInputSummary() {
      const count = TABLE.selectedIds.length;
      self.currentId = count === 1 ? TABLE.selectedIds[0] : null;
      inp.classList.toggle("has-value", count > 0);
      inp.classList.toggle("multi-value", count > 1);
      inp.classList.remove("linked-outside");
      if (!count) inp.value = "";
      else if (count > 1) inp.value = "已选 " + count + " 篇";
      else {
        const n = findNote(TABLE.selectedIds[0]);
        inp.value = n ? `${fmtPubDate(n.pub_date)} | ${n.note_id} | ${n.creator || "—"}` : TABLE.selectedIds[0];
      }
      clearBtn.style.display = count ? "" : "none";
    }

    function getFiltered() {
      if (!self.keyword) return candidates.slice(0, 200);
      const low = self.keyword.toLowerCase();
      return candidates.filter(n =>
        String(n.note_id || "").toLowerCase().includes(low) ||
        String(n.creator || "").toLowerCase().includes(low)
      ).slice(0, 200);
    }

    function renderList() {
      const items = getFiltered();
      const selected = new Set(draftIds);
      const itemHtml = items.length ? items.map((n, i) => {
        const checked = selected.has(n.note_id);
        return `<div class="combo-item table-multi-item${checked ? " selected" : ""}${i === self.hi ? " hi" : ""}" data-id="${n.note_id}" aria-selected="${checked}">
          <span class="multi-check" aria-hidden="true"></span>
          <span class="combo-line"><span class="pub-date">${fmtPubDate(n.pub_date)}</span><span class="sep">|</span><span class="id">${n.note_id}</span><span class="sep">|</span><span class="creator">${escapeHtml(n.creator || "—")}</span></span>
        </div>`;
      }).join("") : '<div class="combo-empty">无匹配笔记</div>';
      const count = draftIds.length;
      const buttonText = count ? `确认 ${count} 篇` : "确认";
      list.innerHTML = `<div class="table-multi-options">${itemHtml}</div><div class="table-multi-confirm"><button type="button" class="table-confirm-btn"${count ? "" : " disabled"}>${buttonText}</button></div>`;
      list.querySelectorAll(".combo-item").forEach(li => {
        li.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          toggle(li.dataset.id, li);
        });
      });
      list.querySelector(".table-confirm-btn").addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        commitDraft();
      });
      list.querySelector(".table-multi-options").scrollTop = 0;
    }

    function applySelection() {
      TABLE.keyword = "";
      TABLE.page = 1;
      updateInputSummary();
      renderTable();
    }

    function updateConfirmButton() {
      const button = list.querySelector(".table-confirm-btn");
      if (!button) return;
      const count = draftIds.length;
      button.textContent = count ? `确认 ${count} 篇` : "确认";
      button.disabled = count === 0;
    }

    function toggle(noteId, itemElement) {
      const index = draftIds.indexOf(noteId);
      if (index >= 0) draftIds.splice(index, 1);
      else draftIds.push(noteId);
      const item = itemElement || Array.from(list.querySelectorAll(".table-multi-item"))
        .find(el => el.dataset.id === noteId);
      if (item) {
        const checked = draftIds.includes(noteId);
        item.classList.toggle("selected", checked);
        item.setAttribute("aria-selected", String(checked));
      }
      updateConfirmButton();
      list.hidden = false;
    }

    function moveHighlight(nextIndex) {
      const visibleItems = Array.from(list.querySelectorAll(".table-multi-item"));
      if (!visibleItems.length) return;
      self.hi = Math.max(0, Math.min(visibleItems.length - 1, nextIndex));
      visibleItems.forEach((item, index) => item.classList.toggle("hi", index === self.hi));
      const options = list.querySelector(".table-multi-options");
      const active = visibleItems[self.hi];
      const itemTop = active.offsetTop;
      const itemBottom = itemTop + active.offsetHeight;
      if (itemTop < options.scrollTop) options.scrollTop = itemTop;
      else if (itemBottom > options.scrollTop + options.clientHeight) {
        options.scrollTop = itemBottom - options.clientHeight;
      }
    }

    function beginDraft() {
      draftIds = TABLE.selectedIds.slice();
      draftActive = true;
    }

    function discardDraft() {
      if (!draftActive) return;
      draftIds = TABLE.selectedIds.slice();
      draftActive = false;
      self.keyword = "";
      list.hidden = true;
      updateInputSummary();
    }

    function commitDraft() {
      if (!draftActive || !draftIds.length) return;
      TABLE.selectedIds = draftIds.slice();
      draftActive = false;
      self.keyword = "";
      list.hidden = true;
      applySelection();
    }

    self.clear = function () {
      TABLE.selectedIds = [];
      draftIds = [];
      self.keyword = "";
      self.hi = 0;
      draftActive = false;
      list.hidden = true;
      applySelection();
    };

    self.selectById = function (noteId) {
      TABLE.selectedIds = noteId ? [noteId] : [];
      draftIds = TABLE.selectedIds.slice();
      self.keyword = "";
      self.hi = 0;
      draftActive = false;
      list.hidden = true;
      applySelection();
    };

    clearBtn.addEventListener("click", e => {
      e.stopPropagation();
      self.clear();
    });
    inp.addEventListener("focus", () => {
      if (!draftActive) {
        beginDraft();
        self.keyword = "";
        self.hi = 0;
      }
      renderList();
      list.hidden = false;
      inp.select();
    });
    inp.addEventListener("input", () => {
      self.keyword = inp.value.trim();
      self.hi = 0;
      renderList();
      list.hidden = false;
    });
    inp.addEventListener("keydown", e => {
      const items = getFiltered();
      if (e.key === "ArrowDown") {
        e.preventDefault(); moveHighlight(Math.min(items.length - 1, self.hi + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); moveHighlight(Math.max(0, self.hi - 1));
      } else if (e.key === "Enter") {
        e.preventDefault(); if (items[self.hi]) toggle(items[self.hi].note_id);
      } else if (e.key === "Escape") {
        discardDraft();
      }
    });
    document.addEventListener("click", e => {
      if (!e.target.closest("#tableCombo")) {
        discardDraft();
      }
    });

    if (!candidates.length) {
      inp.placeholder = "（无数据）";
      inp.disabled = true;
    }
    updateInputSummary();
    return self;
  }

  function initTableCombo() {
    tableCombo = makeTableMultiCombo();
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
  const DAILY_ROSE_PALETTE = [
    "#CC3300","#D65C33","#E07A4D","#EB9966",
    "#FDBACB","#FDCCDC","#FEDEEE","#FEE8F0",
    "#FFF1F5","#FFF6F9"
  ];
  const DAILY_REST_COLOR = "#D1D5DB";

  const METRIC_META = {
    read:  { label: "阅读", palette: DAILY_ROSE_PALETTE, key: "read_uv" },
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
    document.querySelectorAll("#dailyToggles .metric-toggle-card.active").forEach(function(btn){
      activeMetrics.push(btn.dataset.metric);
    });
    if (!activeMetrics.length) activeMetrics = ["visit"]; // at least one
    // 阅读UV量级远大于其它，勾选阅读且还有其它指标时启用右轴避免压扁
    var useDualAxis = activeMetrics.indexOf("read") >= 0 && activeMetrics.length > 1;

    // KPI cards — show all three totals regardless of toggle
    var totalRead = 0, totalVisit = 0, totalCart = 0, totalDeal = 0, totalNotes = new Set();
    trendsAll.forEach(function(r){ totalVisit += r[1]||0; totalCart += r[2]||0; totalDeal += r[3]||0; totalRead += r[5]||0; });
    Object.keys(dailyNotes).forEach(function(d){ (dailyNotes[d]||[]).forEach(function(n){ totalNotes.add(n.note_id); }); });
    var kpis = [
      { l: "总阅读UV", v: fmt.int(totalRead), u: "" },
      { l: "总进店UV", v: fmt.int(totalVisit), u: "" },
      { l: "总加购UV", v: fmt.int(totalCart), u: "" },
      { l: "总成交UV", v: fmt.int(totalDeal), u: "" },
      { l: "有数据笔记", v: fmt.int(totalNotes.size), u: "篇" },
    ];
    document.getElementById("dailyOverviewKpis").innerHTML = kpis.map(function(k){
      return '<div class="trend-kpi"><div class="trend-kpi-label">'+k.l+'</div><div class="trend-kpi-val">'+k.v+'<span class="u"> '+k.u+'</span></div></div>';
    }).join("");

    updateToggleCards("dailyToggles", {
      read: fmt.int(totalRead),
      visit: fmt.int(totalVisit),
      cart: fmt.int(totalCart),
      deal: fmt.int(totalDeal)
    });

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
      var metricYIdx = (metric === "read" && useDualAxis) ? 1 : 0;

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
          type: "bar", stack: stackName, yAxisIndex: metricYIdx,
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
        type: "bar", stack: stackName, yAxisIndex: metricYIdx,
        data: restSeries, color: DAILY_REST_COLOR,
        barMaxWidth: activeMetrics.length > 1 ? 24 : 44,
        emphasis: { focus: "series" },
        itemStyle: { borderWidth: 0 },
      });

      // Daily total label (invisible bar on top of this stack)
      var dailyTotalData = trendsAll.map(function(r){
        var idx = {visit:1, cart:2, deal:3, read:5}[metric] || 1;
        return r[idx];
      });
      barSeries.push({
        name: metric + "_label",
        type: "bar", stack: stackName, yAxisIndex: metricYIdx,
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

    var zoomOpt = buildInsideZoom();

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
          var tr = dSummary ? fmt.int(dSummary[5]) : "—";
          var tv = dSummary ? fmt.int(dSummary[1]) : "—";
          var tc = dSummary ? fmt.int(dSummary[2]) : "—";
          var td = dSummary ? fmt.int(dSummary[3]) : "—";

          var html = '<div style="font-weight:700;margin-bottom:6px;font-size:12px">📅 ' + dateLabel + '</div>';
          html += '<table style="border-spacing:0 1px;font-size:11px;width:100%">';
          var TH = 'text-align:left;font-size:10px;color:#9CA3AF;font-weight:400;width:58px;padding-bottom:2px';
          html += '<tr><td style="width:16px"></td><td></td>';
          html += '<td style="' + TH + '">阅读</td>';
          html += '<td style="' + TH + '">进店</td>';
          html += '<td style="' + TH + '">加购</td>';
          html += '<td style="' + TH + '">成交</td></tr>';
          var T = 'text-align:left;font-weight:600;width:58px';
          html += '<tr><td style="width:16px"></td><td style="color:#6B7280;padding-bottom:4px">总计</td>';
          html += '<td style="' + T + ';color:#CC3300">' + tr + '</td>';
          html += '<td style="' + T + ';color:#FF2442">' + tv + '</td>';
          html += '<td style="' + T + ';color:#F97316">' + tc + '</td>';
          html += '<td style="' + T + ';color:#EAB308">' + td + '</td></tr>';

          if (!notes.length) { html += '</table>'; return html; }

          var showCount = notes.length <= 8 ? notes.length : 5;
          html += '<tr><td colspan="6" style="padding:2px 0"><div style="border-top:1px dashed #E5E7EB"></div></td></tr>';
          for (var i = 0; i < showCount; i++) {
            var n = notes[i];
            var rank = i + 1;
            var clr = rank <= 10 ? DAILY_RED_PALETTE[rank - 1] : DAILY_REST_COLOR;
            var rv = fmt.int(n.read_uv), vv = fmt.int(n.visit_uv), cv = fmt.int(n.cart_uv), dv = fmt.int(n.deal_uv);
            html += '<tr>';
            html += '<td style="width:16px"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + clr + ';vertical-align:middle"></span></td>';
            html += '<td style="font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px" title="' + escapeHtml(n.creator || '') + '">' + escapeHtml(n.creator || '—') + '</td>';
            html += '<td style="' + T + ';color:#CC3300">' + rv + '</td>';
            html += '<td style="' + T + ';color:#FF2442">' + vv + '</td>';
            html += '<td style="' + T + ';color:#F97316">' + cv + '</td>';
            html += '<td style="' + T + ';color:#EAB308">' + dv + '</td>';
            html += '</tr>';
          }
          if (notes.length > showCount) {
            var restRead = 0, restTotal = 0, restCart = 0, restDeal = 0;
            for (var j = showCount; j < notes.length; j++) {
              restRead += notes[j].read_uv || 0;
              restTotal += notes[j].visit_uv || 0;
              restCart += notes[j].cart_uv || 0;
              restDeal += notes[j].deal_uv || 0;
            }
            html += '<tr><td style="width:16px"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + DAILY_REST_COLOR + ';vertical-align:middle"></span></td>';
            html += '<td style="color:#9CA3AF;font-size:10px">等 ' + (notes.length - showCount) + ' 篇</td>';
            html += '<td style="text-align:left;color:#9CA3AF;font-size:10px">' + fmt.int(restRead) + '</td>';
            html += '<td style="text-align:left;color:#9CA3AF;font-size:10px">' + fmt.int(restTotal) + '</td>';
            html += '<td style="text-align:left;color:#9CA3AF;font-size:10px">' + fmt.int(restCart) + '</td>';
            html += '<td style="text-align:left;color:#9CA3AF;font-size:10px">' + fmt.int(restDeal) + '</td></tr>';
          }
          html += '</table>';
          html += '<div style="margin-top:4px;font-size:10px;color:#9CA3AF;text-align:center">💡 点击柱子展开全部笔记明细</div>';
          return html;
        },
      },
      legend: { show: false },
      grid: { top: 28, left: 56, right: 20, bottom: 40 },
      dataZoom: zoomOpt,
      xAxis: {
        type: "category", data: dates,
        axisLine: { lineStyle: { color: C.border } },
        axisLabel: { fontSize: 11, color: C.muted, rotate: dates.length > 40 ? 45 : 0 },
      },
      yAxis: [
        {
          type: "value", name: useDualAxis ? "进店/加购/成交 UV" : "UV", position: "left",
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: C.grid } },
          axisLabel: { color: C.muted, fontSize: 11 }, nameTextStyle: { color: C.dim },
        },
        {
          type: "value", name: "阅读UV", position: "right", show: useDualAxis,
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: useDualAxis, color: "#CC3300", fontSize: 11,
            formatter: function(v){ return v >= 1000 ? (v/1000).toFixed(1)+"k" : v; } },
          nameTextStyle: { color: "#CC3300", fontWeight: 600 },
        },
      ],
      series: barSeries,
    }, true);

    bindChartPanInteractions(dailyOverviewChart, "dailyPanHint");
    dailyOverviewChart.resize();
    dailyOverviewChart.on("click", function(params) {
      if (params.componentType === "series" && params.seriesType === "bar") {
        var di = params.dataIndex;
        if (di != null && di >= 0 && di < dateInts.length) {
          runConfirmedChartClick(dailyOverviewChart, function () {
            DAILY_SELECTED_DATE = dateInts[di];
            expandDailyNotes(DAILY_SELECTED_DATE);
          });
        }
      }
    });

    // Close panel if previously open
    document.getElementById("dailyDetailPanel").hidden = true;
  }

  function initDailyToggles() {
    document.querySelectorAll("#dailyToggles .metric-toggle-card").forEach(function(btn){
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
    thead.innerHTML = '<tr><th style="width:40px">#</th><th>达人</th><th>笔记ID</th><th>阅读UV</th><th>进店UV</th><th>加购UV</th><th>成交UV</th></tr>';

    tbody.innerHTML = notes.map(function(n, i){
      var rank = i + 1;
      var clr = rank <= 10 ? colorForRank(rank) : DAILY_REST_COLOR;
      return '<tr class="daily-detail-row-note" data-nid="' + escapeHtml(n.note_id) + '">' +
        '<td><span class="daily-rank-badge" style="background:' + clr + ';color:#fff">' + rank + '</span></td>' +
        '<td>' + escapeHtml(n.creator || "—") + '</td>' +
        '<td class="mono-id">' + escapeHtml(n.note_id) + '</td>' +
        '<td>' + fmt.int(n.read_uv) + '</td>' +
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

  // ===== 图表三 · 当天投放明细展开（仿 expandDailyNotes，薯条口径） =====
  function expandCostDailyNotes(dateInt) {
    var costAll = DATA.cost_all || {};
    var dailyNotes = costAll.daily_notes || {};
    var notes = (dailyNotes[dateInt] || []).slice();
    notes.sort(function(a, b){ return (b.spend || 0) - (a.spend || 0); });
    var panel = document.getElementById("costDetailPanel");
    var title = document.getElementById("costDetailTitle");
    var thead = document.getElementById("costDetailHead");
    var tbody = document.getElementById("costDetailBody");

    title.textContent = fmtDate(dateInt) + " 双渠道投放明细（共 " + notes.length + " 篇）";
    thead.innerHTML = '<tr><th style="width:40px">#</th><th>达人昵称</th><th>笔记ID</th><th>合计金额</th><th>薯条实付</th><th>聚光消耗</th></tr>';

    tbody.innerHTML = notes.map(function(n, i){
      var rank = i + 1;
      var clr = rank <= 10 ? colorForRank(rank) : DAILY_REST_COLOR;
      return '<tr class="daily-detail-row-note" data-nid="' + escapeHtml(n.note_id) + '">' +
        '<td><span class="daily-rank-badge" style="background:' + clr + ';color:#fff">' + rank + '</span></td>' +
        '<td>' + escapeHtml(n.creator || "—") + '</td>' +
        '<td class="mono-id">' + escapeHtml(n.note_id) + '</td>' +
        '<td>' + fmt.money(n.spend) + '</td>' +
        '<td>' + fmt.money(n.chili_spend) + '</td>' +
        '<td>' + fmt.money(n.juguang_spend) + '</td></tr>';
    }).join("");

    // 点击行 → 联动跳转到该笔记的单篇成本图
    tbody.querySelectorAll(".daily-detail-row-note").forEach(function(tr){
      tr.addEventListener("click", function(){
        var nid = tr.dataset.nid;
        STATE.currentNote = nid;
        if (trendCombo && trendCombo.selectById) trendCombo.selectById(nid);
        if (costCombo && costCombo.selectById) costCombo.selectById(nid);
        if (tableCombo && tableCombo.selectById) tableCombo.selectById(nid);
        var el = document.getElementById("modCost");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.getElementById("costDetailClose").addEventListener("click", function(){
    document.getElementById("costDetailPanel").hidden = true;
  });

  // ---------- 全局响应 ----------
  window.addEventListener("resize", () => {
    if (trendChart) trendChart.resize();
    if (costChart) costChart.resize();
    if (dailyOverviewChart) dailyOverviewChart.resize();
    if (biliDailyOverviewChart) biliDailyOverviewChart.resize();
    if (biliTrendChart) biliTrendChart.resize();
    if (biliCostChart) biliCostChart.resize();
    syncAverageDock();
  });

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
  bindLinks();
  renderMeta();
  renderKpis();
  renderSources(["pgy", "star", "chili", "juguang", "lx"], "sourceStrip");
  renderSourceNotes();
  renderBiliMeta();
  renderBiliKpis();
  renderSources(["bili", "bili_fire", "bili_ads"], "biliSourceStrip");
  initTableCols();
  initQueryPanel();
  initAverageDock();
  renderTable();
  bindModal();
  initTableCombo();
  initGmvTooltip();
  initDailyToggles();
  initTrendToggles();
  initCostToggles();
  renderDailyOverview();
  renderTrendModule();
  renderCostModule();
  initBiliDailyToggles();
  initBiliToggles();
  initBiliCostToggles();
  renderBiliDailyOverview();
  renderBiliTrendModule();
  renderBiliCostModule();
  initChartPanHints();
  initToc();
})();
