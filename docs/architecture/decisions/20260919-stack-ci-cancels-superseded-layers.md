# 20260919-stack-ci-cancels-superseded-layers — A layer that stops being the top has its CI cancelled

- **Status:** Accepted
- **Date:** 2026-09-19
- **Supersedes:** [20260827-stack-ci-skips-the-middle-layers](20260827-stack-ci-skips-the-middle-layers.md)
- **Amends:** [20260821-stacked-pull-requests](20260821-stacked-pull-requests.md), [20260729-reg-suit-visual-regression](20260729-reg-suit-visual-regression.md)

## Context

ADR [20260827-stack-ci-skips-the-middle-layers](20260827-stack-ci-skips-the-middle-layers.md) got the cheap half of Graphite's behaviour: a stack's middle layers skip the expensive jobs, read straight off `github.event.pull_request.stack` in the event payload, at the cost of no API call and no runner. It did not get the other half, and the gap is not a detail.

**An `if:` answers the question at dispatch, and a layer does not become a middle layer at dispatch.** It becomes one later:

1. A session opens layer B. B is the top of a two-layer stack, so its run is the full gate — the right answer at the time, and the condition says so.
2. Ninety seconds later the same session opens layer C on top of B.
3. B is a middle layer now, and its sixteen jobs are still running. Nothing in `ci.yml` can reach back into a run that has already started.

That is not an edge case here. AGENTS.md's *Parallel work* rule is "stack by default", and the **stacked-prs** skill says to open each pull request as a draft at its first commit, bottom one first — so every multi-layer scope this repository produces walks straight through those three steps, once per layer. A five-layer stack opened the way the skill describes pays four full gates that were correct when they started and pointless a minute later. Graphite cancels them; this did not.

The reason it did not is worth naming, because it is the whole of the decision below. **GitHub cancels workflow runs and nothing smaller** — `POST /actions/runs/{id}/cancel` exists and there is no per-job equivalent, the workflow-jobs endpoints being all reads. And cancelling a middle layer's whole run was, until today, the one thing this pipeline could not survive:

> A stacked layer's reg-suit baseline is the head commit of the layer directly below it (`scripts/reg-suit-keys.mjs`) and its report polls S3 for that snapshot (`scripts/wait-for-baseline.mjs`), so a middle layer that never published one would leave the top timing out and reporting every surface as new — the pipeline's documented worst failure.

So the superseded ADR held `build`, `visual` and `visual-report` out of the skip and made a middle layer spend six jobs on every push, photographing 200 surfaces that existed only to be the layer above's baseline. The cancellation was unavailable for the same reason.

That whole structure rests on one choice, made in ADR [20260821-stacked-pull-requests](20260821-stacked-pull-requests.md) and inherited from `reg-keygen-git-hash-plugin` before it: **a stacked layer compares against the layer below.** It reads well — each layer's diff is that layer's own pixels — and the price turned out to be a 20-minute S3 poll, a 35-minute job timeout wrapped around the poll, six jobs on every middle layer forever, and a hard block on the feature this ADR is about.

## Decision

**A stacked layer's visual baseline is the stack's fork point from the default branch, and a middle layer runs nothing at all. When a new layer opens above one, its in-flight CI run is cancelled.**

Three changes, in the order the argument runs.

### 1. Every layer is keyed to `main`

`scripts/reg-suit-keys.mjs` resolves a pull request's expected key from `merge-base origin/<default branch> HEAD`, whatever branch the pull request targets. A bottom layer is unaffected — its base *is* the default branch, so this is the commit it always resolved. A stacked layer now compares against a commit `main`'s own run published long before this run started.

What that costs is one thing and it is stated plainly: **the top layer's visual diff is the whole stack's delta, not its own slice.** That is close to what the top layer's green is read as anyway — the superseded ADR's own words for keeping the top in the gate were "the closest thing a stack has to a statement about the merged result". Middle layers, which are the ones whose per-layer diff was the argument for the old key, no longer run a compare at all.

What it buys is that **no layer waits on another.** The poll in `scripts/wait-for-baseline.mjs` is deleted with the key it existed for; the walk to the nearest published ancestor stays, because a commit can still publish nothing (a docs-only change, a cancelled main run). `visual-report`'s timeout drops from 35 minutes to 15.

### 2. A middle layer skips everything, from one condition

The condition is unchanged and still GitHub's own recommendation:

| Payload | Meaning | CI |
| --- | --- | --- |
| `stack == null` | not stacked, or a push to `main` | runs |
| `stack.base.ref == base.ref` | the lowest unmerged layer | runs |
| `stack.position == stack.size` | the top layer | runs |
| otherwise | a middle layer | **skipped** |

