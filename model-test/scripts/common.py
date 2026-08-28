from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DIMENSION_ORDER = [
    "content",
    "research",
    "data",
    "local-files",
    "development",
    "web-verification",
    "skill-building",
    "visual",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def discover_cases(root: Path | None = None) -> list[dict[str, Any]]:
    root = root or skill_root()
    cases: list[dict[str, Any]] = []
    for manifest_path in sorted((root / "assets" / "cases").glob("*/*/case.json")):
        manifest = read_json(manifest_path)
        manifest["_case_dir"] = str(manifest_path.parent)
        manifest["_manifest_path"] = str(manifest_path)
        if manifest.get("enabled", True):
            cases.append(manifest)
    order = {name: index for index, name in enumerate(DIMENSION_ORDER)}
    cases.sort(
        key=lambda item: (
            order.get(item["dimension"], 999),
            0 if item["level"] == "standard" else 1,
            item["id"],
        )
    )
    return cases


def select_cases(
    cases: list[dict[str, Any]], mode: str, dimensions: list[str] | None = None
) -> list[dict[str, Any]]:
    dimensions = dimensions or []
    if mode == "quick":
        selected = [case for case in cases if case["level"] == "standard"]
    elif mode == "full":
        selected = list(cases)
    elif mode == "focus":
        if not dimensions:
            raise ValueError("focus mode requires --dimensions")
        unknown = sorted(set(dimensions) - set(DIMENSION_ORDER))
        if unknown:
            raise ValueError(f"unknown dimensions: {', '.join(unknown)}")
        selected = [case for case in cases if case["dimension"] in dimensions]
    else:
        raise ValueError(f"unsupported mode: {mode}")
    if not selected:
        raise ValueError("no enabled cases matched the requested mode")
    return selected


def prepare_case(case: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    case_source = Path(case["_case_dir"])
    case_run_dir = run_dir / "cases" / case["id"]
    workspace = case_run_dir / "workspace"
    submission = workspace / "submission"
    workspace.mkdir(parents=True, exist_ok=True)
    submission.mkdir(parents=True, exist_ok=True)
    shutil.copy2(case_source / case.get("task_file", "task.md"), workspace / "task.md")
    source_input = case_source / case.get("input_dir", "input")
    if source_input.exists():
        shutil.copytree(source_input, workspace / "input", dirs_exist_ok=True)
    return {
        "id": case["id"],
        "dimension": case["dimension"],
        "dimension_label": case["dimension_label"],
        "level": case["level"],
        "title": case["title"],
        "version": case["version"],
        "case_source": str(case_source),
        "workspace": str(workspace),
        "submission": str(submission),
        "status": "prepared",
        "started_at": None,
        "ended_at": None,
        "duration_seconds": None,
        "telemetry": {
            "tokens": {"status": "unavailable", "total": None},
            "cost": {
                "status": "unavailable",
                "value": None,
                "currency": "USD",
            },
        },
        "validation": None,
    }


def aggregate_run(run: dict[str, Any]) -> dict[str, Any]:
    total_duration = sum(
        float(item.get("duration_seconds") or 0) for item in run.get("cases", [])
    )
    token_values = [
        item.get("telemetry", {}).get("tokens", {}).get("total")
        for item in run.get("cases", [])
    ]
    known_tokens = [
        int(value) for value in token_values if isinstance(value, (int, float))
    ]
    costs = [
        item.get("telemetry", {}).get("cost", {}).get("value")
        for item in run.get("cases", [])
    ]
    known_costs = [float(value) for value in costs if isinstance(value, (int, float))]
    case_count = len(run.get("cases", []))
    run["summary"] = {
        "duration_seconds": round(total_duration, 3),
        "tokens_total": (
            sum(known_tokens) if len(known_tokens) == case_count and known_tokens else None
        ),
        "cost_total": (
            round(sum(known_costs), 6)
            if len(known_costs) == case_count and known_costs
            else None
        ),
        "currency": "USD",
        "completed": sum(
            1 for item in run.get("cases", []) if item.get("status") == "completed"
        ),
        "failed": sum(
            1
            for item in run.get("cases", [])
            if item.get("status") in {"failed", "timeout"}
        ),
    }
    return run
