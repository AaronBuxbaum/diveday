# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo — one glossary, one ADR log.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists.
- **`docs/architecture/decisions/`** — this repo's ADR log (not the default `docs/adr/`; see [docs/README.md](../README.md) for the full documentation index and the project's own `adr` skill). Read ADRs that touch the area you're about to work in.
- **`AGENTS.md`** — the canonical map of routes, modules, and hard rules for this repo. Read it before `CONTEXT.md`; it is kept current and is the first stop, not a fallback.

If `CONTEXT.md` doesn't exist yet, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms or decisions actually get resolved.

## File structure

```
/
├── AGENTS.md                          ← canonical route map + hard rules (read first)
├── CONTEXT.md                         ← glossary (created lazily by /domain-modeling)
├── docs/
│   ├── README.md                      ← documentation index
│   └── architecture/decisions/        ← ADRs, YYYYMMDD-short-slug ids
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` (once it exists) or as established in `AGENTS.md`. Don't drift to synonyms the docs explicitly avoid.

If the concept you need isn't documented yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR under `docs/architecture/decisions/`, surface it explicitly rather than silently overriding:

> _Contradicts ADR 20260804-day-closeout — but worth reopening because…_

New ADR ids in this repo use the collision-resistant `YYYYMMDD-short-slug` format, per `AGENTS.md`'s "Parallel work" section — never allocate the next integer.
