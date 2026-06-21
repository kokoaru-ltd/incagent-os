# RINGI SQL KNOWLEDGE BASE

## OVERVIEW

Migration records for the approval engine. This area is safety-critical because live behavior may exist only in production Supabase.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Initial schema | `migrations/0001_ringi_engine_init.sql` | Base `"loop"` schema record. |
| RPC layer | `migrations/0002_rpc_layer.sql` | May be comment/stub only. |
| Slack notification triggers | `migrations/0003_slack_notify.sql` | May be record-only debt. |
| Execution layer | `migrations/0004_execution_layer.sql` | May be record-only debt. |

## CONVENTIONS

- Always quote the schema as `"loop"` in SQL and PL/pgSQL.
- Treat production DB definitions as the source to reconstruct, not something to overwrite.
- Additive, idempotent migration files are preferred.
- Validate on local or branch DB before any production discussion.

## ANTI-PATTERNS

- Do not run `DROP`, `DELETE`, `TRUNCATE`, or destructive `ALTER` against production.
- Do not change RPC signatures, Edge Function interfaces, cron behavior, or approval secret checks without approval.
- Do not stop `jiso-loop-tick` cron.
- Do not assume comment-only migrations reproduce production behavior.

## VERIFICATION NOTES

- Required D1 proof is branch/local DB migration apply, then `select jiso_loop_tick();` behavior check.
- Slack trigger text and firing conditions must remain unchanged unless reviewed.
