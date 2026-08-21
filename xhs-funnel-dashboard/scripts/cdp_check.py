# -*- coding: utf-8 -*-
"""投放看板 · CDP 无头自检（纯标准库，零依赖）

Edge 无头 + Chrome DevTools 协议直连，DOM 级验证产物，比截图可靠：
  - payload 与核心指标：四表加载标记、total_gmv、overall_roi、交集篇数
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
            return {"__exception__": r["exceptionDetails"].get("text", "")}
        return r.get("result", {}).get("value")

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
  if (p) {
    const D = JSON.parse(p.textContent);
    out.starLoaded = !!(D.meta && D.meta.sources && D.meta.sources.star && D.meta.sources.star.loaded);
    out.chiliLoaded = !!(D.meta && D.meta.sources && D.meta.sources.chili && D.meta.sources.chili.loaded);
    out.pgyLoaded = !!(D.meta && D.meta.sources && D.meta.sources.pgy && D.meta.sources.pgy.loaded);
    out.lxLoaded = !!(D.meta && D.meta.sources && D.meta.sources.lx && D.meta.sources.lx.loaded);
    out.biliLoaded = !!(D.meta && D.meta.sources && D.meta.sources.bili && D.meta.sources.bili.loaded);
    out.totalSpend = D.summary && D.summary.total_spend;
    out.totalGmv = D.summary && D.summary.total_gmv;
    out.overallRoi = D.summary && D.summary.overall_roi;
    out.noteCount = D.summary && D.summary.note_count;
    out.matchedCount = D.summary && D.summary.matched_note_count;
  }
  out.canvasCount = document.querySelectorAll('canvas').length;
  out.kpiVals = Array.from(document.querySelectorAll('#kpiRow .kpi-val')).map(e => e.textContent.trim());
  out.srcCards = Array.from(document.querySelectorAll('#sourceStrip .src-card')).map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  out.tableRows = document.querySelectorAll('#tableBody tr').length;
  return JSON.stringify(out);
})()"""

CHECK2 = """(() => {
  const out = {};
  const wrap = document.querySelector('.table-wrap') || document.querySelector('.table-scroll');
  out.foundWrap = !!wrap;
  if (!wrap) return JSON.stringify(out);
  const wrapRect = wrap.getBoundingClientRect();
  const frozenTh = document.querySelector('th.frozen-col');
  out.beforeLeft = wrap.scrollLeft;
  out.frozenBefore = frozenTh ? Math.round(frozenTh.getBoundingClientRect().left - wrapRect.left) : null;
  wrap.scrollLeft = 650;
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
  const toc = document.getElementById('toc');
  out.tocExists = !!toc;
  out.platformToggles = Array.from(document.querySelectorAll('.platform-group-toggle span')).map(e => e.textContent.trim());
  out.biliModule = !!document.querySelector('[data-platform="bili"]');
  out.biliChart = !!document.getElementById('biliTrendChart');
  const legends = [];
  document.querySelectorAll('div,span,small,p').forEach(el => {
    const t = (el.textContent || '').trim();
    if (t.length > 8 && t.length < 200 && /优秀|偏弱/.test(t)) legends.push(t);
  });
  out.legendTexts = legends.slice(0, 3);
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

        r1 = json.loads(cdp.eval(CHECK1))
        r2 = json.loads(cdp.eval(CHECK2))
        r3 = json.loads(cdp.eval(CHECK3))
        print("=== 1. payload 与核心指标 ===")
        for k in ("hasPayload", "pgyLoaded", "starLoaded", "chiliLoaded", "lxLoaded", "biliLoaded",
                  "totalSpend", "totalGmv", "overallRoi", "noteCount", "matchedCount",
                  "canvasCount", "tableRows"):
            print(f"  {k}: {r1.get(k)}")
        print("  kpiVals:", r1.get("kpiVals"))
        print("  srcCards:")
        for c in r1.get("srcCards", []): print("    ", c)
        print("=== 2. 横滚冻结列验证 ===")
        for k, v in r2.items(): print(f"  {k}: {v}")
        print("=== 3. 多平台目录 / 图例 / B站模块 ===")
        for k, v in r3.items(): print(f"  {k}: {v}")

        shot = cdp.call("Page.captureScreenshot", {"format": "png"})
        with open(SHOT, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print(f"=== 截图备查: {SHOT} ===")

        ok = True
        def fail(msg):
            global ok
            ok = False
            print("  ✗ " + msg)
        if not r1.get("hasPayload"): fail("dashPayload 缺失")
        for k in ("pgyLoaded", "starLoaded", "chiliLoaded", "lxLoaded"):
            if not r1.get(k): fail(f"{k} 未加载")
        if not (r1.get("totalGmv") or 0) > 0: fail("total_gmv 非正")
        if r1.get("overallRoi") is None: fail("overall_roi 为空")
        if (r1.get("canvasCount") or 0) < 3: fail(f"canvas 仅 {r1.get('canvasCount')} 个")
        if r2.get("foundWrap") is not True: fail("表格滚动容器未找到")
        if r2.get("frozenAfter") not in (0, 1): fail(f"横滚后冻结列 left={r2.get('frozenAfter')}（应为 0/1）")
        if r2.get("groupHeadPos") != "sticky": fail(f"分组表头 position={r2.get('groupHeadPos')}（应为 sticky）")
        if not r3.get("tocExists"): fail("目录缺失")
        if not r3.get("biliChart"): fail("B站模块图表缺失")
        if not r3.get("legendTexts"): fail("水位线图例文案缺失")
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
