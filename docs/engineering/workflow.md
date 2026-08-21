# Engineering workflow

How to build anything here. Written for AI agents; humans may follow along.

## Before writing code

1. Read [docs/README.md](../README.md) and the docs relevant to the task (glossary for domain
   work, principles for UI work, overview + ADRs for structural work).
2. Touching Next.js APIs? Read the relevant guide in `node_modules/next/dist/docs/` first —
   Next 16 differs from training data.
3. Check [product/features/roadmap.md](../product/features/roadmap.md) — build the current
   milestone's slice, not a future one.

## The loop

1. **Plan** the smallest vertical slice that a user could see working.
2. **Domain logic first** — pure functions in `src/lib/`, unit-tested as you go
   (`pnpm test:watch`).
3. **UI second** — token-styled (ADR-0004), copy per the voice rules
   ([design/principles.md](../design/principles.md)).
4. **Verify** — the `verify` skill: `pnpm check`, `pnpm e2e` when flows changed, and for UI
   work look at the running app (screenshot light + dark) — never ship UI you haven't seen.
5. **Document** — update any doc your change invalidates; new hard-to-reverse choice → ADR
   (`adr` skill); new domain term → glossary.
6. **File what you didn't do** — every idea, question, risk, or cleanup you are leaving behind
   becomes a GitHub issue labelled `needs-triage` (see
   [../agents/issue-tracker.md](../agents/issue-tracker.md)'s "Filing a follow-up" section), listed
   by number in the PR description. Write it for a reader with none of your context, ending in a
   prompt they can paste into a fresh session. This is not a way to defer the work you were asked to
   do.
7. **Ship** — commit (imperative subject, body says why), push, keep the PR draft until CI is
   green and the checklist below passes.
8. **Account for visual diffs** — CI captures the visual surfaces and has `reg-suit` diff them
   against the S3 baseline for the branch's parent commit
   ([ADR](../architecture/decisions/20260729-reg-suit-visual-regression.md)). Read every diff image
   for what your code explains. There is nothing to regenerate or commit: baselines are keyed to
   git commits in S3, so an intentional change becomes the next baseline by being merged — which
   makes saying *why* the pixels moved the whole of "approving" it. If diffs remain unexplained,
   run the `visual-triage` skill. Don't end the session's responsibility at "pushed".

## Definition of done

- [ ] `pnpm check` green; `pnpm e2e` green when flows changed
- [ ] New logic has tests that fail without it
- [ ] UI seen in browser, light + dark; design checklist passes for user-facing changes
- [ ] Docs/ADR/glossary updated in the same PR
- [ ] Every follow-up, open question, and deliberately-skipped cleanup filed as a `needs-triage`
      GitHub issue — nothing left only in the closing message
- [ ] No leftover debug code, no `biome-ignore` without a reason string
- [ ] Any visual diffs reviewed for expected changes; any red visual result triaged
      (`visual-triage` skill) with a comment for the human

## Rules

- **Never skip verify.** A green `pnpm check` is the floor, not the ceiling.
- **New runtime dependency = ADR** (or an entry in an existing one). Dev-tool bumps exempt.
- **Don't expand scope silently.** Adjacent problems get a follow-up issue (see
  [../agents/issue-tracker.md](../agents/issue-tracker.md)) and a line in the PR, not a drive-by
  fix — except a failing or flaky test, which is never adjacent scope creep; see AGENTS.md's Hard
  rules and the `debug` skill's Ownership section.
- **Server actions default to inline.** A single-page mutation lives as an inline `"use server"`
  closure in that page. `src/app/actions/` is only for actions genuinely shared across pages. A large
  page that would otherwise sprawl colocates its actions and zod schemas in a sibling `actions.ts`
  (file-level `"use server"`) instead.
- **Safety-critical code** (manifests, roll call, medical flags, cert gating) prefers explicit,
  boring implementations, exhaustive tests, and a second look via the `dive-domain-expert`
  agent.
- **Secrets never enter the repo.** `.env*` is gitignored; document required vars in
  `.env.example` when they appear.
