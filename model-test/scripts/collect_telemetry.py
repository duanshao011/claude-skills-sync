from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) else None


def parse_claude_result(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8", errors="replace").strip()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {}
        for line in reversed(raw.splitlines()):
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                payload = candidate
                break
        if not payload:
            raise
    usage = payload.get("usage") or {}
    input_tokens = _number(usage.get("input_tokens")) or 0
    output_tokens = _number(usage.get("output_tokens")) or 0
    cache_create = _number(usage.get("cache_creation_input_tokens")) or 0
    cache_read = _number(usage.get("cache_read_input_tokens")) or 0
    available = bool(usage)
    total = (
        int(input_tokens + output_tokens + cache_create + cache_read)
        if available
        else None
    )
    cost = _number(payload.get("total_cost_usd"))
    return {
        "tokens": {
            "status": "tool_reported" if available else "unavailable",
            "total": total,
            "input": int(input_tokens) if available else None,
            "output": int(output_tokens) if available else None,
            "cache_creation": int(cache_create) if available else None,
            "cache_read": int(cache_read) if available else None,
            "source": "claude --output-format json" if available else None,
        },
        "cost": {
            "status": "tool_reported" if cost is not None else "unavailable",
            "value": float(cost) if cost is not None else None,
            "currency": "USD",
            "source": "claude result total_cost_usd" if cost is not None else None,
        },
        "session_id": payload.get("session_id"),
        "turns": payload.get("num_turns"),
        "api_duration_ms": payload.get("duration_api_ms"),
    }


def parse_codex_jsonl(path: Path) -> dict[str, Any]:
    usage: dict[str, Any] | None = None
    thread_id = None
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        thread_id = thread_id or event.get("thread_id") or event.get("threadId")
        candidate = event.get("usage")
        if isinstance(candidate, dict):
            usage = candidate
        payload = event.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("usage"), dict):
            usage = payload["usage"]
    usage = usage or {}
    input_tokens = _number(usage.get("input_tokens"))
    output_tokens = _number(usage.get("output_tokens"))
    cached = _number(usage.get("cached_input_tokens"))
    total = _number(usage.get("total_tokens"))
    if total is None and input_tokens is not None and output_tokens is not None:
        total = input_tokens + output_tokens
    available = total is not None
    return {
        "tokens": {
            "status": "tool_reported" if available else "unavailable",
            "total": int(total) if available else None,
            "input": int(input_tokens) if input_tokens is not None else None,
            "output": int(output_tokens) if output_tokens is not None else None,
            "cached_input": int(cached) if cached is not None else None,
            "source": "codex exec --json" if available else None,
        },
        "cost": {
            "status": "unavailable",
            "value": None,
            "currency": "USD",
            "source": None,
        },
        "session_id": thread_id,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", choices=["claude", "codex"], required=True)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    result = (
        parse_claude_result(args.path)
        if args.agent == "claude"
        else parse_codex_jsonl(args.path)
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
