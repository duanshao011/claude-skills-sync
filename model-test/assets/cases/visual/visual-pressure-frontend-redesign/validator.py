import subprocess
import sys
from pathlib import Path

site = Path(sys.argv[-1]).resolve() / "site"
index = site / "index.html"
styles = site / "styles.css"
app = site / "app.js"
for path in [index, styles, app]:
    if not path.is_file():
        raise SystemExit(f"missing {path.name}")
html = index.read_text(encoding="utf-8", errors="replace")
css = styles.read_text(encoding="utf-8", errors="replace")
js = app.read_text(encoding="utf-8", errors="replace")
combined = html + css + js
required = ["2026-10-18", "13:30", "18:30", "天目里", "60", "2026-10-12", "行走内容实验室"]
missing = [value for value in required if value not in combined]
if missing:
    raise SystemExit(f"missing facts: {missing}")
checks = {
    "responsive": "@media" in css,
    "reduced motion": "prefers-reduced-motion" in css,
    "button": "button" in html.lower(),
    "faq": "常见问题" in html,
    "interaction": "addEventListener" in js,
    "no marquee": "<marquee" not in html.lower(),
    "no remote dependency": "https://" not in html and "http://" not in html,
}
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(f"failed checks: {failed}")
completed = subprocess.run(["node", "--check", str(app)], capture_output=True, text=True, encoding="utf-8", errors="replace")
if completed.returncode:
    print(completed.stderr)
    raise SystemExit(completed.returncode)
print("frontend structure checks passed")
