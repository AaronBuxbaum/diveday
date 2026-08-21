# 20260821-stacked-pull-requests — Use GitHub stacked pull requests for dependent chains, registered by a human

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

GitHub put stacked pull requests into public preview on 2026-07-30, rolled out to every repository
with no opt-in setting. A stack is an ordered chain of pull requests in one repository: the bottom
one targets `main`, each one above targets the head branch of the one below. GitHub owns the part
that made stacking a specialist tool before — it runs the cascading rebase server-side when a layer
moves, merges bottom-up and atomically (merging layer 3 merges 1 and 2 with it, or none of them),
and retargets whatever is left onto `main`. Branch protections and required checks are still
evaluated per pull request, at merge time.

Our workflow (AGENTS.md, *Parallel work*) is one vertical slice per pull request, non-overlapping
paths, trial-merge before calling it done. That serves independent slices well and is not the thing
this changes. The shape it does not serve is a *dependent* chain inside one scope — `src/db/schema.ts`
plus its migration, then the `src/db` reader, then the surface that renders it — where the second
step cannot compile without the first. Today that is either one pull request three times the size it
should be, or a session sitting idle waiting for its own earlier one to merge.

Four things about this repository were checked against the feature before adopting it, because three
of them could have made it a bad fit and one nearly does:

- **CI needs no change.** `.github/workflows/ci.yml` triggers on a bare `pull_request:` with no
  branch filter, so a layer whose base is another topic branch gets the identical full gate.
- **The `origin/main`-anchored tooling stays correct.** `pnpm test:changed` and
  `scripts/previous-release-migrations.mjs` (the destructive-migration guard) both anchor on
  `git merge-base origin/main HEAD`, which in a stack resolves to the fork point of the *whole*
  stack. An upper layer therefore re-runs the lower layers' affected tests and re-checks their
  migrations: conservative and slower, never wrong.
- **The visual pipeline is the real cost, and it is not fully known.**
  `reg-keygen-git-hash-plugin` resolves a baseline by triangulating merge-bases against other
  branches, so layer 2's baseline should be layer 1's head commit — whose S3 snapshot exists only if
  layer 1's four visual shards all went green in a run that finished first. Every cascading rebase
  rewrites the commits above the merge point and orphans the keys published under them. The failure
  mode if that resolution misses is the documented one: zero baselines resolved, every surface
  reported as new, nothing actually compared (ADR
  [20260729-reg-suit-visual-regression](20260729-reg-suit-visual-regression.md)). It is at least
  *visible* — `scripts/visual-pr-comment.mjs` says in words when no baseline resolved (ADR
  [20260802-visual-diff-pr-comment](20260802-visual-diff-pr-comment.md)) — but no stack has been
  through it.
- **Agent sessions cannot register a stack today.** Verified in this environment, not assumed:
  `gh` is not installed (`gh: command not found`), and a direct call to `api.github.com` is refused
  by the agent proxy ("GitHub access is not enabled for this session"). Sessions reach GitHub
  through the GitHub MCP server, whose tool surface has `create_branch` and `create_pull_request`
  but no stack endpoints.

## Decision

Stacked pull requests are the tool for a **dependent chain**, and one pull request per independent
slice remains the default for everything else. Three parts:

1. **A session that produces a dependent chain opens ordinary chained-base pull requests** — each
   branch cut from the one below, each pull request opened with `base` set to that branch, each body
   naming its position and the branch beneath it. This needs nothing that is not already available,
   and it is byte-for-byte the branch shape a stack requires.
2. **A human registers the stack**, from a workstation with `gh` (`gh extension install
   github/gh-stack`, then `gh stack link <pr> <pr> <pr>`) or with one REST call, `POST
   /repos/{owner}/{repo}/stacks` carrying the ordered pull request numbers bottom to top. Registering
   is what buys the cascading rebase, the bottom-up atomic merge, and the stack view; it can happen
   at any point, including after review has started. When nobody registers it, the chain is still a
   working chain — it just rebases and retargets by hand.
3. **Layers merge bottom-up**, and a layer that moves pixels is triaged on its own baseline. Because
   the visual behaviour above is unmeasured, the first stack through this repository is deliberately
   one that does *not* change a rendered surface, and what its `visual-report` job resolves is
   recorded (issue #644) before a pixel-moving stack is opened. That a session cannot register the
   stack itself is issue #645, waiting on a door outside this repository.

`.claude/skills/stacked-prs/SKILL.md` holds the procedure; this record holds the reasoning.

## Alternatives considered

- **Keep one pull request per slice, always** — the status quo, and still the default. Rejected as
  the *only* option because it prices a genuine dependent chain at either an unreviewable pull
  request or a serialized wait, both of which we pay today.
- **Chained-base pull requests, never registered as a stack** — free and available now, and exactly
  what we fall back to. Rejected as the destination because every rebase is then hand-run across N
  branches, and each merge leaves the next layer pointing at a deleted branch until someone retargets
  it.
- **A third-party stacking tool (Graphite, Sapling, git-town)** — mature, and `gh stack link` even
  exists to accommodate them. Rejected: a second account and a second tool outside GitHub, for a
  repository whose entire agent workflow is already `gh` plus GitHub issues.
- **Wait for the preview to reach GA** — the feature is subject to change, and merge-queue support is
  still rolling out. Rejected because adopting it costs nothing to reverse (see below) and because
  the chained-base half, which is most of the value, is plain git.

## Consequences

Makes easy: a dependent chain that reviews in the order it was written, with each layer holding its
own green CI and its own review thread, and no layer blocked on the previous one merging first.

Makes hard, and worth knowing before opening one: CI cost multiplies per layer — this workflow runs
lint, typecheck, four unit shards, a build and eight Playwright/visual shards for every pull request
— and pays again for every layer above a cascading rebase. A three-layer stack rebased twice is
roughly nine full runs. Stacks are therefore for chains that are genuinely dependent, not for
splitting an independent change into thirds.

Commits us to: bottom-up merge order (there is no merging layer 2 alone), per-layer branch
protection, and keeping the chained-base convention legible in pull request bodies so a reader who
finds layer 3 first can walk down.

Escape hatch: `gh stack unstack` dissolves a stack and leaves ordinary chained-base pull requests
behind, so reverting this decision costs one command and no history. If the first stacks show
baselines failing to resolve, stacks stay off for anything that moves a rendered surface — schema,
`src/db`, and docs chains only — until `reg-keygen-git-hash-plugin`'s key resolution across a
rebased chain is understood. If GitHub changes the preview under us, the fallback is the same
chained-base shape we already produce.
