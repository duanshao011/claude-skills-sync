import re
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[-1]).resolve() / "file-brief"
skill = root / "SKILL.md"
workflow = root / "references" / "workflow.md"
checker = root / "scripts" / "check_input.py"
for path in [skill, workflow, checker]:
    if not path.is_file():
        raise SystemExit(f"missing {path.relative_to(root)}")
text = skill.read_text(encoding="utf-8", errors="replace")
if not re.match(r"^---\s*\n.*?^name:\s*\S+.*?^description:\s*.+?\n---", text, flags=re.S | re.M):
    raise SystemExit("frontmatter invalid")
if "references/workflow.md" not in text:
    raise SystemExit("workflow reference is not discoverable")
if len(text) > 8000:
    raise SystemExit("entrypoint remains bloated")
completed = subprocess.run(["python", str(checker), "--help"], capture_output=True, text=True, encoding="utf-8", errors="replace")
if completed.returncode:
    print(completed.stderr)
    raise SystemExit("check_input.py cannot run")
print("repaired skill passed")
