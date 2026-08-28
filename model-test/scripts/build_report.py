from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

from common import DIMENSION_ORDER, aggregate_run, read_json, write_json


TEXT_EXTENSIONS = {
    ".md",
    ".txt",
    ".json",
    ".csv",
    ".tsv",
    ".html",
    ".css",
    ".js",
    ".mjs",
    ".py",
    ".yaml",
    ".yml",
}


def _format_duration(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "未获取"
    seconds = int(round(float(value)))
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}小时{minutes}分{seconds}秒"
    if minutes:
        return f"{minutes}分{seconds}秒"
    return f"{seconds}秒"


def _format_tokens(value: Any) -> str:
    return f"{int(value):,}" if isinstance(value, (int, float)) else "未获取"


def _format_cost(value: Any, currency: str = "USD") -> str:
    if not isinstance(value, (int, float)):
        return "未获取"
    if currency == "USD":
        return f"${float(value):.4f}"
    return f"{float(value):.4f} {currency}"


def _relative_link(report_dir: Path, target: Path) -> str:
    relative = target.resolve().relative_to(report_dir.resolve())
    return quote(relative.as_posix(), safe="/._-")


def _file_preview(report_dir: Path, submission: Path) -> str:
    if not submission.exists():
        return '<p class="empty">没有生成产物</p>'
    files = sorted(path for path in submission.rglob("*") if path.is_file())
    if not files:
        return '<p class="empty">没有生成产物</p>'
    blocks: list[str] = []
    for index, path in enumerate(files):
        relative_name = path.relative_to(submission).as_posix()
        href = _relative_link(report_dir, path)
        preview = ""
        if path.suffix.lower() in TEXT_EXTENSIONS:
            text = path.read_text(encoding="utf-8", errors="replace")
            clipped = len(text) > 6000
            text = text[:6000]
            preview = f'<pre>{html.escape(text)}</pre>'
            if clipped:
                preview += '<p class="clip-note">预览已截断，打开完整文件查看全部内容。</p>'
        blocks.append(
            f'''<article class="artifact{' is-primary' if index == 0 else ''}">
              <div class="artifact-head">
                <strong>{html.escape(relative_name)}</strong>
                <a href="{href}" target="_blank" rel="noopener">打开完整文件</a>
              </div>
              {preview}
            </article>'''
        )
    return "".join(blocks)


def _validation_alert(case: dict[str, Any]) -> str:
    validation = case.get("validation") or {}
    failures = [item for item in validation.get("checks", []) if not item.get("passed")]
    if not failures:
        return ""
    items = "".join(
        f"<li><strong>{html.escape(str(item.get('label', '检查')))}</strong><span>{html.escape(str(item.get('detail', '')))}</span></li>"
        for item in failures
    )
    return f'''<aside class="alert">
      <div class="alert-title">发现 {len(failures)} 项客观问题</div>
      <ul>{items}</ul>
    </aside>'''


def _technical_details(case: dict[str, Any]) -> str:
    telemetry = case.get("telemetry") or {}
    validation = case.get("validation") or {}
    content = json.dumps(
        {
            "status": case.get("status"),
            "started_at": case.get("started_at"),
            "ended_at": case.get("ended_at"),
            "telemetry": telemetry,
            "validation": validation,
            "error": case.get("error"),
        },
        ensure_ascii=False,
        indent=2,
    )
    return f'''<details class="technical">
      <summary>技术详情</summary>
      <pre>{html.escape(content)}</pre>
    </details>'''


