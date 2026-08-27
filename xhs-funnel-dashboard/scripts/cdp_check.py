# -*- coding: utf-8 -*-
"""投放看板 · CDP 无头自检（纯标准库，零依赖）

Edge 无头 + Chrome DevTools 协议直连，DOM 级验证产物，比截图可靠：
  - payload 与核心指标：小红书五表加载标记、total_gmv、overall_roi、交集篇数
  - 渲染完整性：ECharts canvas 数、KPI 卡、数据源状态条、表格行数
  - 横滚冻结列：scrollLeft=650 后冻结列仍贴容器左缘、分组表头 sticky + 不透明
  - 多平台目录：小红书/抖音/B站分组、B站模块节点、水位线图例文案
  - 输出横滚后截图（备查）

用法:
  python scripts/cdp_check.py [产物路径]
默认路径: 数据看板文件/全链路投放看板.html
注意: msedge 不在 PATH 需完整路径；必须带 --user-data-dir（已有 Edge 实例会抢占默认 profile 导致失败）
"""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8")

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
DEFAULT_HTML = r"D:\C盘迁移归档\桌面工作文件\小红书营销数据\数据看板文件\全链路投放看板.html"
PORT = 9333
PROFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_edge_cdp_profile")
SHOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_check_hscroll.png")

