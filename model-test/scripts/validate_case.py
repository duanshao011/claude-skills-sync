from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from common import read_json, utc_now, write_json


ALLOWED_COMMANDS = {"python", "python.exe", "node", "node.exe"}


def _safe_path(root: Path, relative: str) -> Path:
    target = (root / relative).resolve()
    root_resolved = root.resolve()
    if target != root_resolved and root_resolved not in target.parents:
        raise ValueError(f"path escapes submission directory: {relative}")
    return target


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _dot_get(payload: Any, dotted: str) -> Any:
    current = payload
    for part in dotted.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            raise KeyError(dotted)
    return current


def _compare(actual: Any, expected: Any, tolerance: float) -> bool:
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return abs(float(actual) - float(expected)) <= tolerance
    return actual == expected


def _result(check: dict[str, Any], passed: bool, detail: str) -> dict[str, Any]:
    return {
        "type": check["type"],
        "label": check.get("label", check["type"]),
        "severity": check.get("severity", "error"),
        "passed": passed,
        "detail": detail,
    }


def run_check(
    check: dict[str, Any], case_dir: Path, submission: Path
) -> dict[str, Any]:
    check_type = check["type"]
    try:
        if check_type == "file_exists":
            path = _safe_path(submission, check["path"])
            return _result(check, path.is_file(), f"{check['path']}: {'存在' if path.is_file() else '缺失'}")

        if check_type == "file_count":
            base = _safe_path(submission, check.get("path", "."))
            pattern = check.get("pattern", "*")
            count = sum(1 for path in base.glob(pattern) if path.is_file()) if base.exists() else 0
            minimum = int(check.get("min", 0))
            maximum = int(check.get("max", 10**9))
            return _result(check, minimum <= count <= maximum, f"文件数 {count}，要求 {minimum}-{maximum}")

        if check_type in {"text_length", "contains_all", "contains_none", "regex_count", "url_count"}:
            path = _safe_path(submission, check["path"])
            if not path.is_file():
                return _result(check, False, f"缺少文件 {check['path']}")
            text = _read_text(path)
            if check_type == "text_length":
                compact = re.sub(r"\s+", "", text)
                minimum = int(check.get("min", 0))
                maximum = int(check.get("max", 10**9))
                return _result(check, minimum <= len(compact) <= maximum, f"非空白字符 {len(compact)}，要求 {minimum}-{maximum}")
            if check_type == "contains_all":
                missing = [value for value in check.get("values", []) if value not in text]
                return _result(check, not missing, "全部出现" if not missing else f"缺少：{', '.join(missing)}")
            if check_type == "contains_none":
                found = [value for value in check.get("values", []) if value in text]
                return _result(check, not found, "未发现禁用项" if not found else f"发现：{', '.join(found)}")
            if check_type == "regex_count":
                count = len(re.findall(check["pattern"], text, flags=re.MULTILINE))
                minimum = int(check.get("min", 0))
                maximum = int(check.get("max", 10**9))
                return _result(check, minimum <= count <= maximum, f"匹配 {count} 次，要求 {minimum}-{maximum}")
            urls = re.findall(r"https?://[^\s)\]>\"']+", text)
            minimum = int(check.get("min", 0))
            return _result(check, len(urls) >= minimum, f"链接 {len(urls)} 个，至少 {minimum} 个")

        if check_type in {"json_keys", "json_match"}:
            path = _safe_path(submission, check["path"])
            if not path.is_file():
                return _result(check, False, f"缺少文件 {check['path']}")
            actual = read_json(path)
            if check_type == "json_keys":
                missing = []
                for key in check.get("keys", []):
                    try:
                        _dot_get(actual, key)
                    except KeyError:
                        missing.append(key)
                return _result(check, not missing, "字段齐全" if not missing else f"缺少字段：{', '.join(missing)}")
            expected_path = case_dir / check.get("expected_file", "expected.json")
            expected = read_json(expected_path)
            keys = check.get("keys") or list(expected.keys())
            tolerance = float(check.get("tolerance", 0))
            mismatches = []
            for key in keys:
                try:
                    actual_value = _dot_get(actual, key)
                    expected_value = _dot_get(expected, key)
                except KeyError:
                    mismatches.append(f"{key}=缺失")
                    continue
                if not _compare(actual_value, expected_value, tolerance):
                    mismatches.append(f"{key}: {actual_value!r} != {expected_value!r}")
            detail = "关键答案一致" if not mismatches else "；".join(mismatches[:8])
            return _result(check, not mismatches, detail)

        if check_type in {"command", "case_command"}:
            command = check.get("command") or []
            if not command or Path(str(command[0])).name.lower() not in ALLOWED_COMMANDS:
                return _result(check, False, "命令不在允许列表")
            if check_type == "case_command":
                if len(command) < 2:
                    return _result(check, False, "案例校验命令缺少脚本")
                script_path = (case_dir / str(command[1])).resolve()
                if case_dir.resolve() not in script_path.parents or not script_path.is_file():
                    return _result(check, False, "案例校验脚本无效")
                command = [command[0], str(script_path), *command[2:], str(submission.resolve())]
            cwd = _safe_path(submission, check.get("cwd", "."))
            completed = subprocess.run(
                [str(value) for value in command],
                cwd=cwd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=int(check.get("timeout_seconds", 30)),
                shell=False,
            )
            output = (completed.stdout + "\n" + completed.stderr).strip()
            if len(output) > 1200:
                output = output[-1200:]
            return _result(check, completed.returncode == 0, f"退出码 {completed.returncode}\n{output}")

        return _result(check, False, f"未知检查类型：{check_type}")
    except Exception as exc:
        return _result(check, False, f"检查异常：{type(exc).__name__}: {exc}")


def validate(case_dir: Path, submission: Path) -> dict[str, Any]:
    manifest = read_json(case_dir / "case.json")
    results = [run_check(check, case_dir, submission) for check in manifest.get("checks", [])]
    error_failures = [item for item in results if not item["passed"] and item["severity"] == "error"]
    warnings = [item for item in results if not item["passed"] and item["severity"] == "warning"]
    return {
        "case_id": manifest["id"],
        "checked_at": utc_now(),
        "status": "failed" if error_failures else "passed",
        "error_count": len(error_failures),
        "warning_count": len(warnings),
        "checks": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-dir", type=Path, required=True)
    parser.add_argument("--submission", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = validate(args.case_dir.resolve(), args.submission.resolve())
    if args.output:
        write_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
