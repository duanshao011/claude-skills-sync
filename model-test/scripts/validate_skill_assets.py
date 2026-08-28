from __future__ import annotations

import json
import py_compile
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from common import DIMENSION_ORDER, discover_cases, skill_root


def fail(message: str, errors: list[str]) -> None:
    errors.append(message)


def main() -> None:
    root = skill_root()
    errors: list[str] = []
    cases = discover_cases(root)

    if len(cases) != 16:
        fail(f"expected 16 enabled cases, found {len(cases)}", errors)

    ids = [case["id"] for case in cases]
    duplicates = [case_id for case_id, count in Counter(ids).items() if count > 1]
    if duplicates:
        fail(f"duplicate case ids: {duplicates}", errors)

    grouped: dict[str, list[dict]] = defaultdict(list)
    for case in cases:
        grouped[case["dimension"]].append(case)
        case_dir = Path(case["_case_dir"])
        for key in ["id", "dimension", "dimension_label", "level", "title", "version", "submission_files", "checks"]:
            if key not in case:
                fail(f"{case_dir}: missing {key}", errors)
        if case.get("level") not in {"standard", "pressure"}:
            fail(f"{case['id']}: invalid level", errors)
        task = case_dir / case.get("task_file", "task.md")
        input_dir = case_dir / case.get("input_dir", "input")
        if not task.is_file():
            fail(f"{case['id']}: missing task.md", errors)
        if not input_dir.is_dir() or not any(path.is_file() for path in input_dir.rglob("*")):
            fail(f"{case['id']}: input directory is empty", errors)
        diagnostics = list(input_dir.rglob("*.inspect.ndjson"))
        if diagnostics:
            fail(f"{case['id']}: diagnostic files leaked into input", errors)
        for check in case.get("checks", []):
            if "type" not in check:
                fail(f"{case['id']}: check without type", errors)
            if check.get("type") == "json_match":
                expected = case_dir / check.get("expected_file", "expected.json")
                if not expected.is_file():
                    fail(f"{case['id']}: missing expected file", errors)
            if check.get("type") == "case_command":
                command = check.get("command") or []
                if len(command) < 2 or not (case_dir / str(command[1])).is_file():
                    fail(f"{case['id']}: missing case validator", errors)

    if set(grouped) != set(DIMENSION_ORDER):
        fail(f"dimension mismatch: {sorted(grouped)}", errors)
    for dimension in DIMENSION_ORDER:
        levels = sorted(case["level"] for case in grouped.get(dimension, []))
        if levels != ["pressure", "standard"]:
            fail(f"{dimension}: expected standard and pressure, found {levels}", errors)

    skill_text = (root / "SKILL.md").read_text(encoding="utf-8")
    if "TODO" in skill_text or "TBD" in skill_text:
        fail("SKILL.md contains unfinished placeholders", errors)
    for reference in re.findall(r"\]\((references/[^)]+)\)", skill_text):
        if not (root / reference).is_file():
            fail(f"SKILL.md broken reference: {reference}", errors)

    for script in sorted((root / "scripts").glob("*.py")):
        try:
            py_compile.compile(str(script), doraise=True)
        except py_compile.PyCompileError as exc:
            fail(f"python syntax error in {script.name}: {exc.msg}", errors)

    if errors:
        print(json.dumps({"status": "failed", "errors": errors}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    print(json.dumps({"status": "passed", "cases": len(cases), "dimensions": len(grouped)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
