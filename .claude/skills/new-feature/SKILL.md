---
name: new-feature
description: Build a product feature end to end — the full loop from docs to verified, reviewed, shipped slice. Use when starting any feature or milestone work.
---

# Build a feature

The full loop. Details live in `docs/engineering/workflow.md` — this is the executable order.

1. **Context** — read `docs/product/features/roadmap.md` (right milestone?), `docs/product/glossary.md`
   (domain terms), and skim relevant ADRs. Touching Next.js APIs → read the matching guide in
   `node_modules/next/dist/docs/` first.
2. **Slice** — define the smallest vertical slice a user could see working. State it in one
   sentence before coding. If the slice forces a deferred decision (database, auth…), stop and
   do the `adr` skill first.
3. **Domain first** — pure logic in `src/lib/` with unit tests alongside (`pnpm test:watch`).
   Failure paths are part of the slice: full boat, uncertified diver, unsigned waiver.
4. **Design before UI** — for any new or reshaped surface, spend a moment on
   `docs/design/principles.md` §10–11 *before* writing components: state the screen's one idea in
   a sentence, list the questions its user arrives with (the screen should carry the answers
   inline, not behind clicks), and sketch at least two compositions in prose — attach actions to
   the objects they affect and prefer in-place edits with undo over button-and-form detours. The
   default card-stack-plus-button-row is the fallback, not the target; pick the composition the
   content's own shape asks for.
5. **UI second** — thin routes in `src/app/`, semantic tokens only, copy in briefing voice.
   A new critical flow gets an `e2e/` spec (happy + failure path); a new surface gets a visual
   snapshot in `e2e/visual.spec.ts`. Render relative time via `nowDate()` from `src/lib/clock.ts`,
   never a bare `new Date()`. See the `e2e-and-visual` skill.
6. **Verify** — run the `verify` skill. UI work additionally gets the `design-review` skill.
7. **Document** — update whatever your change invalidated: glossary for new terms, overview
   for structure, roadmap checkbox, ADR index.
8. **Ship** — commit with an imperative subject and a why-body, push, open/refresh the draft
   PR with a summary and screenshots. Keep draft until CI is green.
9. **Close the visual loop** — pushing is not the end of the turn. A UI change that shifts pixels
   makes the serialized visual job commit regenerated baselines as a separate
   `ci: capture visual baseline diffs` commit when CI can push to the branch. Watch that commit and
   the follow-up visual-only check; run the `visual-triage` skill for any red visual job, forked
   PR, or diff the generated baseline commit does not explain. The PR is not done while a visual
   diff or failure is unexplained.

Definition of done: the checklist in `docs/engineering/workflow.md`. All boxes, no exceptions.
