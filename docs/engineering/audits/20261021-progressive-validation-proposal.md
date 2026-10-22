# Faster trustworthy validation — proposal, 2026-10-21

Status: research and proposed decisions. No CI policy, repository settings, runner configuration
or runtime code changed in this investigation. Source snapshot: `749028e685a5a7e2f7b481b28f6f8ab1262365e0`.
That work has since landed on main through PR #2882. Live settings and run data were inspected on
October 21; they can change independently of this document.

## Recommendation

Separate draft publication from merge admission. Make the edit loop and draft publication cheap,
give agents early actionable failures, and require complete evidence for the exact merge candidate.
First enforce that last requirement remotely: the visible main rules currently do not require PRs
or passing checks. Then trial cheaper draft publication while preserving full remote CI per layer.

Improve affected selection in shadow mode at the same time. Use it first to order work and explain
impact; promote a change class to exclusion only after testing its assumptions against full runs,
historical regressions and adversarial dependency cases. Browser selection deserves as much
attention as unit selection because browsers account for most measured execution cost.

The policy decision is tracked in [#2891](https://github.com/AaronBuxbaum/diveday/issues/2891).
Bootstrap reliability already has [#2890](https://github.com/AaronBuxbaum/diveday/issues/2890).
The snapshot cache mismatch is tracked in [#2892](https://github.com/AaronBuxbaum/diveday/issues/2892).
This proposal does not replace the accepted
[full CI on every stack layer decision](../../architecture/decisions/20261003-every-stack-layer-runs-ci.md).

## What the measurements establish

We examined the latest 100 CI workflow runs, spanning October 17–21, and inspected execution details
for eight successful runs plus selected failures and all three attempts of the last testing PR.

| Observation | Result | Meaning |
| --- | --- | --- |
| Terminal PR runs in the 100-run sample | 66 across 23 branch names: 25 success, 25 failure, 16 cancelled | Substantial churn; multiple runs per PR, so this is not a PR failure probability |
| Successful first-attempt PR runs | 20; median 15.04 min, p90 22.22 min | A clean first pass already consumes meaningful agent/reviewer time |
| All successful PR runs | 25; median 17.35 min, p90 41.75 min | Retries and waiting contribute to the long tail |
| Eight selected successful runs | Median 176.0 summed job-minutes, range 165.4–191.0 | Parallel work is expensive even when elapsed time looks acceptable |
| Execution share in those eight runs | Visual 40.9%, functional browsers 34.9%, units 19.0%, other 5.2% | Unit selection alone cannot remove most execution cost |
| Materialized-job queue in that sample | 220 jobs; median 2 sec, p90 5m50s, maximum 10m41s | More shards can increase waiting and preparation overhead |
| Common setup steps in that sample | 204 observations; median 18 sec, p90 24 sec | Routine setup is relatively short; rare setup failures have disproportionate impact |

Elapsed run statistics use creation-to-update time as a completion proxy and nearest-rank p90.
They exclude nonterminal runs. Final conclusions hide earlier failed attempts; cancellations are
not test failures. These are convenience samples, not a randomized study or a measurement of
billed cost. Queue values exclude workflow admission and dependency waiting. The supporting
[execution research](20261021-ci-execution-research.md) records run IDs, job links and retry
deduplication caveats so those distinct quantities are not confused.

The clearest case is [run 39666872384](https://github.com/AaronBuxbaum/diveday/actions/runs/39666872384):
41m45s elapsed, with two package-setup failures and passing actual tests. The first build failure
waited roughly seven minutes for the rest of its attempt to finish. A later visual setup failure
waited almost twelve minutes for other browser work before a new attempt could replay the shard.
The local unit gate had already taken 690 seconds before publication. This case demonstrates
duplicated waiting and failure-replay coupling, not a selector missing a regression.

Other sampled failures included a source-contract assertion, accessibility violations and browser
locator timeouts. A timeout is not automatically a flake. Keep product regressions, test defects,
demonstrated nondeterminism, infrastructure failures and unknown failures separate.

## A better affected suite

The current implementation already has native unit import selection, broad source-reader
augmentation, route/copy browser heuristics, affected visual captures, weighted sharding and
conservative full fallbacks. Preserve these while measuring where they overselect.

### One explainable plan, several kinds of dependency

Local tooling and CI should consume one versioned impact plan. It should name the source tree,
base/integration identity, selector version, selected projects/files, required checks and the
reason for each selection. It must distinguish a true empty selection from failed discovery.
Local plans include working/untracked edits; CI plans bind to an immutable candidate.

| Dependency | Proposed treatment |
| --- | --- |
| Imports, aliases, mocks and shared test fixtures | Keep native runner resolution; union positive edges from base and head so removed imports retain their former consumers |
| Runtime-loaded modules | Evaluate Vitest's installed recorder as additional evidence; compare static, recorded and union plans |
| Files read by tests | Declare or record concrete fixture/source inputs, beginning with shared source-reader helpers |
| Directories, globs and missing files | Record membership queries and negative lookups; adding a file can invalidate a test that never read that file before |
| Browser routes and server actions | Map routes/layouts/actions to tests; later add request-correlated server observations rather than assuming test imports cover the app |
| CSS, tokens, copy and visual states | Preserve affected visual planning; explain broad expansion, and distinguish new captures from baseline-filled surfaces |
| Schema, seed, auth, configuration and dependencies | Retain explicit broad risk triggers; narrow a trigger only after demonstrating a complete contract |
| Unknown/deleted/unmapped inputs or stale records | Run the broader suite with a visible fallback reason |

The installed Vitest 5.0.5 bundle contains `experimental.recordDependencies`, but current official
documentation labels the capability 5.1.0+. Validate the pinned implementation in a bounded pilot;
do not assume compatibility or upgrade just to follow the live documentation. Recorded imports
still miss arbitrary filesystem reads and unobserved paths. Details and primary sources are in
[selection research](20261021-test-selection-research.md).

For browser tests, Playwright's changed-test import graph does not automatically connect an HTTP
request to Next server modules, database queries or actions. Client coverage is also incomplete
evidence. A useful graph needs those explicit application connections, with shared layout, auth,
theme, locale and data dependencies propagating to every affected journey.

Start at test-file granularity. Per-case attribution is a later optimization: parameterized cases,
hooks, concurrent execution and server background tasks make it substantially harder to trust.
Maintain a small explicit critical-journey set for relevant security, capacity, persistence and
mobile changes; do not drop existing critical behavior merely because telemetry has not seen it.

### Prove usefulness before changing merge coverage

1. Emit a shadow plan while the full suite continues to run. Join every result, including retries,
   skips and collection failures, to the plan. Report why broad fallbacks happened.
2. Replay historical fixes using only dependency evidence available at the original candidate.
   The eventual fix's graph must not leak into the evaluation.
3. Exercise adversarial cases: new glob members, formerly missing files, deleted imports, dynamic
   loading, shared fixtures, schema/config changes, subprocess reads and concurrent requests.
4. Seed representative faults. First verify that the full suite detects each fault, then verify
   that the candidate selection retains a detector. This separates weak tests from weak selection.
5. Measure first actionable failure, full verdict, planning overhead, selected fraction, fallback
   frequency and total execution cost. Smaller test counts alone are not a speedup result.
6. Decide promotion per change class, with an observation period, rollback switch and full audits.
   No observed misses is evidence, not a universal zero-miss guarantee.

Ordering is useful immediately: known failures, edited tests and direct contracts run early, then
broader impact and the rest. Prefer ordering existing work over a serial preliminary suite that
duplicates setup and tests. An extra fast lane is worthwhile only if its feedback benefit exceeds
the capacity it takes from full validation.

## Change the path from an agent edit to a merge

| Stage | Proposed behavior | Claim allowed |
| --- | --- | --- |
| Edit loop | Regression first, focused behavior tests, inexpensive hygiene | This change's focused checks passed |
| Draft publication | Cheap checks, explicit omissions, exact SHA receipt | Draft available; full validation pending |
| Remote feedback | Whole static checks and prioritized affected work | Early findings available |
| Merge admission | Required aggregate for the up-to-date candidate and complete applicable full matrix | Candidate verified for merge |
| After merge | Main health and baseline publication; deployment checked separately | Tested, merged and deployed remain separate states |
| Scheduled deep checks | Flake probes, mutation, extended devices and long-running experiments | Additional evidence, not retroactive proof for an earlier merge |

The current local push gate remains in force until that contract changes. Reducing it first would
remove protection without installing its replacement. The observed ruleset called “No push to
main” only restricts deletion and force pushes; it does not enforce its name's apparent promise.
Require the stable aggregate and PR admission, verify expected lanes and explicit skips, and test
missing/stale/cancelled check behavior before relying on it.

GitHub's native merge queue is documented for organization-owned repositories; this repository is
personally owned. A near-term option is required checks and serialized, accountable landing with
base/SHA revalidation. Ownership transfer or a custom queue deserves a separate decision.
See [workflow research](20261021-agent-ci-workflow-research.md) for live-setting evidence and sources.

For an inherited red base, use one incident keyed to the base SHA and failing test/check, with one
repair owner. Other agents should preserve evidence and continue useful draft work under the
approved publication policy. They should not each pay for the same full reproduction. Merge
admission still requires the repaired candidate to pass.

## Execution improvements alongside selection

| Priority | Improvement | Why it matters and what to validate |
| --- | --- | --- |
| First | Correct snapshot cache identity | Outer CI keys omit the extracted DB builder while the internal fingerprint includes it; immutable cache hits can repeatedly restore stale snapshots that must rebuild |
| First | Attempt-aware timing and failure classification | Separate actual test regressions from infrastructure and inherited failures; preserve first failures after retry |
| First | Bootstrap reliability | Address #2890 with bounded, classified transport recovery; never apply retry-until-green to arbitrary assertions |
| Next | Independently replayable validation lanes | Permit a failed shard to recover without waiting for unrelated jobs; require exact SHA/build identity and a fail-closed aggregate |
| Next | Exact-input build/runtime artifact reuse | Avoid repeated preparation where provenance is complete; existing within-run build sharing is already implemented |
| Experiment | Snapshot preparation once per cold input set | Can eliminate duplicated work, but a central preparation job also adds queue and download latency |
| Experiment | Worker/shard/runner tuning | Optimize queue plus slowest-shard time at a fixed capacity budget; more shards are not automatically faster |
| Experiment | Explicit source-read contracts and shared parsing | Reduce broad reader seeds and repeated tree scans while retaining unknown-input fallbacks |

Artifact reuse is easier to trust than test-verdict reuse. Include source/test/config inputs,
toolchain, platform/browser, seed/clock, effective environment identity and producer provenance.
Missing or expired evidence reruns the work. An application build can survive a test-only edit;
the new test still needs execution. A cache hit is not a passing assertion.

Do not restore broad compiler-cache fallbacks without reproducing the previously documented
stale-schema incident. Do not remove DB isolation to save resets. Do not cancel old main baseline
publishers merely because a newer commit exists. Each has a concrete correctness dependency.

## Alternatives worth evaluating, with their tradeoffs

- **Affected-only merge CI:** greatest potential reduction for narrow changes, but requires proven
  non-import dependency handling and an explicit replacement policy. Nightly full runs cannot
  guarantee every preceding merge was safe.
- **Full proof only at the top of a stack:** saves duplicate work but delays failures and recreates
  the out-of-order merge hazard behind the current ADR. Evidence must bind to each admissible
  integration candidate; a green ancestor/top does not certify arbitrary layers.
- **Separate unrelated work from dependency stacks:** may reduce inherited failures and cascading
  invalidation. Compare that against shared-file conflict cost and retain capacity scheduling.
- **Larger runners or more concurrency:** can reduce queue/execution time at a monetary/resource
  cost. Measure memory, CPU, worker counts and utilization first; the shared Mac also serves agents.
- **Component-level visual fixtures:** may cheaply cover many presentation states while critical
  integration screenshots remain. Validate that fixtures reproduce actual CSS, fonts, data and
  responsive states before replacing journey captures.
- **Per-test coverage or learned failure ranking:** useful additional prioritization signals.
  Historical execution cannot prove new branches harmless; probabilistic ranking should not
  silently become merge exclusion.
- **A new build-system/task-cache platform:** potentially valuable with explicit task inputs, but
  migration does not discover hidden filesystem, database or browser dependencies for us. Establish
  the manifest and measurements before adopting another orchestration layer.

## Pilot sequence and acceptance

First correct known execution waste and collect attempt-aware telemetry. In parallel, design and
verify required merge admission. Then trial cheap draft publication while keeping full CI per PR.
Next introduce shared shadow plans, recorded-unit dependency experiments and explicit source-read
contracts. Extend browser/server and visual mappings after identifying the largest fallback classes.
Only then consider selective blocking CI or a different stack policy through a replacement ADR.

Initial targets for discussion: draft publication p50 within two minutes/p95 within five; warm
edited-unit feedback p95 within one minute; actionable remote feedback p50 within five minutes;
complete merge proof p95 within thirty minutes. These are proposed budgets, not measured promises.
Track whole-workflow first-attempt false reds, with a proposed target below 5%, and keep test defects,
renderer wedges and bootstrap outages separate. Per-test flake rates are diagnostic: a seemingly
small rate across tens of thousands of tests can still make almost every workflow red.

Success means lower end-to-end agent time and fewer repair loops while maintaining explicit merge
evidence. Report cold/warm distributions, queue versus execution, superseded work and escaped
regressions alongside speed. A faster push followed by more failed PR cycles is not success.

The three supporting reports contain the detailed source references and evaluation designs:
[selection](20261021-test-selection-research.md),
[execution](20261021-ci-execution-research.md), and
[agent/publication workflow](20261021-agent-ci-workflow-research.md).
