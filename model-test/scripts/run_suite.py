from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from build_report import build_report
from collect_telemetry import parse_claude_result, parse_codex_jsonl
from common import (
    aggregate_run,
    discover_cases,
    prepare_case,
    read_json,
    select_cases,
    skill_root,
    utc_now,
    write_json,
)
from validate_case import validate


def _run_id() -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{uuid.uuid4().hex[:6]}"


def _prompt() -> str:
    return """你正在执行一个单模型真实工作测试案例。

完整阅读当前目录的 task.md 和 input/ 中的素材，自主完成任务。最终产物必须写入当前目录的 submission/，不得改动 input/，不得读取父目录中的测试答案、校验器或其他案例。

请像处理真实工作一样规划、调用工具并在交付前自行验证。不要只解释怎么做，也不要把最终答案只写在聊天回复中。完成后用一句话说明已生成哪些文件。"""


def _child_env(agent: str) -> dict[str, str]:
    env = dict(os.environ)
    if agent == "claude":
        env.pop("CLAUDECODE", None)
        env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    return env


def _command(
    agent: str,
    model: str | None,
    workspace: Path,
    max_budget_usd: float | None,
) -> list[str]:
    prompt = _prompt()
    if agent == "claude":
        command = [
            "claude",
            "-p",
            "--output-format",
            "json",
            "--permission-mode",
            "auto",
            "--no-session-persistence",
        ]
        if model:
            command.extend(["--model", model])
        if max_budget_usd is not None:
            command.extend(["--max-budget-usd", str(max_budget_usd)])
        command.append(prompt)
        return command
    command = [
        "codex",
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--approve-for-me",
        "--sandbox",
        "workspace-write",
        "--cd",
        str(workspace),
    ]
    if model:
        command.extend(["--model", model])
    for image_path in sorted((workspace / "input").rglob("*")):
        if image_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            command.extend(["--image", str(image_path)])
    command.append(prompt)
    return command


def _apply_price(
    telemetry: dict[str, Any], model_key: str | None, pricing: dict[str, Any]
) -> dict[str, Any]:
    if telemetry.get("cost", {}).get("value") is not None or not model_key:
        return telemetry
    price = pricing.get("models", {}).get(model_key)
    if not isinstance(price, dict):
        return telemetry
    tokens = telemetry.get("tokens", {})
    if tokens.get("total") is None:
        return telemetry
    input_tokens = float(tokens.get("input") or 0)
    output_tokens = float(tokens.get("output") or 0)
    cache_read = float(tokens.get("cache_read") or tokens.get("cached_input") or 0)
    cache_creation = float(tokens.get("cache_creation") or 0)
    if "cached_input" in tokens:
        input_tokens = max(0, input_tokens - cache_read)
    amount = (
        input_tokens * float(price.get("input", 0))
        + output_tokens * float(price.get("output", 0))
        + cache_read * float(price.get("cache_read", price.get("input", 0)))
        + cache_creation * float(price.get("cache_creation", price.get("input", 0)))
    ) / 1_000_000
    telemetry["cost"] = {
        "status": "calculated",
        "value": round(amount, 8),
        "currency": pricing.get("currency", "USD"),
        "source": f"assets/pricing.json:{model_key}",
    }
    return telemetry


