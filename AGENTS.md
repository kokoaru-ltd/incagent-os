# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-21
**Commit:** 8f31918
**Branch:** setup/incagent-local-readiness

## OVERVIEW

INCAGENT is an autonomous company operating system: goal, budget, approval, then market actions and reporting. This checkout is a mixed artifact workspace, not a standard single app.

## STRUCTURE

```
incagent-os-main/
├── README.md                  # product intent and operating loop
├── HANDOFF.md                 # current state; contains sensitive-looking legacy context
├── refactor-instructions.md   # safety-first implementation plan
├── docs/                      # architecture, onboarding, company strategy
├── apps/console/              # static approval/ringi HTML
├── apps/web/public/           # static landing page; form endpoint is TODO
├── apps/engine/               # Node Slack engine and Supabase edge/migration notes
├── orchestrator/              # Python model pipeline
├── packages/                  # funnel, persona, ringi SQL, skill cache
├── products/                  # offer/listing/fulfillment materials
└── scripts/                   # standalone automation scripts
```

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Understand product intent | `README.md`, `docs/ARCHITECTURE.md` | Approval-before-spend is core. |
| Continue current project state | `HANDOFF.md`, `refactor-instructions.md` | Do not copy secrets from HANDOFF into new docs. |
| Slack engine changes | `apps/engine/src/` | `index.js` switches real/mock by `OPENAI_API_KEY`. |
| Static approval UI | `apps/console/` | Plain HTML surfaces. |
| Python development pipeline | `orchestrator/pipeline.py` | Human confirmation before Codex by default. |
| SQL/ringi reconstruction | `packages/ringi/migrations/` | Some files are records/stubs, not full source of truth. |
| Skill acquisition | `packages/skills/`, `scripts/skill_acquire.py` | Security scan gate before adoption. |
| Sales/offers | `products/` | Treat as business copy, not runtime code. |

## CODE MAP

CodeGraph and LSP are configured for this checkout in Codex Desktop. Reconfirm tool availability with `tool_search` at the start of a new session, then use CodeGraph/LSP for impact checks before broad edits. Reference counts below are still a starting map, not a replacement for task-specific lookup.

| Symbol/File | Type | Location | Refs | Role |
| --- | --- | --- | --- | --- |
| `src/index.js` | Node entry | `apps/engine/src/index.js` | recheck | Starts Slack app, real or mock. |
| `slack-bot.js` | Slack app | `apps/engine/src/slack-bot.js` | recheck | `/incagent`, `/business-select`, approval actions. |
| `reception-leads-cli.js` | CLI | `apps/engine/src/reception-leads-cli.js` | recheck | Builds reception lead CSV/JSON and optional DB insert. |
| `loop.ts` | stub | `apps/engine/src/loop.ts` | recheck | Loop sketch only; DB function is current real loop. |
| `pipeline.py` | CLI | `orchestrator/pipeline.py` | recheck | PM -> architect -> pipe -> Codex workflow. |
| `freelancer_worker.py` | script | `scripts/freelancer_worker.py` | recheck | Freelancer search/proposal workflow. |
| `post_to_x.py` | script | `scripts/post_to_x.py` | recheck | X posting; use dry-run first. |

## CONVENTIONS

- Japanese is the default working language for user-facing notes in this workspace.
- Money, external posting, bids, purchases, production DB changes, and real Slack/API sends require human approval.
- Every paid action needs expected return, risk, and a stop condition.
- Secrets must not be added to code, docs, logs, or chat. Rotate anything that was pasted historically.
- The Supabase schema name `"loop"` must be quoted in SQL and PL/pgSQL.
- Root has no CI, no root package manager config, and no common test runner.
- Work on a branch. Do not commit directly to `main`.

## ANTI-PATTERNS

- Do not run destructive SQL against production Supabase.
- Do not decide whether `loop.ts` or `jiso_loop_tick()` is the source of truth without asking.
- Do not stop or redefine production cron without explicit approval.
- Do not treat migration comments as verified live DB definitions.
- Do not perform real Freelancer/X/Slack/OpenAI actions when a dry-run or draft exists.
- Do not create broad cleanups, renames, or formatting-only changes while working on safety debt.

## COMMANDS

```bash
cd apps/engine && npm install
cd apps/engine && npm start
cd apps/engine && npm run dev
cd apps/engine && npm run leads:reception -- --input sample.html --json
python3 -m py_compile scripts/*.py orchestrator/pipeline.py
python3 scripts/check_env_presence.py --scope local
python3 scripts/check_env_presence.py --scope external
python3 scripts/post_to_x.py --dry-run
python3 scripts/freelancer_worker.py --dry-run
python3 orchestrator/pipeline.py --task-file refactor-instructions.md --dry-run
```

`scripts/skill_acquire.py` may fetch external content and write cache files. Treat it as a controlled acquisition command, not a default local smoke test.

## NOTES

- `HANDOFF.md` includes operational history and sensitive-looking values. Use it for context, not for copying credentials.
- Tests, lint, build, GitHub Actions, Docker, and Makefile are absent.
- `apps/web/public/index.html` has a TODO form endpoint and is not production-complete.
- `__pycache__` files exist in the workspace; avoid expanding that noise.
