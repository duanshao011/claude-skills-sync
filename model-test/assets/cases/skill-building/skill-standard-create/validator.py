import re
import sys
from pathlib import Path

root = Path(sys.argv[-1]).resolve() / "weekly-review"
skill = root / "SKILL.md"
if not skill.is_file():
    raise SystemExit("missing SKILL.md")
text = skill.read_text(encoding="utf-8", errors="replace")
match = re.match(r"^---\s*\n(.*?)\n---", text, flags=re.S)
if not match:
    raise SystemExit("invalid frontmatter")
frontmatter = match.group(1)
if not re.search(r"^name:\s*\S+", frontmatter, flags=re.M):
    raise SystemExit("missing name")
if not re.search(r"^description:\s*.+", frontmatter, flags=re.M):
    raise SystemExit("missing description")
if "TODO" in text or "TBD" in text:
    raise SystemExit("unfinished placeholders")
if len(text) > 12000:
    raise SystemExit("SKILL.md is unexpectedly large")
print("skill structure passed")
