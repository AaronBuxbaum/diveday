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

   **Amended 2026-08-23 (see "Measured: register at the first commit" below):** open that pull
   request, as a draft, at the layer's **first commit** rather than when its work is done, and
   register it then. Steps 1 and 2 are one step. Deferring either is what produced the only failure
   stacking has caused in this repository.
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

   **Amended 2026-08-23 (see "Reversed: a stack may move pixels" below):** measured, then lifted.
   Pixel-moving work stacks like anything else; what replaces the restriction is a rule about not
   triaging a layer whose baseline never resolved. **Amended again the same day (issue #909):** the
   pipeline now names the baseline key and waits for the layer below to publish it, so that rule is
   a fallback for a wait that gave up rather than the ordinary path.

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
guards against is real.** (Superseded twice on 2026-08-23: the restriction was lifted by "Reversed:
a stack may move pixels" and the race itself was closed by "the baseline is named rather than
inferred". The mechanism described here is unchanged and still worth reading — it is why the fix has
the shape it has.)

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

### Measured: register at the first commit, not at the end (2026-08-23)

PR #891 made a stack the default shape for backlog work. PR #893 walked that back a day later on
evidence: twice in one session a base branch merged and was deleted while its next layer's pull
request body was still being written, and `gh pr create --base` then failed with `No commits between
… Base ref must be a branch`. The conclusion drawn there was to measure the merge cadence and cut
from `main` when review is fast.

That conclusion was wrong about the cause, and the cause is fixable. Measured in a throwaway
four-layer stack rooted on a sandbox branch — no CI, `[skip ci]` commits, torn down afterwards:

| act | result |
| --- | --- |
| merge the bottom layer (`gh stack merge <pr> --yes`) | its branch is deleted, and the layer above **retargets itself** onto the new base, silently — no `base_ref_changed` timeline event, pull request stays open, diff stays its own |
| `gh pr create --base <the deleted branch>` | `No commits between … Base ref must be a branch` — PR #893's failure, reproduced verbatim |
| `gh stack link <stack> <the orphaned branch>` | creates the pull request as a draft based on the stack's top and adds it to the stack |
| `gh pr merge` on any stacked pull request | refused: *"must be merged using the asynchronous merge REST API"* |
| `gh pr edit --base` on any stacked pull request | refused: *"Cannot change the base branch because the pull request is part of a stack"* |

So the vanished base is not a property of stacks; it is a property of opening the pull request hours
after cutting the branch. GitHub owns a stacked pull request's base ref — it will not let anyone else
set it, and it moves it when the layer below merges.

Two mechanical findings came out of the same session and matter more than the reasoning:

- **The registration command this ADR and the skill both carried did not work.** `gh api -f` sends
  strings; `pull_requests` is typed as integers, so `POST .../stacks -f 'pull_requests[]=641'`
  returns `422 Invalid property /pull_requests/0: "641" is not of type integer`. `-F` works. A
  session that tried the documented form saw the write path fail, fell back to hand-chained
  `gh pr create --base`, and met the failure above — which is very likely the whole causal chain
  behind PR #893.
- **One caveat survives.** A branch cut from a layer before it merged and attached after carries the
  pre-merge parent commit, so its diff duplicates the merged layer's files until it is rebased onto
  the new top. `gh stack merge` cascade-rebases the branches that were *in* the stack; it cannot
  rebase one it has never seen.

What does **not** change: the CI cost per layer, which is the real argument for keeping stacks short
and for not stacking independent slices, and the visual-baseline restriction measured on 2026-08-22.

### Reversed: a stack may move pixels (2026-08-23, Aaron's call, issue #905)

The restriction above — no stacking work that moves a rendered surface — is **lifted**. Nothing
about the measurement that produced it turned out to be wrong; what changed is what it was being
applied to.

Two facts collided. `.claude/skills/backlog-routine/SKILL.md` (PR #891) makes a stack the shape of
ordinary backlog work, one ticket per layer, related or not. And ordinary backlog work is mostly
rendered surfaces: an empty-state shape, a contrast-token sweep, a nav-label reconciliation, a
departure page's way back to the board — four consecutive merges from that queue, every one of them
pixels. A restriction that excludes the ordinary case is not a restriction, it is a contradiction
between two skills, and a session reading both had to choose one silently. That is what issue #905
asked, and this is the answer to it.

The trade being accepted, stated plainly so nobody has to reconstruct it: **losing the baseline race
costs a re-read, not a missed regression.** When layer 2's key lands on a commit nothing has
published under, reg-suit reports its surfaces as *new*, `Changed` reads 0, and the repo's
`diveday:visual-summary` comment says in its own words that nothing was compared. The danger is
entirely that a reader takes `Changed: 0` at face value. So the restriction is replaced by three
obligations, which live in `.claude/skills/stacked-prs/SKILL.md` and are repeated in the backlog
routine:

1. Read `diveday:visual-summary` on **every** layer before writing anything about pixels.
2. A layer that resolved no baseline is not triaged in that state — wait for the layer below's
   `visual`/`visual-report` jobs, re-run this layer's, read the refreshed comment.
3. Never merge a layer whose pixels were never compared on the strength of a zero count. Zero
   changed with zero baselines is the failure, not the pass.

This is a procedural mitigation and it depends on the reader. The mechanical fix — a named key via
`reg-simple-keygen-plugin` plus gating a layer's visual job on the layer below's — is unchanged, is
still the right shape, and is now filed as issue #909 rather than left as a paragraph nobody owns.
Both halves are required; an explicit key cannot conjure a snapshot that has not been published.
**Built the same day; see the section below.** The three obligations above survive as the reading
for a wait that gave up, which is now the exceptional path rather than the expected one.

Unchanged by this reversal: CI cost per layer (the real argument for short stacks), and the rule
that independent slices are not stacked merely because they arrived in the same session.

### Measured: the baseline is named rather than inferred (2026-08-23, issue #909)

The 2026-08-22 measurement ends by naming a fix and declining to build it, and the reversal above
ends by filing it. It is now built, because that reversal is what turns a race the repository could
previously step around into one it meets on ordinary work.

**Half one: the key is stated.** `regconfig.json` carries `reg-simple-keygen-plugin` with
`expectedKey`/`actualKey` interpolated from the environment, and `scripts/reg-suit-keys.mjs`
computes them:

| event | actual key | expected key |
| --- | --- | --- |
| pull request | the head commit | `git merge-base origin/<base ref> HEAD` |
| push to `main` | the pushed commit | `HEAD^` |
| local `pnpm visual` | `HEAD` | the fork point from `origin/main`, or `HEAD^` on `main` itself |

Both are full 40-character shas, which is not a detail: every baseline in the bucket was published
under `git rev-parse` output by the old plugin, so a shorter or prettier key would make the whole
published history unreachable, and the first symptom would be a **push to main** reporting every
surface as new rather than a stack misbehaving. Measured against the plugin being replaced, in the
same throwaway two-layer stack the 2026-08-22 measurement used — `CommitExplorer` reads only the
local git graph, so this needs no CI and no bucket:

| state | `reg-keygen-git-hash-plugin` resolves | this resolves |
| --- | --- | --- |
| layer 2, stack as opened | layer 1's head | the same commit |
| layer 1, base `main` | main's head | the same commit |
| layer 2, after a cascading rebase | the **rewritten** layer 1 head | the same commit |
| push to `main` | **null** — no second branch to triangulate against | `HEAD^`, which is what the invented `reg-suit-baseline-parent` branch used to make it say |
| layer 2 whose base branch was deleted under it | (untestable — the plugin needs the ref) | the event payload's base sha |

So the inference was right and is preserved byte for byte; what changes is that it is now a stated
fact rather than a property of which refs happen to be in the checkout. Three steps in
`visual-report` existed only to arrange that property and are deleted with it: the `git checkout -B`
that un-detached HEAD, the `reg-suit-baseline-parent` branch invented at `HEAD^` on main pushes, and
the reasoning about detached merge commits in the checkout comment. The checkout keeps
`ref: <head sha>` and `fetch-depth: 0` for reasons that outlived the plugin — a merge-base and a
`HEAD^` both need real history, and the SHA pin is what survives an auto-merged branch being deleted
mid-run. It is now also a **tripwire**: the resolver refuses to run when HEAD disagrees with the
event's head sha, so a future regression to a default checkout fails loudly instead of publishing a
snapshot keyed to an ephemeral merge commit.

**Half two: the layer above waits.** An explicit key still cannot conjure a snapshot, so
`scripts/wait-for-baseline.mjs` polls the bucket for the expected key before the compare runs. Four
properties, each the answer to a way this could have gone wrong:

- **`needs:` cannot express it.** The layer below's jobs are in a different workflow run on a
  different pull request; `needs:` is intra-run only. Hence a poll.
- **Only a stacked layer waits.** The step is gated on the pull request's base ref not being the
  default branch. Applied unconditionally, every ordinary pull request in the repository would block
  on a run that will never exist.
- **It always ends, and never reddens.** A 20-minute deadline inside the job's 35, and every path
  exits 0 — a wait whose only exit is a success marker is the nine-hour loop AGENTS.md was written
  around. A layer that gives up falls through to the compare and to the sticky summary, which says
  "NOTHING WAS COMPARED" in those words. The gate removes the race; it does not become a new way to
  fail.
- **It waits for the whole baseline, not for the report.** reg-suit uploads a run's files in
  sequential chunks and `out.json` sorts near the end of them — near enough that an existence check
  usually works and occasionally hands the layer above a baseline with a few images still in flight,
  which reads as a handful of surfaces mysteriously "new". So it reads the report and confirms every
  surface the layer below captured is actually on S3.

What this does to the three obligations in the reversal above: obligation 1 (read
`diveday:visual-summary` on every layer) and obligation 3 (never merge on a zero count that compared
nothing) stand unchanged — they are how a reader tells a real comparison from an empty one, and no
pipeline change removes the need. Obligation 2, the wait-and-re-run, is now what the pipeline does
for you; it survives as the reading for the exceptional case where the wait gave up, which the
sticky comment will say.

Not done, still deliberately: no `matchingThreshold` in `regconfig.json`, and no re-anchoring the
capture to `main` — that would report every lower layer's changes on every layer above it, which is
the readable-diff property all of this exists to protect.

What is proven locally and what is not: the key resolution above was measured against a real
two-layer stack, including a cascading rebase and a deleted base branch. The end-to-end claim — a
non-zero baseline count in the `diveday:visual-summary` comment on both layers of a rebased stack —
needs CI and a bucket, so the first pixel-moving stack through this pipeline is where it is
confirmed. A push to `main` resolving a non-zero baseline is the same claim on the ordinary path,
and it is the one to watch first, because that is where a key-format mistake would surface.