def _execute_case(
    case_state: dict[str, Any],
    agent: str,
    model: str | None,
    timeout_seconds: int,
    max_budget_usd: float | None,
    pricing: dict[str, Any],
) -> None:
    workspace = Path(case_state["workspace"])
    case_run_dir = workspace.parent
    stdout_path = case_run_dir / ("claude-result.json" if agent == "claude" else "codex-events.jsonl")
    stderr_path = case_run_dir / "agent-stderr.txt"
    case_state["status"] = "running"
    case_state["started_at"] = utc_now()
    started = time.perf_counter()
    command = _command(agent, model, workspace, max_budget_usd)
    try:
        completed = subprocess.run(
            command,
            cwd=workspace,
            env=_child_env(agent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            shell=False,
        )
        stdout_path.write_text(completed.stdout, encoding="utf-8")
        stderr_path.write_text(completed.stderr, encoding="utf-8")
        case_state["exit_code"] = completed.returncode
        case_state["status"] = "completed" if completed.returncode == 0 else "failed"
        if completed.returncode != 0:
            case_state["error"] = (completed.stderr or completed.stdout)[-2000:]
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        stdout_path.write_text(stdout, encoding="utf-8")
        stderr_path.write_text(stderr, encoding="utf-8")
        case_state["status"] = "timeout"
        case_state["error"] = f"超过 {timeout_seconds} 秒"
    except FileNotFoundError as exc:
        case_state["status"] = "failed"
        case_state["error"] = f"找不到 Agent 命令：{exc.filename}"
    except Exception as exc:
        case_state["status"] = "failed"
        case_state["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        case_state["duration_seconds"] = round(time.perf_counter() - started, 3)
        case_state["ended_at"] = utc_now()

    if stdout_path.exists() and stdout_path.stat().st_size:
        try:
            telemetry = (
                parse_claude_result(stdout_path)
                if agent == "claude"
                else parse_codex_jsonl(stdout_path)
            )
            case_state["telemetry"] = _apply_price(telemetry, model, pricing)
        except Exception as exc:
            case_state["telemetry_error"] = f"{type(exc).__name__}: {exc}"

    case_state["validation"] = validate(
        Path(case_state["case_source"]), Path(case_state["submission"])
    )


def _new_run(args: argparse.Namespace) -> tuple[Path, dict[str, Any]]:
    cases = select_cases(
        discover_cases(),
        args.mode,
        [item.strip() for item in (args.dimensions or "").split(",") if item.strip()],
    )
    run_id = _run_id()
    output_root = (args.output_root or Path.cwd() / "model-test-runs").resolve()
    run_dir = output_root / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    label = args.model_label or args.model or "当前默认模型"
    run = {
        "schema_version": "1.0",
        "run_id": run_id,
        "agent": args.agent,
        "model": args.model,
        "model_label": label,
        "mode": args.mode,
        "dimensions": args.dimensions,
        "started_at": utc_now(),
        "ended_at": None,
        "isolation": "sequential-child-process",
        "cases": [prepare_case(case, run_dir) for case in cases],
    }
    write_json(run_dir / "run.json", aggregate_run(run))
    return run_dir, run


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one model through the model-test case suite")
    parser.add_argument("--agent", choices=["claude", "codex"])
    parser.add_argument("--model")
    parser.add_argument("--model-label")
    parser.add_argument("--mode", choices=["quick", "full", "focus"], default="quick")
    parser.add_argument("--dimensions")
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--max-budget-usd", type=float)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--resume", type=Path)
    args = parser.parse_args()

    if args.resume:
        run_dir = args.resume.resolve()
        run = read_json(run_dir / "run.json")
        args.agent = run["agent"]
        args.model = run.get("model")
    else:
        if not args.agent:
            parser.error("--agent is required unless --resume is used")
        run_dir, run = _new_run(args)

    pricing_path = skill_root() / "assets" / "pricing.json"
    pricing = read_json(pricing_path) if pricing_path.exists() else {"models": {}}
    run_path = run_dir / "run.json"
    build_report(run_path)
    print(f"运行目录：{run_dir}")

    if args.prepare_only:
        print(f"已准备案例，不调用模型：{run_dir / 'report.html'}")
        return

    for index, case_state in enumerate(run["cases"], start=1):
        if case_state.get("status") == "completed":
            continue
        print(f"[{index}/{len(run['cases'])}] {case_state['dimension_label']} / {case_state['title']}", flush=True)
        _execute_case(
            case_state,
            run["agent"],
            run.get("model"),
            args.timeout_seconds,
            args.max_budget_usd,
            pricing,
        )
        write_json(run_path, aggregate_run(run))
        build_report(run_path)

    run["ended_at"] = utc_now()
    write_json(run_path, aggregate_run(run))
    report_path = build_report(run_path)
    print(f"报告：{report_path}")


if __name__ == "__main__":
    main()
