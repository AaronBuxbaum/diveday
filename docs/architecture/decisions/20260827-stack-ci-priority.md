# 20260827-stack-ci-priority — A stack's CI runs bottom first, top next, middles last

- **Status:** Superseded by [20260827-stack-ci-skips-the-middle-layers](20260827-stack-ci-skips-the-middle-layers.md)
- **Date:** 2026-08-27

> **Superseded the same day (2026-08-27).** The diagnosis below stands; the mechanism does not. The
> `stack-priority` job held a runner idle for up to forty minutes to buy the deferral, which on a
> five-layer stack is four concurrent slots spent permanently by a mechanism meant to free them. It
> was also unnecessary: GitHub puts the layer's position in the event payload
> (`github.event.pull_request.stack`), a job skipped by an `if:` reports as *successful* to branch
> protection rather than blocking a merge, and this repository has no required status checks at all
> — so the "a layer whose gate never ran cannot merge" reasoning below is false in both halves. A
> middle layer now simply skips.

## Context

ADR [20260821-stacked-pull-requests](20260821-stacked-pull-requests.md) checked four things about
this repository against GitHub's stacked pull requests before adopting them, and recorded the first
as settled: **"CI needs no change."** `.github/workflows/ci.yml` triggers on a bare `pull_request:`
with no branch filter, so a layer whose base is another topic branch gets the identical full gate.

That is still true and is not what this decision changes. What it left unsaid is the arithmetic.
Every layer pays lint, typecheck, four unit shards, a build, four Playwright shards, four visual
shards and a report — sixteen jobs — and pays them again above every cascading rebase. AGENTS.md's
*Parallel work* already prices that in as the reason a stack stops at about six layers: "every layer
pays the full CI gate and pays again above every rebase". A five-layer stack pushed in one session
asks for eighty-odd concurrent jobs, and the repository has been running exactly that shape since
"stack by default" widened the rule on 2026-08-23 — the open stack on the day this was written was
five layers deep.

Those eighty jobs queue against one runner pool in whatever order GitHub started them, which is to
say in no order at all. Nothing about that queue reflects what anybody is waiting on:

- The **bottom** layer is the one that merges next. Its red is the only red that can block the whole
  stack, and nothing above it can land until it is green. It is also the layer a cascading rebase
  most often re-runs.
- The **top** layer contains every layer beneath it. Its green is the closest thing the stack has to
  a statement about the merged result, and it is what a session building upward is actually reading.
- A **middle** layer is neither. Merging is bottom-up and atomic, so a middle layer only ever lands
  as part of a group that the bottom's run (if the group stops there) or the top's run (if it does
  not) has already spoken for. Its own green is read last, if at all.

So the middle layers are the ones whose jobs can wait, and today they do not — they compete on equal
terms with the two layers a human is reading, and the bottom of a five-layer stack can sit queued
behind three middles' Playwright shards.

## Decision

**A stack's layers run their CI in priority order: the bottom first, the top next, the middle layers
last.** A new `stack-priority` job leads `.github/workflows/ci.yml`. It runs
`scripts/stack-ci-priority.mjs`, which reads `GET /repos/{owner}/{repo}/stacks`, finds the stack
naming this pull request, and places the layer among the ones still **open** — so after a bottom-up
merge the layer GitHub has just retargeted onto `main` is the new bottom and runs first.

The priority order is expressed as a yield, not a rank:

| Position | Yields to | Effect |
| --- | --- | --- |
| `solo` (not stacked, or the only open layer) | nothing | today's behaviour, exactly |
| `bottom` | nothing | runs immediately |
| `top` | the bottom | starts when the bottom's run has finished |
| `middle` | the bottom and the top | starts when both have finished |

`repo-safeguards`, `lint`, `typecheck`, the four unit shards, the four Playwright shards and
`db-surface-changes` (and through it `real-postgres`) all `needs: stack-priority`. That is eleven to
twelve jobs a middle layer holds back — most of the gate's runner demand — handed to the two layers
somebody is reading.

**It is a yield and never a skip.** Branch protection evaluates required checks per pull request at
merge time, so a layer whose gate never ran cannot merge on its own, and a stack that is merged one
layer at a time needs every layer green. Deferring is the whole of the change; the first framing of
this work was "run only the top and bottom", and that framing cannot be reconciled with per-layer
required checks.

### The visual path is deliberately not gated

`build`, `visual` and `visual-report` are outside this `needs:`, and that exclusion is load bearing
rather than an oversight.

