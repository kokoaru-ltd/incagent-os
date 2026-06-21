# PACKAGES KNOWLEDGE BASE

## OVERVIEW

Shared business parameters, persona guidance, ringi SQL records, and cached skills. This is not a conventional package library.

## STRUCTURE

```
packages/
├── funnel/       # industry funnel coefficients
├── persona/      # Kondo decision model
├── ringi/        # SQL/migration records for approval engine
└── skills/       # skill catalog and cached skill docs
```

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Funnel assumptions | `funnel/industry-params.json` | Initial hypotheses; overwrite with measurements. |
| Agent decision style | `persona/kondo-model.md` | No decision authority; human approval remains required. |
| Approval DB records | `ringi/migrations/` | See child AGENTS before editing. |
| Skill catalog/cache | `skills/README.md`, `skills/registry/`, `skills/cache/` | Security gate matters. |

## CONVENTIONS

- Numeric assumptions are hypotheses until real measurements confirm them.
- Persona docs shape proposals and writing style; they do not grant authority.
- Skill cache files may contain their own strong style rules. Read the target skill before using it.

## ANTI-PATTERNS

- Do not let persona guidance skip approval gates.
- Do not present funnel coefficients as proven data.
- Do not edit cached third-party skill docs casually; prefer adding a wrapper note if needed.
