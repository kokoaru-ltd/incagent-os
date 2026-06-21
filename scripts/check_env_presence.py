#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from argparse import ArgumentParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ENV_FILES = [ROOT / ".env", ROOT / "apps" / "engine" / ".env"]

LOCAL_GROUPS = {
    "local_defaults": ["PORT", "BUSINESS_ID"],
}

EXTERNAL_GROUPS = {
    "llm": ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
    "supabase": ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    "apotrail": [
        "APOTRAIL_BASE_URL",
        "APOTRAIL_SUPABASE_URL",
        "APOTRAIL_SUPABASE_ANON_KEY",
        "APOTRAIL_EMAIL",
        "APOTRAIL_PASSWORD",
    ],
    "slack": ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "SLACK_APP_TOKEN"],
    "freelancer": ["FREELANCER_TOKEN"],
    "x": ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"],
}

OPTIONAL = {
    "slack_webhook": ["SLACK_WEBHOOK"],
    "safety_switches": ["AUTO_BID"],
}

SCOPES = {
    "local": {
        "required": {},
        "optional": {**LOCAL_GROUPS, **OPTIONAL},
    },
    "external": {
        "required": EXTERNAL_GROUPS,
        "optional": OPTIONAL,
    },
    "all": {
        "required": EXTERNAL_GROUPS,
        "optional": {**LOCAL_GROUPS, **OPTIONAL},
    },
}


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def load_values() -> dict[str, str]:
    values: dict[str, str] = {}
    for path in ENV_FILES:
        values.update(parse_env_file(path))
    for key, value in os.environ.items():
        if value:
            values[key] = value
    return values


def present(value: str | None) -> bool:
    return bool(value and value.strip())


def build_report(scope: str) -> dict[str, dict[str, dict[str, bool | str]]]:
    values = load_values()
    report: dict[str, dict[str, dict[str, bool | str]]] = {}
    groups = {**SCOPES[scope]["required"], **SCOPES[scope]["optional"]}
    for group, keys in groups.items():
        report[group] = {}
        for key in keys:
            is_present = present(values.get(key))
            report[group][key] = {
                "status": "present" if is_present else "missing",
                "present": is_present,
            }
    return report


def print_text(report: dict[str, dict[str, dict[str, bool | str]]]) -> None:
    for group, keys in report.items():
        print(f"[{group}]")
        for key, item in keys.items():
            print(f"  {key}: {item['status']}")


def parse_args() -> tuple[str, bool]:
    parser = ArgumentParser(
        description="Report whether INCAGENT environment variables are present without printing values."
    )
    parser.add_argument(
        "--scope",
        choices=sorted(SCOPES),
        default="external",
        help="local checks non-secret local defaults; external checks service credentials; all reports both.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()
    return args.scope, args.json


def main() -> int:
    scope, output_json = parse_args()
    report = build_report(scope)
    if output_json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"scope: {scope}")
        print_text(report)

    missing_required = [
        key
        for group in SCOPES[scope]["required"]
        for key, item in report[group].items()
        if not item["present"]
    ]
    return 1 if missing_required else 0


if __name__ == "__main__":
    raise SystemExit(main())
