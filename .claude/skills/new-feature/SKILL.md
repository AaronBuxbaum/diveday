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
   A new critical flow gets an `e2e/` spec (happy + failure path); a new surface gets an Argos
   snapshot in `e2e/visual.spec.ts`. Render relative time via `nowDate()` from `src/lib/clock.ts`,
   never a bare `new Date()`. See the `e2e-and-argos` skill.
5. **Verify** — run the `verify` skill. UI work additionally gets the `design-review` skill.
6. **Document** — update whatever your change invalidated: glossary for new terms, overview
   for structure, roadmap checkbox, ADR index.
7. **Ship** — commit with an imperative subject and a why-body, push, open/refresh the draft
   PR with a summary and screenshots. Keep draft until CI is green.
8. **Close the Argos loop** — pushing is not the end of the turn. CI's e2e job uploads an Argos
   build ~10–15 minutes after push, and on any UI change it will sit at "waiting for your
   decision" (a red `argos` check) until someone triages it. That someone is you: subscribe to
   the PR's activity, schedule a check-in (`send_later` ~10 min), and when the build lands run
   the `argos-triage` skill — approve the diffs your change explains, comment on the ones it
   doesn't. The PR is not done while its Argos build is untriaged.

Definition of done: the checklist in `docs/engineering/workflow.md`. All boxes, no exceptions.
