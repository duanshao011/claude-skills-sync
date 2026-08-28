import json
import subprocess
import sys
from pathlib import Path

submission = Path(sys.argv[-1]).resolve()
app = submission / "app" / "app.js"
if not app.is_file():
    raise SystemExit("missing app/app.js")
probe = """
const mod = require(process.argv[1]);
const result = {
  all: mod.filterTasks(mod.tasks, 'all').length,
  active: mod.filterTasks(mod.tasks, 'active').length,
  paused: mod.filterTasks(mod.tasks, 'paused').length,
  total: mod.calculateTotal(mod.tasks)
};
console.log(JSON.stringify(result));
"""
completed = subprocess.run(["node", "-e", probe, str(app)], capture_output=True, text=True, encoding="utf-8", errors="replace")
if completed.returncode:
    print(completed.stderr)
    raise SystemExit(completed.returncode)
result = json.loads(completed.stdout.strip())
expected = {"all": 3, "active": 2, "paused": 1, "total": 307.5}
if result != expected:
    raise SystemExit(f"unexpected result: {result}")
print("functional checks passed")
