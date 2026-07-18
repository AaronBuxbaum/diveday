---
name: new-feature
description: Build a product feature end to end — the full loop from docs to verified, reviewed, shipped slice. Use when starting any feature or milestone work.
---

# Build a feature

The full loop. Details live in `docs/engineering/workflow.md` — this is the executable order.

1. **Context** — read `docs/product/roadmap.md` (right milestone?), `docs/product/glossary.md`
   (domain terms), and skim relevant ADRs. Touching Next.js APIs → read the matching guide in
   `node_modules/next/dist/docs/` first.
2. **Slice** — define the smallest vertical slice a user could see working. State it in one
   sentence before coding. If the slice forces a deferred decision (database, auth…), stop and
   do the `adr` skill first.
3. **Domain first** — pure logic in `src/lib/` with unit tests alongside (`pnpm test:watch`).
   Failure paths are part of the slice: full boat, uncertified diver, unsigned waiver.
4. **UI second** — thin routes in `src/app/`, semantic tokens only, copy in briefing voice.
   Add/extend an e2e smoke spec if this is a new critical flow.
5. **Verify** — run the `verify` skill. UI work additionally gets the `design-review` skill.
6. **Document** — update whatever your change invalidated: glossary for new terms, overview
   for structure, roadmap checkbox, ADR index.
7. **Ship** — commit with an imperative subject and a why-body, push, open/refresh the draft
   PR with a summary and screenshots. Keep draft until CI is green.

Definition of done: the checklist in `docs/engineering/workflow.md`. All boxes, no exceptions.
