# ORCHESTRATOR KNOWLEDGE BASE

## OVERVIEW

Python pipeline that turns a development task into PM, architecture, piped Codex instructions, and optional Codex execution.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Pipeline entry | `pipeline.py` | `argparse` CLI. |
| Usage | `README.md` | Documents dry-run and auto-Codex behavior. |
| Generated outputs | `artifacts/` | Created at runtime; audit trail only. |

## CONVENTIONS

- Default flow stops before Codex and asks for human confirmation.
- `--dry-run` must be used for planning-only checks.
- `--auto-codex` is an execution mode; use only when explicitly approved.
- Model names and prompts are embedded in `pipeline.py`.
- The pipeline reads `README.md`, `refactor-instructions.md`, and `docs/ARCHITECTURE.md` as repo context.

## ANTI-PATTERNS

- Do not use `--auto-codex` to bypass human review for code, money, production, or external actions.
- Do not paste API keys into prompt files or artifacts.
- Do not treat generated plans as approved implementation scope unless the stop/approval rules are satisfied.

## COMMANDS

```bash
python3 -m py_compile orchestrator/pipeline.py
python3 orchestrator/pipeline.py --task-file refactor-instructions.md --dry-run
python3 orchestrator/pipeline.py "D1 を完遂しろ"
```
