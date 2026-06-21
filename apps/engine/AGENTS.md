# ENGINE KNOWLEDGE BASE

## OVERVIEW

Node Slack engine for INCAGENT plus Supabase edge/migration records. This is the main runtime code area.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Start app | `src/index.js` | Uses real Slack bot only when `OPENAI_API_KEY` is set. |
| Slack commands/actions | `src/slack-bot.js` | `/incagent`, `/business-select`, `select_`, `approve_`, `reject_`, apotrail buttons. |
| Mock Slack flow | `src/slack-bot-mock.js` | Used when `OPENAI_API_KEY` is missing. |
| Supabase access | `src/db.js` | Check env handling before DB work. |
| Goal/proposal generation | `src/incagent-agent.js` | AI proposal logic. |
| Apotrail integration | `src/apotrail-client.js` | External call/campaign surface. |
| Reception lead generation | `src/reception-lead-generator.js`, `src/reception-leads-cli.js` | CLI can output CSV or JSON. |
| Future loop sketch | `src/loop.ts` | Stub; do not treat as active source of truth. |
| Edge function notes | `supabase/functions/` | Supabase runtime surface. |
| DB migration notes | `supabase/migrations/` | Local record of schema changes. |

## CONVENTIONS

- Node must be >=18.
- Package scripts are only `start`, `dev`, and `leads:reception`; no test/lint/build scripts exist.
- `OPENAI_API_KEY` changes app behavior. Without it, startup uses mock Slack logic.
- Slack app is Socket Mode and needs `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, and `SLACK_APP_TOKEN`.
- Avoid real external actions while developing. Prefer mock mode, dry-run, or file input.
- Button text may be Japanese, but live approval notifications are currently described as English in handoff docs.

## ANTI-PATTERNS

- Do not spend call credits or trigger real outbound calling without explicit approval.
- Do not open `light-fiber` or other preparing businesses just because code has buttons.
- Do not move loop authority from DB SQL to `loop.ts` without a product decision.
- Do not commit or document secrets from `.env`.
- Do not add broad test tooling unless the task is to create the baseline safety net.

## COMMANDS

```bash
npm install
npm start
npm run dev
npm run leads:reception -- --input sample.html --json
```

## VERIFICATION NOTES

- There is no built-in automated test suite.
- For reception leads, use a saved HTML input before fetching a live URL.
- For startup checks, ensure missing env vars do not accidentally switch from mock to real mode.