def ws_connect(host, port, path):
    s = socket.create_connection((host, port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
    s.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(4096)
    if b"101" not in buf.split(b"\r\n")[0]:
        raise RuntimeError("websocket 握手失败: " + buf[:200].decode(errors="replace"))
    return s

def ws_send(s, text):
    payload = text.encode()
    mask = os.urandom(4)
    header = bytearray([0x81])
    n = len(payload)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126); header += struct.pack(">H", n)
    else:
        header.append(0x80 | 127); header += struct.pack(">Q", n)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    s.sendall(bytes(header) + mask + masked)

def ws_recv_frame(s):
    hdr = b""
    while len(hdr) < 2:
        chunk = s.recv(2 - len(hdr))
        if not chunk: raise ConnectionError("连接关闭")
        hdr += chunk
    opcode = hdr[0] & 0x0F
    n = hdr[1] & 0x7F
    if n == 126:
        n = struct.unpack(">H", s.recv(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", s.recv(8))[0]
    masked = bool(hdr[1] & 0x80)
    mk = s.recv(4) if masked else b""
    payload = b""
    while len(payload) < n:
        payload += s.recv(n - len(payload))
    if masked:
        payload = bytes(b ^ mk[i % 4] for i, b in enumerate(payload))
    return opcode, payload

class CDP:
    def __init__(self, host, port, path):
        self.s = ws_connect(host, port, path)
        self.msg_id = 0
    def call(self, method, params=None):
        self.msg_id += 1
        mid = self.msg_id
        ws_send(self.s, json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            op, payload = ws_recv_frame(self.s)
            if op == 9:  # ping
                continue
            if op != 1:
                continue
            msg = json.loads(payload.decode())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"CDP {method} 失败: {msg['error']}")
                return msg.get("result", {})
    def eval(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        if r.get("exceptionDetails"):
            details = r["exceptionDetails"]
            exception = details.get("exception") or {}
            return {"__exception__": exception.get("description") or details.get("text", "")}
        return r.get("result", {}).get("value")


def eval_json(cdp, expr, label):
    value = cdp.eval(expr)
    if isinstance(value, dict) and value.get("__exception__"):
        raise RuntimeError(f"{label} 执行失败: {value['__exception__']}")
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)

def get_ws_url():
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as resp:
                pages = json.loads(resp.read())
            for p in pages:
                if p.get("type") == "page" and p.get("webSocketDebuggerUrl"):
                    return urllib.parse.urlsplit(p["webSocketDebuggerUrl"]).path
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("CDP 端口未就绪")

CHECK1 = """(() => {
  const out = {};
  const p = document.getElementById('dashPayload');
  out.hasPayload = !!p;
  const D = p ? JSON.parse(p.textContent) : {};
  if (p) {
    out.starLoaded = !!(D.meta && D.meta.sources && D.meta.sources.star && D.meta.sources.star.loaded);
    out.chiliLoaded = !!(D.meta && D.meta.sources && D.meta.sources.chili && D.meta.sources.chili.loaded);
    out.juguangLoaded = !!(D.meta && D.meta.sources && D.meta.sources.juguang && D.meta.sources.juguang.loaded);
    out.pgyLoaded = !!(D.meta && D.meta.sources && D.meta.sources.pgy && D.meta.sources.pgy.loaded);
    out.lxLoaded = !!(D.meta && D.meta.sources && D.meta.sources.lx && D.meta.sources.lx.loaded);
    out.biliLoaded = !!(D.meta && D.meta.sources && D.meta.sources.bili && D.meta.sources.bili.loaded);
    out.biliFireLoaded = !!(D.meta && D.meta.sources && D.meta.sources.bili_fire && D.meta.sources.bili_fire.loaded);
    out.biliAdsLoaded = !!(D.meta && D.meta.sources && D.meta.sources.bili_ads && D.meta.sources.bili_ads.loaded);
    const B = D.bilibili || {};
    const BC = B.cost_all || {};
    out.biliNoteCount = (B.notes || []).length;
    out.biliCostNoteCount = Object.keys(B.cost || {}).length;
    out.biliMatchedNoteCount = B.meta && B.meta.matched_note_count;
    out.biliEffectiveEnd = B.meta && B.meta.effective_end;
    out.biliExcludedSpend = B.meta && B.meta.excluded_after_cutoff_spend;
    out.biliCostSpend = BC.summary && BC.summary.spend;
    out.biliCostDailyLast = BC.daily && BC.daily.length ? BC.daily[BC.daily.length - 1][0] : null;
    out.totalSpend = D.summary && D.summary.total_spend;
    out.totalChiliSpend = D.summary && D.summary.total_chili_spend;
    out.totalJuguangSpend = D.summary && D.summary.total_juguang_spend;
    out.waitingSpend = D.summary && D.summary.waiting_attribution_spend;
    out.unmatchedPaidSpend = D.summary && D.summary.unmatched_paid_spend;
    out.totalGmv = D.summary && D.summary.total_gmv;
    out.overallRoi = D.summary && D.summary.overall_roi;
    out.noteCount = D.summary && D.summary.note_count;
    out.matchedCount = D.summary && D.summary.matched_note_count;
  }
  out.canvasCount = document.querySelectorAll('canvas').length;
  out.kpiVals = Array.from(document.querySelectorAll('#kpiRow .kpi-val')).map(e => e.textContent.trim());
  out.trendKpis = document.querySelectorAll('#trendKpis .trend-kpi').length;
  out.trendKpiLabels = Array.from(document.querySelectorAll('#trendKpis .trend-kpi-label')).map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  out.trendReadValue = Array.from(document.querySelectorAll('#trendKpis .trend-kpi')).find(e => e.textContent.includes('总阅读UV（全部）'))?.querySelector('.trend-kpi-val')?.textContent.trim() || '';
  out.expectedTrendRead = (D.trends_all || []).reduce((sum, row) => sum + (row[5] || 0), 0);
  out.srcCards = Array.from(document.querySelectorAll('#sourceStrip .src-card')).map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  out.costKpiTexts = Array.from(document.querySelectorAll('#costKpis .trend-kpi')).map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  const costInstance = window.echarts && echarts.getInstanceByDom(document.getElementById('costChart'));
  out.costSeriesNames = costInstance ? (costInstance.getOption().series || []).map(series => series.name) : [];
  out.tableGroupTexts = Array.from(document.querySelectorAll('#tableHead .group-row th')).map(e => e.textContent.trim());
  out.tableRows = document.querySelectorAll('#tableBody tr').length;
  out.averageRow = !!document.querySelector('#tableAverage tr');
  out.averageLabel = document.querySelector('#tableAverage td')?.textContent.trim() || '';
    out.averageCellCount = document.querySelectorAll('#tableAverage td').length;
    out.headerCellCount = document.querySelectorAll('#tableHead tr:last-child th').length;
    const countPaths = path => String(path || '').split(' · ').filter(Boolean).length;
    const sources = (D.meta && D.meta.sources) || {};
    const expectedSourcePaths = {
      dailySourceNote: countPaths(sources.star && sources.star.path),
      trendSourceNote: countPaths(sources.star && sources.star.path) + countPaths(sources.pgy && sources.pgy.path),
      costSourceNote: countPaths(sources.chili && sources.chili.path) + countPaths(sources.juguang && sources.juguang.path) + countPaths(sources.star && sources.star.path) + countPaths(sources.pgy && sources.pgy.path),
      tableSourceNote: ['pgy', 'star', 'chili', 'juguang', 'lx'].reduce((sum, key) => sum + countPaths(sources[key] && sources[key].path), 0),
    };
    out.sourceNotes = ['dailySourceNote', 'trendSourceNote', 'costSourceNote', 'tableSourceNote'].map(id => {
      const el = document.getElementById(id);
      const paths = el ? Array.from(el.querySelectorAll('.source-note-path')) : [];
      const details = el && el.querySelector('details.source-note-disclosure');
      const summary = details && details.querySelector('summary');
      const color = summary ? getComputedStyle(summary).color : '';
      const rgb = (color.match(/[0-9]+/g) || []).slice(0, 3).map(Number);
      return {
        id,
        exists: !!el,
        hasHeading: !!el && el.textContent.includes('数据来源'),
        pathCount: paths.length,
        expectedPathCount: expectedSourcePaths[id],
        absoluteTitleCount: paths.filter(path => path.title.length > 2 && path.title.charAt(1) === ':').length,
        hasDisclosure: !!details,
        collapsedByDefault: !!details && !details.open,
        summaryText: summary ? summary.textContent.trim() : '',
        summaryColor: color,
        summaryIsRed: rgb.length === 3 && rgb[0] > rgb[1] * 2 && rgb[0] > rgb[2] * 2,
      };
    });
    const firstDisclosure = document.querySelector('#dailySourceNote details.source-note-disclosure');
    if (firstDisclosure) {
      firstDisclosure.querySelector('summary').click();
      out.sourceNoteOpened = firstDisclosure.open;
      firstDisclosure.querySelector('summary').click();
      out.sourceNoteClosedAgain = !firstDisclosure.open;
    }
    return JSON.stringify(out);
})()"""

CHECK2 = """(() => {
  const out = {};
  const wrap = document.querySelector('.table-wrap') || document.querySelector('.table-scroll');
  out.foundWrap = !!wrap;
  if (!wrap) return JSON.stringify(out);
  wrap.scrollIntoView({block: 'center'});
  const wrapRect = wrap.getBoundingClientRect();
  const frozenTh = document.querySelector('th.frozen-col');
  out.beforeLeft = wrap.scrollLeft;
  out.frozenBefore = frozenTh ? Math.round(frozenTh.getBoundingClientRect().left - wrapRect.left) : null;
  wrap.scrollLeft = 650;
  wrap.scrollTop = Math.min(400, wrap.scrollHeight - wrap.clientHeight);
  const afterRect = wrap.getBoundingClientRect();
  out.afterLeft = wrap.scrollLeft;
  out.frozenAfter = frozenTh ? Math.round(frozenTh.getBoundingClientRect().left - afterRect.left) : null;
  const gh = document.querySelector('.group-row th');
  out.groupHeadBg = gh ? getComputedStyle(gh).backgroundColor : null;
  out.groupHeadPos = gh ? getComputedStyle(gh).position : null;
  const bodyFrozen = document.querySelector('td.frozen-col');
  out.bodyFrozenTop = bodyFrozen ? Math.round(bodyFrozen.getBoundingClientRect().top - wrapRect.top) : null;
  return JSON.stringify(out);
})()"""

CHECK3 = """(() => {
  const out = {};
  const payloadEl = document.getElementById('dashPayload');
  const D = payloadEl ? JSON.parse(payloadEl.textContent) : {};
  const B = D.bilibili || {};
  const toc = document.getElementById('toc');
  out.tocExists = !!toc;
  out.platformToggles = Array.from(document.querySelectorAll('.platform-group-toggle span')).map(e => e.textContent.trim());
  out.biliModule = !!document.querySelector('[data-platform="bili"]');
  out.biliChartIds = ['biliDailyOverviewChart', 'biliTrendChart', 'biliCostChart'].filter(id => !!document.getElementById(id));
  out.biliModuleOrder = Array.from(document.querySelectorAll('#page-bili section.module')).map(el => el.id);
  out.biliModuleLabels = Array.from(document.querySelectorAll('#page-bili .mod-idx')).map(el => el.textContent.trim());
  out.biliCanvasRects = out.biliChartIds.map(id => {
    const el = document.getElementById(id);
    const canvas = el && el.querySelector('canvas');
    const rect = el && el.getBoundingClientRect();
    return {id, width: rect ? Math.round(rect.width) : 0, height: rect ? Math.round(rect.height) : 0,
      canvasWidth: canvas ? canvas.width : 0, canvasHeight: canvas ? canvas.height : 0};
  });
  out.biliSourceCards = document.querySelectorAll('#biliSourceStrip .src-card').length;
  out.biliTrendKpis = document.querySelectorAll('#biliTrendKpis .trend-kpi').length;
  out.biliTrendKpiLabels = Array.from(document.querySelectorAll('#biliTrendKpis .trend-kpi-label')).map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  out.biliTrendPlayValue = Array.from(document.querySelectorAll('#biliTrendKpis .trend-kpi')).find(e => e.textContent.includes('总播放UV（全部）'))?.querySelector('.trend-kpi-val')?.textContent.trim() || '';
  out.biliExpectedTrendPlay = (B.trends_all || []).reduce((sum, row) => sum + (row[5] || 0), 0);
  out.biliCostKpis = document.querySelectorAll('#biliCostKpis .trend-kpi').length;
  const biliCostInstance = window.echarts && echarts.getInstanceByDom(document.getElementById('biliCostChart'));
  out.biliCostSeriesNames = biliCostInstance ? (biliCostInstance.getOption().series || []).map(series => series.name) : [];
  out.biliQualityText = document.querySelector('#biliSourceStrip .data-quality-note')?.textContent.trim() || '';
  out.biliCutoffText = document.getElementById('biliCostSourceNote')?.textContent.trim() || '';
  out.biliSourceNotes = ['biliDailySourceNote','biliTrendSourceNote','biliCostSourceNote'].map(id => {
    const el = document.getElementById(id);
    return {id, exists: !!el, pathCount: el ? el.querySelectorAll('.source-note-path').length : 0};
  });
  const legends = [];
  document.querySelectorAll('div,span,small,p').forEach(el => {
    const t = (el.textContent || '').trim();
    if (t.length > 8 && t.length < 200 && /优秀|偏弱/.test(t)) legends.push(t);
  });
  out.legendTexts = legends.slice(0, 3);
  return JSON.stringify(out);
})()"""

CHECK4 = """(() => {
  const out = {};
  const xhsToggle = document.querySelector('.platform-group-toggle[data-page="page-xhs"]');
  const xhsPage = document.getElementById('page-xhs');
  if (xhsToggle && xhsPage && getComputedStyle(xhsPage).display === 'none') xhsToggle.click();
  const tableInput = document.getElementById('tableSearch');
  const averageText = () => Array.from(document.querySelectorAll('#tableAverage td')).map(e => e.textContent.trim()).join('|');
  out.averageBefore = averageText();

  tableInput.focus();
  let items = Array.from(document.querySelectorAll('#tableList .table-multi-item'));
  out.hasCheckboxes = items.length > 1 && items.every(e => !!e.querySelector('.multi-check'));
  const firstId = items[0] ? items[0].dataset.id : '';
  const secondId = items[1] ? items[1].dataset.id : '';
  let confirm = document.querySelector('#tableList .table-confirm-btn');
  out.emptyConfirmText = confirm ? confirm.textContent.trim() : '';
  out.emptyConfirmDisabled = confirm ? confirm.disabled : false;
  const initialOptions = document.querySelector('#tableList .table-multi-options');
  initialOptions.scrollTop = Math.round(initialOptions.scrollHeight / 2);
  const visibleItem = Array.from(initialOptions.querySelectorAll('.table-multi-item')).find(item => {
    const itemRect = item.getBoundingClientRect();
    const optionsRect = initialOptions.getBoundingClientRect();
    return itemRect.top >= optionsRect.top && itemRect.bottom <= optionsRect.bottom;
  });
  const scrollBeforeToggle = initialOptions.scrollTop;
  const pageBeforeToggle = window.scrollY;
  if (visibleItem) visibleItem.click();
  out.scrollAfterSelect = initialOptions.scrollTop - scrollBeforeToggle;
  out.pageAfterSelect = window.scrollY - pageBeforeToggle;
  if (visibleItem) visibleItem.click();
  out.scrollAfterDeselect = initialOptions.scrollTop - scrollBeforeToggle;
  out.pageAfterDeselect = window.scrollY - pageBeforeToggle;
  initialOptions.scrollTop = initialOptions.scrollHeight;
  const lastItem = initialOptions.querySelector('.table-multi-item:last-child');
  const initialButton = document.querySelector('#tableList .table-confirm-btn');
  out.lastItemClearance = lastItem && initialButton
    ? Math.round(initialButton.getBoundingClientRect().top - lastItem.getBoundingClientRect().bottom)
    : null;
  tableInput.value = firstId;
  tableInput.dispatchEvent(new Event('input', {bubbles: true}));
  items = Array.from(document.querySelectorAll('#tableList .table-multi-item'));
  if (items[0]) items[0].click();
  tableInput.value = secondId;
  tableInput.dispatchEvent(new Event('input', {bubbles: true}));
  items = Array.from(document.querySelectorAll('#tableList .table-multi-item'));
  if (items[0]) items[0].click();
  out.crossKeywordConfirmText = document.querySelector('#tableList .table-confirm-btn')?.textContent.trim() || '';
  tableInput.value = firstId;
  tableInput.dispatchEvent(new Event('input', {bubbles: true}));
  out.firstSelectionPreserved = !!document.querySelector('#tableList .table-multi-item.selected');
  out.rowsWhilePending = document.querySelectorAll('#tableBody tr').length;
  out.listOpenWhilePending = !document.getElementById('tableList').hidden;
  out.pendingSelected = Number((out.crossKeywordConfirmText.match(/[0-9]+/) || [0])[0]);
  out.hasConfirmBar = !!document.querySelector('#tableList .table-multi-confirm .table-confirm-btn');
  out.averageWhilePending = averageText();
  const confirmLayerStyle = getComputedStyle(document.querySelector('#tableList .table-multi-confirm'));
  out.confirmBackground = confirmLayerStyle.backgroundColor;
  out.confirmBorderWidth = confirmLayerStyle.borderTopWidth;
  out.confirmBoxShadow = confirmLayerStyle.boxShadow;

  document.body.click();
  tableInput.blur();
  tableInput.focus();
  out.selectedAfterDiscard = document.querySelectorAll('#tableList .table-multi-item.selected').length;
  out.rowsAfterDiscard = document.querySelectorAll('#tableBody tr').length;
  items = Array.from(document.querySelectorAll('#tableList .table-multi-item'));
  if (items[0]) items[0].click();
  items = Array.from(document.querySelectorAll('#tableList .table-multi-item:not(.selected)'));
  if (items[0]) items[0].click();
  confirm = document.querySelector('#tableList .table-confirm-btn');
  if (confirm) confirm.click();
  out.rowsAfterConfirm = document.querySelectorAll('#tableBody tr').length;
  out.summaryAfterConfirm = tableInput.value;
  out.averageAfterConfirm = averageText();

  const wrap = document.querySelector('.table-wrap');
  const dock = document.getElementById('tableAverageDock');
  const shell = document.querySelector('.table-shell');
  const wrapRect = wrap.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const horizontalScrollbar = Math.max(0, wrap.offsetHeight - wrap.clientHeight);
  out.dockBottomGap = Math.round(wrapRect.bottom - horizontalScrollbar - dockRect.bottom);
  out.dockHeight = Math.round(dockRect.height);
  wrap.scrollLeft = 650;
  wrap.dispatchEvent(new Event('scroll'));
  const frozenAverage = document.querySelector('#tableAverage td.frozen-col');
  out.averageFrozenLeft = frozenAverage ? Math.round(frozenAverage.getBoundingClientRect().left - shell.getBoundingClientRect().left) : null;

  const clear = document.querySelector('#tableCombo .combo-clear');
  if (clear) clear.click();
  out.rowsAfterClear = document.querySelectorAll('#tableBody tr').length;
  out.valueAfterClear = tableInput.value;
  out.averageAfterClear = averageText();

  const trendInput = document.getElementById('trendSearch');
  if (trendInput) trendInput.focus();
  const trendItem = document.querySelector('#trendList .combo-item');
  if (trendItem) trendItem.click();
  out.rowsAfterExternal = document.querySelectorAll('#tableBody tr').length;
  out.valueAfterExternal = tableInput.value;
  out.externalNoteId = trendItem ? trendItem.dataset.id : '';
  out.averageAfterExternal = averageText();
  return JSON.stringify(out);
})()"""

def main():
    html = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_HTML
    url = "file:///" + urllib.parse.quote(html.replace("\\", "/"))
    proc = subprocess.Popen([
        EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
        f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
        "--window-size=1500,1250", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        path = get_ws_url()
        cdp = CDP("127.0.0.1", PORT, path)
        for _ in range(40):
            if cdp.eval("document.readyState") == "complete": break
            time.sleep(0.3)
        time.sleep(2)  # 等 ECharts 完成渲染

        r1 = eval_json(cdp, CHECK1, "CHECK1")
        r2 = eval_json(cdp, CHECK2, "CHECK2")
        cdp.eval("document.querySelector('.platform-group-toggle[data-page=\"page-bili\"]')?.click()")
        time.sleep(0.25)  # switchPlatform 内部延迟 resize，等画布完成重算。
        r3 = eval_json(cdp, CHECK3, "CHECK3")
        r4 = eval_json(cdp, CHECK4, "CHECK4")
        print("=== 1. payload 与核心指标 ===")
        for k in ("hasPayload", "pgyLoaded", "starLoaded", "chiliLoaded", "juguangLoaded", "lxLoaded", "biliLoaded", "biliFireLoaded", "biliAdsLoaded",
                  "totalSpend", "totalChiliSpend", "totalJuguangSpend", "waitingSpend", "unmatchedPaidSpend",
                  "totalGmv", "overallRoi", "noteCount", "matchedCount",
                  "biliNoteCount", "biliCostNoteCount", "biliMatchedNoteCount", "biliEffectiveEnd", "biliExcludedSpend",
                  "biliCostSpend", "biliCostDailyLast",
                  "canvasCount", "tableRows", "averageRow", "averageLabel",
                  "averageCellCount", "headerCellCount"):
            print(f"  {k}: {r1.get(k)}")
        print("  kpiVals:", r1.get("kpiVals"))
        print("  trendKpis:", r1.get("trendKpis"), "trendReadValue:", r1.get("trendReadValue"))
        print("  srcCards:")
        for c in r1.get("srcCards", []): print("    ", c)
        print("=== 2. 横滚冻结列验证 ===")
        for k, v in r2.items(): print(f"  {k}: {v}")
        print("=== 3. 多平台目录 / 图例 / B站模块 ===")
        for k, v in r3.items(): print(f"  {k}: {v}")
        print("=== 4. 表格多选 / 固定总体平均值 ===")
        for k, v in r4.items(): print(f"  {k}: {v}")

        table_rect = json.loads(cdp.eval("""JSON.stringify((() => {
          const r = document.querySelector('.table-shell').getBoundingClientRect();
          return {x:r.left + window.scrollX, y:r.top + window.scrollY, width:r.width, height:r.height};
        })())"""))
        shot = cdp.call("Page.captureScreenshot", {
            "format": "png", "captureBeyondViewport": True,
            "clip": {**table_rect, "scale": 1}
        })
        with open(SHOT, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print(f"=== 截图备查: {SHOT} ===")

        ok = True
        def fail(msg):
            nonlocal ok
            ok = False
            print("  ✗ " + msg)
        if not r1.get("hasPayload"): fail("dashPayload 缺失")
        for k in ("pgyLoaded", "starLoaded", "chiliLoaded", "juguangLoaded", "lxLoaded"):
            if not r1.get(k): fail(f"{k} 未加载")
        if abs((r1.get("totalSpend") or 0) - (r1.get("totalChiliSpend") or 0) - (r1.get("totalJuguangSpend") or 0)) > 0.01:
            fail("小红书总投入不等于薯条+聚光")
        if len(r1.get("srcCards") or []) != 5:
            fail(f"小红书数据源卡片={len(r1.get('srcCards') or [])}（应为5）")
        if r1.get("trendKpis") != 6:
            fail(f"小红书单篇趋势汇总指标卡={r1.get('trendKpis')}（应为6）")
        if "总阅读UV（全部）" not in (r1.get("trendKpiLabels") or []):
            fail("小红书单篇趋势汇总缺少总阅读UV卡")
        if r1.get("trendReadValue") != f"{int(round(r1.get('expectedTrendRead') or 0)):,}":
            fail("小红书单篇趋势汇总阅读UV与payload不一致")
        if not {"薯条实付", "聚光消耗"}.issubset(set(r1.get("costSeriesNames") or [])):
            fail(f"成本堆叠柱系列缺失: {r1.get('costSeriesNames')}")
        groups = r1.get("tableGroupTexts") or []
        for label in ("投放汇总", "薯条投放", "聚光投放"):
            if label not in groups: fail(f"全链路表缺少分组: {label}")
        if not r1.get("biliLoaded"): fail("B站星河未加载")
        if not r1.get("biliFireLoaded"): fail("B站必火未加载")
        if not r1.get("biliAdsLoaded"): fail("B站三联日报未加载")
        if not (r1.get("biliCostSpend") or 0) > 0: fail("B站有效花费非正")
        if r1.get("biliEffectiveEnd") != r1.get("biliCostDailyLast"):
            fail("B站成本日序列未截止到星河最新日期")
        if not (r1.get("biliCostNoteCount") or 0) > 0: fail("B站成本视频数为0")
        if r1.get("biliCostNoteCount") != r1.get("biliMatchedNoteCount"):
            fail("B站成本视频数与同样本命中数不一致")
        if not (r1.get("totalGmv") or 0) > 0: fail("total_gmv 非正")
        if r1.get("overallRoi") is None: fail("overall_roi 为空")
        if not r1.get("averageRow"): fail("平均值行缺失")
        if r1.get("averageLabel") != "平均值": fail(f"平均值行标签异常: {r1.get('averageLabel')}")
        if r1.get("averageCellCount") != r1.get("headerCellCount"): fail("平均值行与表头列数不一致")
        source_notes = r1.get("sourceNotes") or []
        if len(source_notes) != 4: fail(f"数据源备注数量={len(source_notes)}（应为4）")
        for note in source_notes:
            if not note.get("exists"): fail(f"{note.get('id')} 缺失")
            if not note.get("hasHeading"): fail(f"{note.get('id')} 缺少数据来源标题")
            if note.get("pathCount") != note.get("expectedPathCount"):
                fail(f"{note.get('id')} 路径数={note.get('pathCount')}，预期={note.get('expectedPathCount')}")
            if note.get("absoluteTitleCount") != note.get("pathCount"):
                fail(f"{note.get('id')} 完整绝对路径未全部保留在悬停信息中")
            if not note.get("hasDisclosure"): fail(f"{note.get('id')} 折叠控件缺失")
            if not note.get("collapsedByDefault"): fail(f"{note.get('id')} 未默认收起")
            if note.get("summaryText") != "数据来源": fail(f"{note.get('id')} 折叠标题异常")
            if not note.get("summaryIsRed"): fail(f"{note.get('id')} 折叠标题不是红色: {note.get('summaryColor')}")
        if not r1.get("sourceNoteOpened"): fail("数据来源点击后未展开")
        if not r1.get("sourceNoteClosedAgain"): fail("数据来源再次点击后未收起")
        if (r1.get("canvasCount") or 0) < 3: fail(f"canvas 仅 {r1.get('canvasCount')} 个")
        if r2.get("foundWrap") is not True: fail("表格滚动容器未找到")
        if r2.get("frozenAfter") not in (0, 1): fail(f"横滚后冻结列 left={r2.get('frozenAfter')}（应为 0/1）")
        if r2.get("groupHeadPos") != "sticky": fail(f"分组表头 position={r2.get('groupHeadPos')}（应为 sticky）")
        if not r3.get("tocExists"): fail("目录缺失")
        if r3.get("biliChartIds") != ["biliDailyOverviewChart", "biliTrendChart", "biliCostChart"]:
            fail(f"B站图表节点异常: {r3.get('biliChartIds')}")
        if r3.get("biliModuleOrder") != ["modBiliDailyOverview", "modBiliTrend", "modBiliCost"]:
            fail(f"B站图表顺序异常: {r3.get('biliModuleOrder')}")
        if r3.get("biliModuleLabels") != ["图表一", "图表二", "图表三"]:
            fail(f"B站图表编号异常: {r3.get('biliModuleLabels')}")
        for chart in r3.get("biliCanvasRects") or []:
            if chart.get("width", 0) <= 250 or chart.get("height", 0) <= 250:
                fail(f"B站图表尺寸异常: {chart}")
            if chart.get("canvasWidth", 0) <= 0 or chart.get("canvasHeight", 0) <= 0:
                fail(f"B站图表画布为空: {chart}")
        if r3.get("biliSourceCards") != 3: fail(f"B站数据源卡片={r3.get('biliSourceCards')}（应为3）")
        if r3.get("biliTrendKpis") != 6: fail(f"B站单篇趋势汇总指标卡={r3.get('biliTrendKpis')}（应为6）")
        if "总播放UV（全部）" not in (r3.get("biliTrendKpiLabels") or []): fail("B站单篇趋势汇总缺少总播放UV卡")
        if r3.get("biliTrendPlayValue") != f"{int(round(r3.get('biliExpectedTrendPlay') or 0)):,}": fail("B站单篇趋势汇总播放UV与payload不一致")
        if r3.get("biliCostKpis") != 6: fail(f"B站成本指标卡={r3.get('biliCostKpis')}（应为6）")
        if not {"必火消耗", "三联花费"}.issubset(set(r3.get("biliCostSeriesNames") or [])):
            fail(f"B站双渠道成本柱缺失: {r3.get('biliCostSeriesNames')}")
        if "统一截止星河最新日" not in (r3.get("biliCutoffText") or ""):
            fail("B站成本截止口径提示缺失")
        if (r1.get("biliExcludedSpend") or 0) > 0 and "星河最新日期" not in (r3.get("biliQualityText") or ""):
            fail("B站存在等待归因金额但末端日期截断提示缺失")
        for note in r3.get("biliSourceNotes") or []:
            if not note.get("exists") or note.get("pathCount", 0) < 1:
                fail(f"B站数据来源备注异常: {note}")
        if not r3.get("legendTexts"): fail("水位线图例文案缺失")
        if not r4.get("hasCheckboxes"): fail("表格下拉复选框缺失")
        if not r4.get("hasConfirmBar"): fail("下拉框固定确认栏缺失")
        if r4.get("emptyConfirmText") != "确认": fail(f"0篇确认按钮文案异常: {r4.get('emptyConfirmText')}")
        if r4.get("emptyConfirmDisabled") is not True: fail("0篇确认按钮未禁用")
        if abs(r4.get("scrollAfterSelect") or 0) > 1: fail(f"勾选后候选区跳动: {r4.get('scrollAfterSelect')}px")
        if abs(r4.get("scrollAfterDeselect") or 0) > 1: fail(f"取消勾选后候选区跳动: {r4.get('scrollAfterDeselect')}px")
        if abs(r4.get("pageAfterSelect") or 0) > 1: fail(f"勾选后页面跳动: {r4.get('pageAfterSelect')}px")
        if abs(r4.get("pageAfterDeselect") or 0) > 1: fail(f"取消勾选后页面跳动: {r4.get('pageAfterDeselect')}px")
        if (r4.get("lastItemClearance") or -999) < 0: fail(f"最后一项被确认按钮遮挡: {r4.get('lastItemClearance')}px")
        if r4.get("crossKeywordConfirmText") != "确认 2 篇": fail(f"跨关键词累计文案异常: {r4.get('crossKeywordConfirmText')}")
        if r4.get("firstSelectionPreserved") is not True: fail("切换关键词后此前临时选择丢失")
        if r4.get("rowsWhilePending") != 30: fail(f"待确认时表格行数={r4.get('rowsWhilePending')}（应保持30）")
        if not r4.get("listOpenWhilePending"): fail("勾选后下拉框意外关闭")
        if r4.get("pendingSelected") != 2: fail(f"临时选中态数量={r4.get('pendingSelected')}（应为2）")
        if r4.get("confirmBackground") not in ("rgba(0, 0, 0, 0)", "transparent"): fail("确认按钮外层仍有背景遮挡")
        if r4.get("confirmBorderWidth") != "0px": fail("确认按钮外层仍有边框")
        if r4.get("confirmBoxShadow") != "none": fail("确认按钮外层仍有阴影")
        if r4.get("averageWhilePending") != r4.get("averageBefore"): fail("待确认时总体平均值发生变化")
        if r4.get("selectedAfterDiscard") != 0: fail("点击外部后未放弃临时选择")
        if r4.get("rowsAfterDiscard") != 30: fail("放弃临时选择后表格发生变化")
        if r4.get("rowsAfterConfirm") != 2: fail(f"确认两篇后表格行数={r4.get('rowsAfterConfirm')}（应为2）")
        if r4.get("summaryAfterConfirm") != "已选 2 篇": fail(f"确认后多选摘要异常: {r4.get('summaryAfterConfirm')}")
        if r4.get("averageAfterConfirm") == r4.get("averageBefore"): fail("确认多选后未切换为已选平均值")
        if not (r4.get("averageAfterConfirm") or "").startswith("已选平均|"): fail("多选平均值标签未显示为“已选平均”")
        if abs(r4.get("dockBottomGap") or 0) > 1: fail(f"平均值栏未固定到底部，偏差={r4.get('dockBottomGap')}")
        if (r4.get("dockHeight") or 999) > 28: fail(f"平均值栏高度={r4.get('dockHeight')}px（应不超过28px）")
        if r4.get("averageFrozenLeft") not in (0, 1): fail(f"平均值冻结列横滚后 left={r4.get('averageFrozenLeft')}（应为0/1）")
        if r4.get("rowsAfterClear") != 30: fail(f"清空后当前页行数={r4.get('rowsAfterClear')}（应为30）")
        if r4.get("valueAfterClear") != "": fail("清空后输入框未恢复空值")
        if r4.get("averageAfterClear") != r4.get("averageBefore"): fail("清空后总体平均值发生变化")
        if r4.get("rowsAfterExternal") != 1: fail(f"外部联动后表格行数={r4.get('rowsAfterExternal')}（应为1）")
        if r4.get("externalNoteId") not in (r4.get("valueAfterExternal") or ""): fail("外部联动未替换为对应单篇")
        if r4.get("averageAfterExternal") != r4.get("averageBefore"): fail("单篇外部联动后未恢复全量平均值")
        print("=== 结论:", "PASS ✅" if ok else "FAIL ❌", "===")
        sys.exit(0 if ok else 1)
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except Exception: proc.kill()
        import shutil
        shutil.rmtree(PROFILE, ignore_errors=True)

if __name__ == "__main__":
    main()
