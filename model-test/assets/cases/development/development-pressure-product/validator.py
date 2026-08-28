import re
import subprocess
import sys
from pathlib import Path

submission = Path(sys.argv[-1]).resolve() / "site"
required = [submission / "index.html", submission / "styles.css", submission / "app.js"]
missing = [path.name for path in required if not path.is_file()]
if missing:
    raise SystemExit(f"missing files: {missing}")

html = required[0].read_text(encoding="utf-8", errors="replace")
css = required[1].read_text(encoding="utf-8", errors="replace")
js = required[2].read_text(encoding="utf-8", errors="replace")

checks = {
    "platform filter": "platform" in (html + js).lower() or "平台" in html,
    "status filter": "status" in (html + js).lower() or "状态" in html,
    "form": "<form" in html.lower(),
    "local storage": "localStorage" in js,
    "event handling": "addEventListener" in js,
    "empty state": "空" in (html + js) or "暂无" in (html + js),
    "responsive css": "@media" in css,
    "seven day intent": "7" in (html + js) or "七" in (html + js),
}
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(f"failed checks: {failed}")
completed = subprocess.run(["node", "--check", str(required[2])], capture_output=True, text=True, encoding="utf-8", errors="replace")
if completed.returncode:
    print(completed.stderr)
    raise SystemExit(completed.returncode)
print("structure and syntax checks passed")
