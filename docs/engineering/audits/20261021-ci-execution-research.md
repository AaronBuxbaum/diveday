# CI execution research — 2026-10-21

Research only. No workflow, runner, application, cache or repository setting was changed.
Source snapshot: `749028e685a5a7e2f7b481b28f6f8ab1262365e0`. Platform documentation was checked
on October 21, 2026. Recommendations below are options to evaluate, not approved architecture.

## Main finding

Treat four different costs separately: waiting for a runner, repeated environment preparation,
executing tests, and waiting for unrelated jobs before a failure can be replayed. Adding shards
can shorten test execution while increasing preparation, queue pressure and total job-minutes.
Caching a build cannot eliminate database reset work. A final green retry does not measure
first-attempt reliability. The useful target is time to trustworthy feedback, not just green-run
duration.

The current pipeline already builds once, shares that build with browser jobs, caches packages and
snapshots, balances shards by measured cost, and narrows PR visual captures. Reintroducing these as
new proposals would miss the remaining problem. Sources: [workflow](../../../.github/workflows/ci.yml),
[setup action](../../../.github/actions/setup/action.yml),
[unit sequencer](../../../src/test/shard-sequencer.ts),
[browser sharder](../../../scripts/e2e-shard.mjs).

## Observed execution and evidence limits

