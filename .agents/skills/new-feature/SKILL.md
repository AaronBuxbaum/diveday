---
name: new-feature
description: Build a feature from scoped contracts through verified, reviewed delivery.
---

# Build a feature

The full loop. Details live in `docs/engineering/workflow.md` — this is the executable order.

1. **Context** — search the relevant milestone in `docs/product/features/roadmap.md` and relevant glossary terms
   (`docs/product/glossary.md` indexes the domain files under `docs/product/glossary/`), and skim relevant ADRs. Touching Next.js APIs → read the matching guide in
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
   content's own shape asks for. A significant new surface writes those answers down in
   [`docs/design/surfaces.md`](../../../docs/design/surfaces.md) — five sentences, once — and states
   the one idea in a comment beside whatever code the idea constrains.
5. **UI second** — thin routes in `src/app/`, semantic tokens only, copy in briefing voice.
   Render relative time via `nowDate()` from `src/lib/clock.ts`, never a bare `new Date()`. Each
   test's layer is
   [testing.md](../../../docs/engineering/testing.md#how-a-change-decides-its-tests)'s six-step
   list: a changed flow extends the spec that walks it (found by role and message key, never a
   sentence), a new screen or state gets the capture captures.md says it earns, and a new journey a
   shop could not run a day without gets a row in testing.md's
   [critical journeys](../../../docs/engineering/testing.md#critical-journeys); a geometry fix is
   proven by a capture, a rule over source by a `check:repo` guard, never a class or source
   assertion beside the component. See the `e2e-and-visual` skill.
6. **Verify** — run the `verify` skill. UI work additionally gets the `design-review` skill.
7. **Document** — update whatever your change invalidated: glossary for new terms, overview
   for structure, roadmap checkbox, ADR index.
8. **File the follow-ups** — a bug, a safety gap, or a decision the build raised: one GitHub issue
   each, labelled `needs-triage` (see
   [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)'s "Filing a follow-up"
   section), each ending in a prompt a fresh session could run, listed by number in the PR
   description. The slice left for later and the debt seen in passing go in one "Notes" comment
   on the PR.
9. **Ship** — commit with an imperative subject and a why-body, push, open/refresh the draft
   PR with a summary and screenshots. Keep draft until CI is green. **The branch was cut from the
   newest open branch across all threads**, related or not, so this is a layer of a stack
   unless one of the four exceptions applies — open it as a draft at its first commit and register it
   then, never at the end (the `stacked-prs` skill).
10. **Close the visual loop** — read CI's sticky visual summary and fetch its exact commit with `pnpm visual:report --commit <sha>`. The workflow publishes S3 captures/comparisons; it does not push a baseline commit or start a follow-up visual-only check. Capture/test failures must be fixed, and every changed/new/deleted image explained with the **visual-triage** skill. A green visual job alone is not image approval.
11. **Answer the review.** `gh api repos/AaronBuxbaum/diveday/issues/<n>/comments` and
   `.../pulls/<n>/comments` (REST; `gh pr view` is GraphQL and refused in cloud sessions) — `sourcery-ai` reviews
   every pull request here within minutes, and Aaron's comments arrive later. Each open thread gets
   an action and a reply: fixed (push, then say which commit), declined with the reason (a nitpick
   that contradicts a rule in AGENTS.md is declined by naming it), or filed as a `needs-triage`
   issue whose number goes in the thread. A bot is often wrong about this repository's conventions —
   check its claim against `pnpm check:repo` before you act on it. Unread threads mean the PR is not
   done; see AGENTS.md's Hard rules for reading the open ones via GraphQL, and for the GitHub MCP
   calls that stand in where `gh` is absent. One bot reads the diff, not two: `coderabbitai` is
   installed but declines this repository for having fewer than 10 stars, so a quiet PR is thinner
   evidence than it looks.

Definition of done: the checklist in `docs/engineering/workflow.md`. All boxes, no exceptions.
