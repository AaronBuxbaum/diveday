# 20260821-stacked-pull-requests — Use GitHub stacked pull requests for dependent chains

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

  **Amended 2026-08-22 — this is no longer true, and the Decision below is written to the corrected
  fact (issue #645).** `gh` *is* pre-installed in cloud sessions, and it authenticates without a
  `gh auth login`: the GitHub proxy substitutes real credentials on outbound requests, leaving
  `GH_TOKEN` reading as the placeholder `proxy-injected` inside the VM. The proxy's documented REST
  path, `gh api repos/{owner}/{repo}/...`, reaches the stacks endpoints against the attached
  repository. Verified against this repository rather than assumed: a `GET .../stacks` lists the two
  stacks already registered here, and a deliberately empty `POST .../stacks` is refused with a
  **422** naming the 2-item minimum — the write path is reachable and authorized, and it declined
  only the payload. What stays out of reach is the `github/gh-stack` **extension**: installing one
  pulls a release asset from an unattached repository, which the proxy scopes out with a 403. The
  extension is not needed, because it wraps these same endpoints.

## Decision

Stacked pull requests are the tool for a **dependent chain**, and one pull request per independent
slice remains the default for everything else. Three parts:

1. **A session that produces a dependent chain opens ordinary chained-base pull requests** — each
   branch cut from the one below, each pull request opened with `base` set to that branch, each body
   naming its position and the branch beneath it. This needs nothing that is not already available,
   and it is byte-for-byte the branch shape a stack requires.
2. **The session that built the chain registers it**, with one REST call — `POST
   /repos/{owner}/{repo}/stacks` carrying the ordered pull request numbers bottom to top, reached as
   `gh api --method POST`. Registering is what buys the cascading rebase, the bottom-up atomic merge,
   and the stack view; it can happen at any point, including after review has started. When nobody
   registers it, the chain is still a working chain — it just rebases and retargets by hand. The
   `github/gh-stack` extension is a convenience wrapper over the same endpoints and is fine on a
   workstation; it is not the supported path in a cloud session, where the install itself is
   expected to 403.
3. **Layers merge bottom-up**, and a layer that moves pixels is triaged on its own baseline. Because
   the visual behaviour above is unmeasured, the first stack through this repository is deliberately
   one that does *not* change a rendered surface, and what its `visual-report` job resolves is
   recorded (issue #644) before a pixel-moving stack is opened.

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
behind, so reverting this decision costs one command and no history. If GitHub changes the preview
under us, the fallback is the same chained-base shape we already produce.

### Measured: visual baselines across a stack (2026-08-22, issue #644)

This ADR shipped with a restriction — no stacking work that moves pixels — and an admission that
nobody had checked. It has now been checked, and **the restriction stays, because the thing it
guards against is real.**

The measurement did not need the ~9 CI runs this ADR priced it at.
`reg-keygen-git-hash-plugin` decides the baseline key by walking the **local git graph**
(`CommitExplorer.getBaseCommitHash()`) with no network call, so a two-layer stack built in a
throwaway repository answers it for free:

| state | layer 2's baseline resolves to | is there a snapshot under that key? |
| --- | --- | --- |
| stack as opened | layer 1's head | yes, once layer 1's visual job has published |
| after a cascading rebase | the **rewritten** layer 1 head | **not yet, and maybe not ever in time** |

So the first half of the worry is confirmed and benign: layer 2 really does compare against layer 1
rather than `main`, which is what makes a stack's diffs readable — each layer shows only its own
pixels.

The second half is the problem. GitHub's server-side cascading rebase rewrites every commit above a
merge point, so layer 2's key moves to a commit hash that no CI run has published under. It is a
**race, not a certainty**: layer 1's own rebase triggers a fresh run that will publish that key, so
whether layer 2 finds a baseline depends on layer 1's four visual shards finishing first. Losing the
race is not silent — reg-suit reports the surfaces as **new** rather than changed, and the repo's
`diveday:visual-summary` comment prints that count in its own column — but "new" on 60 surfaces
reads as noise at exactly the moment a reviewer is least able to tell noise from a regression.

The related failure is worth stating because it is the ordinary case and it bit this repository on
2026-08-22: a branch whose parent has fallen behind `main` compares against that **parent**, while
CI captures the pull request **merged with `main`**. PR #668 reported 60 changed surfaces of which
39 were other people's already-merged work. Rebasing onto `main` reduced it to 21. That is the same
key-resolution rule doing exactly what it says, and it is a good argument for rebasing a stack's
layers before reading their visual reports at all.

**There is a supported lever, and it is worth writing down rather than rediscovering.** reg-suit's
key generator is a plugin slot, and `reg-keygen-git-hash-plugin` is only the default: it accepts no
options at all (its `init()` stores the config and reads nothing from `regconfig.json`), so nothing
about the inference above is tunable. The alternative reg-suit ships is
[`reg-simple-keygen-plugin`](https://github.com/reg-viz/reg-suit/blob/master/packages/reg-simple-keygen-plugin/README.md),
which takes `expectedKey` and `actualKey` directly, with environment-variable substitution:

```json
"reg-simple-keygen-plugin": { "expectedKey": "${EXPECTED_KEY}", "actualKey": "${ACTUAL_KEY}" }
```

This repository is already in the business of steering that inference — `visual-report` checks out
`pull_request.head.sha`, re-attaches a branch name with `git checkout -B` because the git-hash
plugin throws on a detached HEAD, and invents a `reg-suit-baseline-parent` branch on main pushes.
Naming the key outright is a smaller trick than those, not a bigger one.

What it would fix: the detached-HEAD fragility, and the stale-parent surprise below — CI could pass
a deliberately chosen commit instead of whatever the graph walk lands on.

What it would **not** fix, and this is the part that keeps the restriction: an explicit key does not
conjure a snapshot. Layer 2's baseline still has to have been *published*, and the only run that
publishes layer 1's head is layer 1's own. So the rebase problem is an **ordering** problem — layer
2's visual job must not run until layer 1's has uploaded — and it stays one whichever plugin names
the key. That is the shape any future fix takes: `reg-simple-keygen-plugin` plus a gate on the layer
below, not a cleverer walk of the graph.

Still not done, deliberately: no `matchingThreshold` in `regconfig.json`, and no re-anchoring the
capture to `main` — that would report every lower layer's own changes on every layer above it.