def _case_panel(case: dict[str, Any], report_dir: Path, active: bool) -> str:
    workspace = Path(case["workspace"])
    submission = Path(case["submission"])
    task_path = workspace / "task.md"
    task_text = task_path.read_text(encoding="utf-8", errors="replace") if task_path.exists() else "任务文件缺失"
    tokens = case.get("telemetry", {}).get("tokens", {}).get("total")
    cost_info = case.get("telemetry", {}).get("cost", {})
    cost = cost_info.get("value")
    currency = cost_info.get("currency", "USD")
    level_label = "常规任务" if case["level"] == "standard" else "压力任务"
    status = case.get("status")
    status_text = {
        "prepared": "未执行",
        "running": "执行中断",
        "completed": "已完成",
        "failed": "执行失败",
        "timeout": "执行超时",
    }.get(status, str(status or "未知"))
    return f'''<section class="case-panel{' active' if active else ''}" data-level="{html.escape(case['level'])}">
      <div class="case-heading">
        <div>
          <span class="level-label">{level_label}</span>
          <h3>{html.escape(case['title'])}</h3>
        </div>
        {'' if status == 'completed' else f'<span class="status">{html.escape(status_text)}</span>'}
      </div>
      <div class="metrics compact">
        <div><span>耗时</span><strong>{_format_duration(case.get('duration_seconds'))}</strong></div>
        <div><span>Token</span><strong>{_format_tokens(tokens)}</strong></div>
        <div><span>费用</span><strong>{_format_cost(cost, currency)}</strong></div>
      </div>
      {_validation_alert(case)}
      <div class="artifact-list">{_file_preview(report_dir, submission)}</div>
      <details class="task-detail">
        <summary>查看原始任务</summary>
        <pre>{html.escape(task_text)}</pre>
      </details>
      {_technical_details(case)}
    </section>'''


def _dimension_section(dimension: str, cases: list[dict[str, Any]], report_dir: Path) -> str:
    label = cases[0]["dimension_label"]
    duration = sum(float(case.get("duration_seconds") or 0) for case in cases)
    token_values = [case.get("telemetry", {}).get("tokens", {}).get("total") for case in cases]
    tokens = sum(int(value) for value in token_values) if token_values and all(isinstance(value, (int, float)) for value in token_values) else None
    cost_values = [case.get("telemetry", {}).get("cost", {}).get("value") for case in cases]
    cost = sum(float(value) for value in cost_values) if cost_values and all(isinstance(value, (int, float)) for value in cost_values) else None
    currency = cases[0].get("telemetry", {}).get("cost", {}).get("currency", "USD")
    tabs = ""
    if len(cases) > 1:
        tabs = '<div class="case-tabs" role="tablist">' + "".join(
            f'<button type="button" class="tab-button{" active" if index == 0 else ""}" data-target="{html.escape(case["level"])}">{"常规任务" if case["level"] == "standard" else "压力任务"}</button>'
            for index, case in enumerate(cases)
        ) + "</div>"
    panels = "".join(_case_panel(case, report_dir, index == 0) for index, case in enumerate(cases))
    review_buttons = "".join(
        f'<button type="button" data-review="{value}">{value}</button>'
        for value in ["直接可用", "小改可用", "需要大改", "不会使用"]
    )
    return f'''<section class="dimension" id="dimension-{html.escape(dimension)}" data-dimension="{html.escape(dimension)}">
      <header class="dimension-head">
        <div>
          <h2>{html.escape(label)}</h2>
          <p>{len(cases)} 个案例</p>
        </div>
        <div class="dimension-totals">
          <div><span>耗时</span><strong>{_format_duration(duration)}</strong></div>
          <div><span>Token</span><strong>{_format_tokens(tokens)}</strong></div>
          <div><span>费用</span><strong>{_format_cost(cost, currency)}</strong></div>
        </div>
      </header>
      {tabs}
      {panels}
      <div class="review" aria-label="我的判断">
        <div class="review-head"><strong>我的判断</strong><span>看完实际产物后选择</span></div>
        <div class="review-buttons">{review_buttons}</div>
        <details>
          <summary>添加备注</summary>
          <textarea rows="3" placeholder="可选，记录好在哪里或问题是什么"></textarea>
        </details>
      </div>
    </section>'''