A stacked layer's reg-suit baseline is the **head commit of the layer directly below it** — named
rather than inferred by `scripts/reg-suit-keys.mjs` — and the only run that publishes that commit's
snapshot is that layer's own. A layer above therefore polls S3 for it, for up to twenty minutes
(`scripts/wait-for-baseline.mjs`), which is the half of ADR
[20260821-stacked-pull-requests](20260821-stacked-pull-requests.md) that removed the baseline race
and let a stack move pixels at all.

Gate the visual path on priority and that becomes a deadlock. In a stack of three or more, the top
layer's baseline is the middle layer directly beneath it: the top waits for a snapshot the middle is
not allowed to publish until the top has finished. Both time out, and the visible result is the
pipeline's documented worst failure — every surface reported as *new* with a reassuring `Changed: 0`
at the top, which AGENTS.md forbids merging on. Leaving the captures ungated keeps that chain
exactly as it is today: every layer publishes its snapshot on its own schedule, and the layer above
finds it.

The cost of the exclusion is that a middle layer still spends six jobs promptly. The eleven it
defers are the ones that were competing for nothing.

### It can never redden or remove a check

Every path in the script exits 0, and the gate opens on all of them: a 404 from the stacks preview
endpoint, a fork pull request's read-only token, a payload it does not recognise, a rate limit, a
pull request it cannot find in the first three pages of stacks, and its own 40-minute deadline. The
job holds `actions: read` and `pull-requests: read` and writes nothing back to GitHub. Values that
reach a URL — the repository slug, a head sha, a workflow filename — are matched against strict
patterns first, so a branch name is never the thing that shapes a request.

The deadline is the exit, not the success (AGENTS.md's rule about a wait whose only exit is a
success marker). A layer that gives up simply runs, which is the behaviour without this ADR.

## Alternatives considered

- **Run only the bottom and the top; skip the middles entirely.** The first shape asked for, and the
  cheapest. Refused because required checks are per pull request: a skipped middle layer is an
  unmergeable one, and merging the stack in one `gh stack merge` from the top is then the *only*
  way to land it. It also puts a state on `main` that no run ever saw whenever somebody merges up to
  a middle layer.
- **Order the whole stack strictly bottom-to-top** (layer *n* waits for layer *n-1*). Closer to how
  the visual baselines already chain, and it would let the visual path be gated too. Refused because
  it serialises the signal a session is most often reading — the top — behind every layer beneath
  it, turning a five-layer stack's feedback into five full gates end to end. The priority the ask
  states, and the one that matches who reads what, puts the top second rather than last.
- **A `concurrency:` group shared by the whole stack.** No runner cost and no script. It cannot
  express priority at all: GitHub queues a concurrency group in arrival order, so this would
  serialise the stack in whatever order the pushes happened to land — frequently the exact inverse
  of what is wanted.
- **Let the middle layers run and rely on `cancel-in-progress`.** Already true, and already
  insufficient: cancellation triggers on a *new push to the same ref*, not on another layer needing
  a runner.
- **Do nothing.** The status quo, and defensible while stacks were rare. "Stack by default" made
  them the normal shape of work in this repository, which is what turns an occasional queue into a
  standing one.

## Consequences

- A middle layer's non-visual gate starts later — by however long the bottom and the top take, and
  never by more than 40 minutes. The two layers a human is reading start sooner by roughly the
  runner contention that removes.
- The gate job itself costs one runner for the length of its wait, and about 25 seconds on every
  other run in the repository (a push to `main` and every unstacked pull request resolve to `solo`
  and exit immediately). That is the honest price: GitHub Actions has no way to wait without holding
  a runner, and eleven deferred jobs is the thing bought with it. It is a **concurrency** trade
  rather than a minutes trade, and on a repository whose stacks are one or two layers deep it is
  close to a wash.
- The stacks endpoint is a preview. If it is withdrawn or the payload changes shape, every layer
  resolves to `solo` and CI behaves exactly as it did before this ADR — with a line in the job log
  saying so, and nothing red.
- `.claude/skills/stacked-prs/SKILL.md` and AGENTS.md's *Parallel work* both said CI runs in full,
  unordered, on every layer. Both are corrected in the same change.
- The layer's position is resolved once, at the start of the wait. A cascading rebase during the
  wait rewrites the heads it is watching; the superseded runs are cancelled, which counts as
  finished, so the wait ends early rather than late. Early is the harmless direction — it means
  behaving like today.