What changed is where it hangs. `changes` now carries it, and `changes` is the root of the whole expensive half — `build` needs its `code` output, `visual` needs `build`, `visual-report` needs both, `real-postgres` needs its `db` output — so one condition skips five jobs by propagation and none of them states the stack question again. The `middle_layer` output that `real-postgres` used to read is deleted; it existed only because `changes` could not skip while the visual half had to run.

`scripts/check-stack-ci-skip.mjs` pins both routes: the condition is byte-identical on every job that carries it, and every job that does not carry it must still reach `changes` through `needs:`. The second check is new and it guards a silent regression — a job re-rooted onto something else would start running on every layer again, and nothing would go red.

### 3. The registration cancels what it supersedes

`scripts/stack-cancel.mjs` runs from `.github/workflows/stack.yml`, off the same walk of the chain that registers it, on the same pull request event that created the problem. For every layer that is now a middle layer, it cancels that layer's queued and in-progress `ci.yml` runs.

It runs for every outcome that leaves the chain registered, `none` included and not only the `add` that most often causes it: three pull requests opened in a row register as a single `create`, and the middle one has had a full run in flight since it was opened. A later event finding "already registered" is the last chance anything has to notice.

This is the one part of the stack machinery that destroys work rather than declining to do it, so it carries three rails, each held by a test:

1. **Only the middle of a chain** — never the bottom, which is the layer next to merge, and never the top, which is what a session building upward is reading.
2. **Only `ci.yml`, only on a layer's own head branch, never the default branch.** Three filters for one decision, applied in the module rather than left to the query string. The failure they prevent is the documented worst one this pipeline has: a push to `main` publishes the snapshot every later baseline resolves to, and five cancelled main runs on 2026-09-01 left the next run reporting 696 surfaces new, 0 compared.
3. **It is never why the workflow goes red.** A cancel that 409s because the run finished a second earlier is the ordinary case. The registration is the part that had to happen.

There is also a ceiling of 25 cancellations per invocation. Nothing legitimate approaches it; a bug in the chain walk that swept the repository's runs would be far worse than a stack that kept paying for one.

## Alternatives considered

- **Job-level `concurrency` groups keyed on `stack.number` plus the layer's role**, letting GitHub cancel the superseded jobs itself with no API call and no `actions: write` grant. `jobs.<job_id>.concurrency` does read the `github`, `needs` and `matrix` contexts, and `cancel-in-progress: true` does cancel a running job in another run in the same group, so the mechanism is real — and it would have cancelled *only* the expensive jobs, which the whole-run cancel cannot. Refused because it only fires when both runs carry stack metadata, and the run this needs to cancel is the one started by `opened`, before `stack.yml` has registered anything: its payload reads `stack == null` and its group falls back to a private lane. It would cancel nothing in exactly the case that matters. Worth revisiting if GitHub's `pull_request` `stacked` activity type becomes usable in `on.pull_request.types` — the webhook action exists, but it is not in the documented list of workflow trigger types, and an unrecognised value there does not fail quietly.
- **Keep the layer-below baseline and cancel the run anyway.** The layer above then polls S3 for twenty minutes for a snapshot that is never coming, and falls back to an older ancestor — so it pays the full cost of the wait and gets the cumulative diff regardless. Strictly worse than deciding the key honestly.
- **Split `ci.yml` so the visual half can outlive a cancelled gate.** A reusable `workflow_call` holding `changes`/`build`/`visual`/`visual-report` would let the run be cancelled per half. It keeps the tidier per-layer diff, and it costs a restructure of the most delicate 900 lines in the repository to preserve a diff that only middle layers — which no longer run — would have shown.
- **Do nothing and accept the superseded runs.** The status quo. It spends a full gate per layer per stack, every time, on an answer that was already stale when the next layer opened.

## Consequences

- **A middle layer's checks read as skipped, and its PR shows no checks at all.** GitHub counts skipped as success. This repository has no required status checks (`main`'s only ruleset is *No push to main*: `deletion` and `non_fast_forward`), so nothing is gated on it today — and if they are ever switched on, a middle layer will show green without having run. That is the failure mode to watch, and it is the same one the superseded ADR flagged, now covering more jobs.
- **A cancelled run's checks read as cancelled, not skipped**, which is not success. It lands on a layer that is no longer the one anybody is reading, and the cascading rebase runs the full gate on it the moment it becomes the bottom.
- **A stacked layer's visual diff is cumulative**, and the sticky comment's baseline note names the commit it compared against, as it already did for an ancestor walk.
- **`stack.yml` holds `actions: write`.** It is the first grant in this repository that can destroy work. The rails above are the answer, and they are in code and tests rather than in this document.
- **A layer merged out of order** — an atomic stack merge landing several layers at once — still lands its middles without their gate, unchanged from the superseded ADR. Merging a layer at a time keeps the guarantee.
- 133 lines of polling, its tests, and a 20-minute deadline are deleted. `wait-for-baseline.mjs` keeps its name and no longer waits; the name stays because four ADRs reference the path and history should not acquire dangling links.