def build_html(run: dict[str, Any], report_path: Path) -> str:
    aggregate_run(run)
    summary = run["summary"]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for case in run.get("cases", []):
        grouped.setdefault(case["dimension"], []).append(case)
    sections = "".join(
        _dimension_section(dimension, grouped[dimension], report_path.parent)
        for dimension in DIMENSION_ORDER
        if dimension in grouped
    )
    review_key = f"model-test-review:{run['run_id']}"
    run_json = json.dumps(
        {
            "run_id": run["run_id"],
            "model_label": run.get("model_label"),
            "agent": run.get("agent"),
            "mode": run.get("mode"),
        },
        ensure_ascii=False,
    )
    css = r'''
:root{color-scheme:light;--bg:#f4f6f4;--surface:#ffffff;--surface-soft:#edf2ef;--text:#17201d;--muted:#64716c;--line:#d9e0dc;--accent:#315a52;--accent-soft:#dfece7;--danger:#9a3f36;--danger-soft:#f8e8e5;--radius:14px;font-family:"Segoe UI Variable","Microsoft YaHei UI","PingFang SC",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.6}button,textarea{font:inherit}a{color:var(--accent);text-underline-offset:3px}.shell{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}.top{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(320px,.7fr);gap:48px;align-items:end;padding-bottom:28px;border-bottom:1px solid var(--line)}.top h1{font-size:clamp(34px,5vw,58px);line-height:1.05;letter-spacing:-.045em;margin:0 0 14px}.meta{color:var(--muted);margin:0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.metrics>div{background:var(--surface);padding:18px}.metrics span,.dimension-totals span{display:block;color:var(--muted);font-size:13px;margin-bottom:4px}.metrics strong,.dimension-totals strong{font-variant-numeric:tabular-nums;font-size:19px}.metrics.compact{margin:18px 0 22px}.metrics.compact>div{background:var(--surface-soft);padding:12px 14px}.metrics.compact strong{font-size:16px}.dimension{margin-top:34px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.dimension-head{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center;padding:24px 28px;border-bottom:1px solid var(--line)}.dimension-head h2{font-size:24px;letter-spacing:-.02em;margin:0}.dimension-head p{color:var(--muted);font-size:13px;margin:2px 0 0}.dimension-totals{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:24px}.dimension-totals strong{font-size:15px}.case-tabs{display:flex;gap:6px;padding:18px 28px 0}.tab-button{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:9px;padding:8px 14px;cursor:pointer}.tab-button.active{background:var(--accent);color:white;border-color:var(--accent)}.tab-button:focus-visible,.review-buttons button:focus-visible,summary:focus-visible{outline:3px solid #84a99f;outline-offset:2px}.case-panel{display:none;padding:22px 28px 28px}.case-panel.active{display:block}.case-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.case-heading h3{font-size:20px;margin:4px 0 0}.level-label{font-size:12px;color:var(--muted)}.status{color:var(--danger);background:var(--danger-soft);padding:5px 9px;border-radius:7px;font-size:12px}.artifact-list{display:grid;gap:14px}.artifact{border-top:1px solid var(--line);padding-top:16px}.artifact-head{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:12px}.artifact-head strong{overflow-wrap:anywhere}.artifact-head a{white-space:nowrap;font-size:13px}.artifact pre,.task-detail pre,.technical pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f9f8;border:1px solid var(--line);border-radius:10px;padding:18px;max-height:520px;overflow:auto;font-family:"Cascadia Mono","Microsoft YaHei UI",monospace;font-size:13px;line-height:1.65}.clip-note,.empty{color:var(--muted);font-size:13px}.task-detail,.technical{margin-top:16px}.task-detail summary,.technical summary,.review summary{cursor:pointer;color:var(--muted);font-size:13px}.alert{background:var(--danger-soft);border-left:3px solid var(--danger);padding:14px 16px;margin:0 0 22px}.alert-title{font-weight:700}.alert ul{margin:8px 0 0;padding-left:20px}.alert li span{display:block;color:#684b46;font-size:13px}.review{border-top:1px solid var(--line);padding:22px 28px 26px;background:#fbfcfb}.review-head{display:flex;align-items:baseline;gap:12px}.review-head span{font-size:13px;color:var(--muted)}.review-buttons{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.review-buttons button{border:1px solid var(--line);border-radius:9px;background:white;color:var(--text);padding:10px;cursor:pointer}.review-buttons button:hover{border-color:#8ba59e}.review-buttons button.selected{background:var(--accent);border-color:var(--accent);color:white}.review textarea{width:100%;margin-top:10px;border:1px solid var(--line);border-radius:9px;padding:12px;resize:vertical;color:var(--text)}.footer-actions{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-top:28px}.export{border:0;border-radius:9px;background:var(--accent);color:white;padding:11px 16px;cursor:pointer}.save-state{color:var(--muted);font-size:13px}@media(max-width:760px){.shell{width:min(100% - 20px,1120px);padding-top:28px}.top{grid-template-columns:1fr;gap:24px}.metrics{grid-template-columns:1fr}.dimension-head{grid-template-columns:1fr;padding:20px}.dimension-totals{grid-template-columns:repeat(3,1fr);gap:10px}.dimension-totals strong{font-size:13px}.case-tabs{padding:16px 20px 0}.case-panel{padding:20px}.review{padding:20px}.review-buttons{grid-template-columns:1fr 1fr}.artifact-head{align-items:flex-start;flex-direction:column;gap:6px}.footer-actions{align-items:flex-start;flex-direction:column}}
'''
    script = f'''
const STORAGE_KEY = {json.dumps(review_key)};
const RUN_META = {run_json};
function readReviews() {{ try {{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{{}}'); }} catch {{ return {{}}; }} }}
function saveReviews(data) {{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); document.querySelector('.save-state').textContent = '已保存在此浏览器'; }}
const reviews = readReviews();
document.querySelectorAll('.dimension').forEach(section => {{
  const id = section.dataset.dimension;
  section.querySelectorAll('.tab-button').forEach(button => button.addEventListener('click', () => {{
    section.querySelectorAll('.tab-button').forEach(item => item.classList.toggle('active', item === button));
    section.querySelectorAll('.case-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.level === button.dataset.target));
  }}));
  const saved = reviews[id] || {{}};
  section.querySelectorAll('[data-review]').forEach(button => {{
    if (button.dataset.review === saved.rating) button.classList.add('selected');
    button.addEventListener('click', () => {{
      section.querySelectorAll('[data-review]').forEach(item => item.classList.remove('selected'));
      button.classList.add('selected'); reviews[id] = reviews[id] || {{}}; reviews[id].rating = button.dataset.review; saveReviews(reviews);
    }});
  }});
  const textarea = section.querySelector('textarea'); textarea.value = saved.note || '';
  textarea.addEventListener('input', () => {{ reviews[id] = reviews[id] || {{}}; reviews[id].note = textarea.value; saveReviews(reviews); }});
}});
document.querySelector('.export').addEventListener('click', () => {{
  const payload = {{...RUN_META, exported_at: new Date().toISOString(), reviews: readReviews()}};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {{type:'application/json'}});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${{RUN_META.run_id}}-人工评审.json`; link.click(); URL.revokeObjectURL(link.href);
}});
'''
    return f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{html.escape(str(run.get('model_label') or run.get('model') or '当前模型'))} 模型测试</title>
  <style>{css}</style>