The latest-job API snapshot of [run 39666872384](https://github.com/AaronBuxbaum/diveday/actions/runs/39666872384)
contains 29 jobs: all executed jobs, including four unit shards, six functional browser shards,
eight visual shards, the build, real Postgres, coverage and the aggregate result, report success;
the docs-only unit lane reports skipped. This snapshot establishes the latest result only. The
connector's job summaries omit timestamps and attempt provenance; they cannot establish queue time,
first-attempt success, or the cost of earlier attempts. The attempt-specific REST job exports
collected during this investigation establish the following timeline, all UTC:

| Event | Time | Consequence |
| --- | --- | --- |
| Original run created | 20:02:44 | Start of elapsed feedback time |
| Attempt 1 build setup failed | 20:10:50 | Build never reached compilation; other unit work continued |
| Attempt 1 aggregate finished | 20:18:17 | About seven additional minutes after the actionable setup failure |
| Attempt 2 build reran successfully | 20:18:41–20:21:20 | Same run/SHA could now release browser lanes |
| Attempt 2 visual shard 2 setup failed | 20:21:37 | Other browser work continued until 20:33:14 |
| Attempt 3 visual shard 2 reran successfully | 20:33:53–20:43:24 | Comparison and aggregate could finish afterward |
| Final result completed | 20:44:29 | 41 minutes 45 seconds from initial creation |

Original evidence: [build setup failure](https://github.com/AaronBuxbaum/diveday/actions/runs/39666872384/job/119455534120),
[successful build replay](https://github.com/AaronBuxbaum/diveday/actions/runs/39666872384/job/119462170049),
[visual setup failure](https://github.com/AaronBuxbaum/diveday/actions/runs/39666872384/job/119463550019),
[successful visual replay](https://github.com/AaronBuxbaum/diveday/actions/runs/39666872384/job/119469884488).
These two initial failures were in setup, not failed product assertions. Their downstream
"nothing compared" and aggregate failures were correct consequences, not extra independent flakes.
The observed replay delay motivates independent scheduling; it does not by itself prove that GitHub
would have accepted an earlier job-rerun request.

Eight selected successful runs (five PR, three main) supplied this bounded comparison:

| Measure | Observed value | Limit |
| --- | --- | --- |
| Summed active job execution | Median 176.0 minutes; range 165.4–191.0 | Not billed minutes or elapsed run time |
| Active execution share | Visual 40.9%; functional browsers 34.9%; units 19.0%; other 5.2% | This selected sample, not a causal estimate or random sample |
| Shared setup steps | 204 observations: median 18 seconds, p90 24 seconds, maximum 181 seconds | Successful-run sample misses setup failures that made a run red |
| Materialized-job queue | 220 observations: median 2 seconds, p90 5m50s, maximum 10m41s | Creation-to-start only; excludes time waiting for DAG dependencies |

Selected run IDs: `39538459551`, `39625670433`, `39631508323`, `39646753555`, `39652259018`,
`39656877219`, `39662946285`, `39665185352`. In
[successful comparison 39652259018](https://github.com/AaronBuxbaum/diveday/actions/runs/39652259018),
the build took 117 seconds but the 14 browser jobs queued 3.15–10.68 minutes after job creation;
run wall time was 25m33s and summed active job execution was 182.3 minutes. Faster compilation alone
cannot remove that observed queue cost.

Attempt APIs can repeat successful jobs with original start/end timestamps but new creation or
attempt metadata. Deduplicate execution by stable identity or name/start/end, and investigate
inconsistent timestamps rather than reporting negative queue time or summing reused jobs repeatedly.

The [earlier audit](20261021-testing-and-ci.md) contains separate historical timings. Those samples
and earlier comments in the workflow are historical evidence, not measurements of this final run.
No new suites or builds were executed for this research.

### Current topology

- `changes` precedes most jobs, including otherwise independent lint/typecheck/unit work. It also
  chooses hosted versus Mac-backed runners. Its full-history checkout and runner-status lookup are
  therefore on several feedback paths.
- The build feeds six functional shards and visual shards. Visual planning is independent of the
  build; visual reporting waits for all selected captures. Coverage merges unit blob reports rather
  than running the suite again. `CI result` joins all required lanes.
- Every installed job invokes the shared Node/pnpm setup and frozen install. The hosted setup caches
  the package store, not an already linked dependency tree. Browser jobs restore the same build,
  regenerate the service worker, and restore/install Chromium's headless shell.
- PRs capture affected visuals plus smoke coverage; main publishes full baseline snapshots. PR
  visual results copy unaffected baseline surfaces, so capture counts are not counts of freshly
  exercised pages. Main publication is part of later runs' baseline dependency.

These are source observations from [CI](../../../.github/workflows/ci.yml) and the
[browser action](../../../.github/actions/playwright-shell/action.yml).
[setup-node documents](https://github.com/actions/setup-node#caching-global-packages-data) that its
package-manager cache excludes `node_modules`.

Before changing visual policy, record why the existing selector chooses a full plan. Current
[visual selection](../../../scripts/visual-affected.mjs) expands for visual/build plumbing,
seed/schema changes and their reached consumers, runtime roots, broad build dependencies or
an unbounded import graph. The plan is cumulative from the default-branch fork point, so changes
lower in a stack remain in the capture set. Optimizing a selector's proven overreach is different
from removing its conservative fallback or counting baseline-filled surfaces as new captures.

## Ranked opportunities

| Rank | Candidate | Safety and evidence needed |
| --- | --- | --- |
| Immediate | Align the outer PGlite cache key with the internal snapshot fingerprint | The workflow omits the extracted builder from its key, while the fingerprint includes it. Correctness currently rebuilds stale bytes, but an immutable exact-key hit can repeatedly restore the same stale cache. Add builder/toolchain identity consistently; test cache hit, builder edit and version change. |
| Immediate | Measure and report attempt-aware critical paths | Record runner queue, setup, restore, test, retry and upload separately. Show first-pass failures even when replay succeeds. This changes evidence rather than coverage. |
| Immediate | Use specific-job or failed-job replay instead of rerunning every job | Preserve successful build/unit evidence for the same SHA, then replay the failed lane and required dependents. Check artifact retention and attempt-specific output names first. |
| Immediate | Verify artifact identity before reuse and retain it through the replay window | Current build retention is one day. A later browser replay must rebuild if that exact artifact expired; downloading an arbitrary newer build is invalid. |
| Immediate | Preserve short local checks and one owner for expensive work | Keep local dependency selection conservative; avoid concurrent builds/test fleets on the same Mac. Reuse already available same-input artifacts before scheduling another build. |
| Experiment | Decouple fast feedback and replayable lanes from the single long workflow | Independently dispatchable lanes can replay a failed shard while unrelated visual jobs continue. Keep a SHA-bound aggregate check; splitting YAML alone does not create independent runs. |
| Experiment | Prepare snapshots once per cold input set, or prewarm trusted default-branch caches | Compare a shared preparation dependency against duplicated cold builds. A new preparation job adds queue and download latency to every shard, so do not assume it wins warm runs. |
| Experiment | Package the exact test runtime and generated assets with the build | Compare a minimal tar/standalone bundle with current `.next` plus repeated installs/service-worker generation. Verify traced runtime dependencies and all public assets before removing setup steps. |
| Experiment | Right-size workers, shards and runner classes by suite | Refresh weights separately for runner architecture, coverage mode and first-attempt duration. Compare slowest-shard latency and total job-minutes at the same resource budget. |
| Experiment | Reconsider full validation on every intermediate stack push | Requires an explicit replacement for the accepted full-layer ADR. Missing evidence must remain pending or explicitly unrun, never masquerade as passing. |
| Unsafe shortcut | Reuse sibling-branch builds, broad mutable DB snapshots or prior green results without input proof | A matching filename, PR number or test title does not prove matching code, schema, environment or toolchain. |
| Unsafe shortcut | Remove isolation, skip resets on read-only metadata, raise timeouts or retry arbitrary failures | These alter assurance and can hide ordering/resource defects. The current fixture resets even tagged read-only tests for isolation. |

The snapshot-key mismatch is directly visible in both workflow cache restores and
[the internal fingerprint](../../../src/test/db-template.ts). GitHub caches are immutable after
creation; changing content requires a new key. PR merge-ref cache scope also limits cross-PR reuse.
See [GitHub's cache reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

The reset concern is established by [the browser fixture](../../../e2e/fixtures.ts) and
[the reset implementation](../../../src/app/api/test/reset/route.ts). A faster template clone is a
possible experiment, but it must preserve per-worker isolation, app-held connections, frozen time,
credentials and cleanup. Rollback-only isolation cannot cover arbitrary browser requests and
background jobs using independent connections without a different design.

## What can be cached safely

| Object | Identity and freshness contract | Evaluation |
| --- | --- | --- |
| pnpm content store | Lockfile, pnpm behavior, OS/architecture and relevant supply-chain policy; still perform frozen install | Already used. Measure restore/download/link/postinstall separately before adding whole-tree caches. |
| PGlite templates | All migrations, schema/seed/content dependencies, builder code, frozen clock, PGlite/extensions and compatible platform/toolchain | Already used, but align outer/internal identity. Validate all variants exist and are readable; metadata alone is not a complete integrity check. |
| Chromium shell | Actual Playwright/browser revision and runner image/architecture | Current key uses the entire lockfile and image. Test a narrower browser-version key to avoid misses on unrelated dependencies; do not assume restore is faster than download. |
| Exact E2E build | Source/build input digest, lockfile, Node/Next version, build configuration and effective build-time environment | Already shared within the run. Cross-run reuse needs a provenance manifest, immutable artifact ID and successful producer step; a failed unrelated test need not invalidate correctly produced bytes. |
| Compiler cache | Compatible compiler/toolchain, schema, build configuration and environment; compiler must validate changed source | Experiment only. Current workflow records a prior cross-branch stale-schema incident and deliberately removed `.next/cache`. Reproduce correctness before restoring prefix fallbacks. |
| Visual baseline | Exact expected commit and published capture version, complete inventory, renderer/font/image identity and successful publication | Cached by commit plus marker version, with exact S3 fallback; reports predating version metadata retain the commit-only cache key. Do not substitute a partial or latest-available snapshot. |
| Test result | Complete dependency closure, harness, inputs, environment, platform and execution mode | Not a safe general cache today. Source-text reads, dynamic inputs and integration ordering make positive-result reuse harder than artifact reuse. |

These identity requirements are recommendations derived from the repository's code and observed
failure modes, not claims that a platform automatically enforces them. Build artifacts are executable
code: content integrity does not establish producer trust or compatibility. Keep untrusted PR
artifacts out of privileged publishing contexts; GitHub warns about untrusted code under
[`workflow_run` and `pull_request_target`](https://docs.github.com/en/actions/reference/security/secure-use).
Use immutable artifact IDs, repository/run/SHA provenance and expiration checks when downloading
across runs. The pinned action family supports explicit run IDs and artifact IDs; verify the exact
configured version's digest behavior rather than relying on old documentation defaults.
See [download-artifact](https://github.com/actions/download-artifact).

Playwright explicitly cautions that browser-cache restore can cost as much as downloading binaries,
and Linux system dependencies are not part of that cache. Its recommended identity is the
Playwright version. See [Playwright CI](https://playwright.dev/docs/ci#caching-browsers).
Next's [build-cache guide](https://nextjs.org/docs/app/guides/ci-build-caching), also bundled in the
installed package, documents compiler-cache persistence, but does not override this repository's
recorded Turbopack/schema incompatibility. Distinguish compiler cache from a ready-to-run build.

## Replay without the unrelated-work wait

At the existing workflow boundary, choose a failed job by its actual job database ID, rather than
rerunning a whole green build and every successful shard. The job rerun endpoint also reruns its
dependent jobs, so the aggregate result can be recomputed. GitHub retains the original SHA/ref and
actor privilege boundary for reruns. These are documented capabilities, not a promise that an
in-progress run permits replay immediately; verify that behavior before depending on it.
Sources: [job replay API](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run),
[rerun semantics](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

To remove that scheduling coupling reliably, evaluate independently dispatched validation lanes
with explicit source SHA and build artifact ID inputs. A read-only dispatcher can start a new
failed-shard replay once the build artifact exists, while unrelated original lanes continue.
Associate the replay with its original lane and attempt, and record the reason. A SHA-bound
aggregator must require the exact expected lane inventory and reject missing, expired, stale or
cancelled evidence. A diagnostic replay alone must not turn the original required check green.
Reusable workflows called through the same top-level run improve maintenance but still share that
run's lifecycle; they are not, by themselves, this scheduling change.

Retain attempt-specific JSON/traces and use attempt-specific output artifact names where a rerun
would otherwise collide. The repository's narrow wedge classifier can retry only a report whose
failures all carry the specified renderer-wedge evidence; preserve that refusal for mixed failures.
Source: [retry policy](../../../scripts/e2e-retry-policy.mjs). Independently replaying a known failure
for diagnosis should not erase the fact that the first attempt failed.

## Runner capacity and cancellation

The Mac path currently selects registered online runners, not spare capacity. Four configured
containers at two CPUs and four GB each can compete with local development; online-but-busy is not
equivalent to available. Measure selection-to-start delay and Mac memory/CPU pressure before moving
more work there. Retain ephemeral job containers, the trust boundary and hosted fallback; persistent
shared app servers/databases would add contamination risk. Sources:
[runner selection](../../../scripts/ci-runner-pick.mjs), [launcher](../../../scripts/mac-runner/start.sh).

PR supersession cancellation already avoids obsolete same-ref work. Main uses per-commit groups
because baseline publication must not disappear. Current GitHub documentation additionally supports
`queue: max`, retaining up to 100 pending entries, unlike the default single-pending replacement.
That offers a scheduling experiment for trusted publication work, not grounds to cancel main runs
blindly: serialization can increase merge-to-baseline delay, and queue order is not a dependency
proof. See [concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

The accepted [full-layer ADR](../../architecture/decisions/20261003-every-stack-layer-runs-ci.md)
explicitly rejected green middle layers that had run no browser checks. The current research can
challenge its cost policy, but any replacement needs a new decision: for example, an explicit
provisional PR status plus complete merge-candidate validation, or proven same-input evidence reuse.
Keep main/full validation as the backstop while comparing a shadow selector against actual failures.

## Telemetry needed before choosing a redesign

Collect per run, attempt, job and worker: commit/tree SHA, event/base SHA, runner image/architecture,
CPU/memory limits, queued/start/end timestamps, cache key/hit/restore/save bytes and duration,
dependency install/link time, build/transfer size and duration, server/browser warmup, template
fingerprint/rebuild/hydration, per-test reset/body/teardown, retry reason, selected inventory digest,
test first-attempt status, coverage mode and artifact provenance/expiration.

Report elapsed critical path, total active job-minutes, time to first actionable failure,
time from failure to replay result, longest-minus-shortest shard, cache churn, cancelled wasted
minutes and first-attempt reliability. Segment cold/warm caches, PR/main, hosted/Mac and toolchain
changes. Existing duration reporters and attempt artifacts are a foundation; a weekly committed
weight map alone cannot attribute queue, setup or retry cost. Source:
[duration refresh](../../../.github/workflows/durations-refresh.yml).

Choose one controlled comparison at a time. Evaluate bootstrap/key correctness first, then replay
independence, then packaging/runner changes, and only then change validation policy. This order
reduces duplicated work while keeping failures visible; it does not imply a numerical speedup.