</head>
<body>
  <main class="shell">
    <header class="top">
      <div>
        <h1>{html.escape(str(run.get('model_label') or run.get('model') or '当前模型'))}</h1>
        <p class="meta">{html.escape(str(run.get('agent', '')).title())} / {html.escape(str(run.get('mode', '')))} / {html.escape(str(run.get('started_at', '')))}</p>
      </div>
      <div class="metrics" aria-label="本次测试总成本">
        <div><span>总耗时</span><strong>{_format_duration(summary.get('duration_seconds'))}</strong></div>
        <div><span>总 Token</span><strong>{_format_tokens(summary.get('tokens_total'))}</strong></div>
        <div><span>总费用</span><strong>{_format_cost(summary.get('cost_total'), summary.get('currency', 'USD'))}</strong></div>
      </div>
    </header>
    {sections}
    <div class="footer-actions">
      <span class="save-state">人工判断保存在此浏览器</span>
      <button type="button" class="export">导出人工评审</button>
    </div>
  </main>
  <script>{script}</script>
</body>
</html>'''


def build_report(run_path: Path, output_path: Path | None = None) -> Path:
    run = read_json(run_path)
    aggregate_run(run)
    write_json(run_path, run)
    output_path = output_path or run_path.parent / "report.html"
    output_path.write_text(build_html(run, output_path), encoding="utf-8")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_json", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    path = build_report(args.run_json.resolve(), args.output.resolve() if args.output else None)
    print(path)


if __name__ == "__main__":
    main()
