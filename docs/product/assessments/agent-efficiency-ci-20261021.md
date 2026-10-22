# Agent efficiency audit: CI, verification, and delivery

Audit date: 2026-10-21. Scope: read-only inspection of the current checkout, verification
playbooks, workflow implementation, and a live GitHub Actions sample. No application or pipeline
changes were made. Recommendations are assessment proposals, not changes to accepted policy.

## Executive assessment

The repository already has unusually capable verification infrastructure. Its strongest tools
solve real observed problems: affected-spec selection, cost-weighted test shards, isolated
fixtures, quiet passing logs, machine-readable failure reports, and immutable visual baselines.
The highest-return improvements are making those tools agree and making agents consume their
answers, rather than adding more mandatory review stages.

Three immediate problems stand out:

1. Local verification discovers only `claude/*` stack parents while recent work predominantly
   uses `codex/*` branches.
2. The feature playbook tells agents to wait for visual baseline commits the current pipeline
   does not create.
3. The quick gate deliberately excludes browsers, but the earlier feature-checklist requires
   focused browser verification. There is no unified evidence artifact showing that the earlier
   obligation actually happened before a quick stamp.

## Live CI evidence and limitations

Fetched the 50 most recent runs of `ci.yml` using the repository's GitHub REST API. The sample
runs from 2026-10-20 04:30 UTC through 2026-10-21 21:36 UTC, with latest updated time 21:59 UTC.
It is a recent convenience sample, not a random sample or historical baseline.

The [exact 50-run sample](agent-efficiency-ci-sample-20261021.json) preserves run IDs, event,
branch, SHA, final conclusion, attempt count, timestamps, and source URLs. Each row is one
workflow run, not one job or one unique PR. These counts are not a PR first-pass success rate.

| Measure | Observed |
| --- | ---: |
| Workflow runs | 50 |
| Success / failure / cancelled | 27 / 16 / 7 |
| Pull-request runs | 32 |
| PR success / failure / cancelled | 13 / 12 / 7 |
| PR completed failure rate, excluding cancellation | 12 / 25 = 48% |
| PR runs without a successful final result, including cancellation | 19 / 32 = 59.4% |
| Runs whose final `run_attempt` exceeds 1 | 5 |

A successful final run may hide failed earlier attempts. A cancellation may be intentional, and
these counts do not establish a code defect or agent mistake in every unsuccessful run. No token
usage, active human time, runner-minute totals, or PR lead-time distribution was available from
this query. `updated_at - created_at` includes queue and rerun delay, so it is not CPU runtime.

Examples inspected through job and check-annotation APIs:

- [Map all-pins run 39679854103](https://github.com/AaronBuxbaum/diveday/actions/runs/39679854103):
  failed Playwright shard 6/6. Six tests in `e2e/a11y-map.spec.ts` failed in the shared beforeEach
  expectation: `.leaflet-site-marker button` expected 20 elements, received zero. This is a
  concrete rendered-structure/test-contract mismatch, not evidence that increasing a timeout
  would help. Elapsed workflow interval: 14m40s.
- [Shop polish run 39534084279](https://github.com/AaronBuxbaum/diveday/actions/runs/39534084279):
  failed Playwright shard 2/6. `find-my-booking.spec.ts` waited for the Sign out button through
  `e2e/helpers.ts:41` until its 30-second test timeout. Root cause was not reproduced in this
  audit; the annotation identifies a shared interaction helper as the failure boundary.
- [Main package bump run 39658427083](https://github.com/AaronBuxbaum/diveday/actions/runs/39658427083):
  Lint and Playwright shard 5/6 failed. Git history identifies its `e82acdfc8` commit as
  “Bump packages”; subsequent `b06347461e` (“Resolve biome errors”) changes `biome.json`, and
  `971c490d4` (“Fix linting”) changes configuration, tests, and stylesheet. The latter two main
  runs succeeded. This establishes repeated delivery/check work around one upgrade sequence;
  it does not prove every later change was caused by the upgrade.

The shop-polish branch appears with five failed sampled runs before the sampled successful run
39536375670. No claim is made that all five had the same cause. Existing historical analysis in
`docs/agents/verifying.md:58-77` records a different, earlier period with 169 runs and 128
cancellations; it is supporting historical context, not a measurement repeated here.

## Prioritized findings

### P0: Resolve the actual PR base independently of provider branch names

**Evidence:** `scripts/e2e-affected.mjs:104-125` enumerates only
`refs/remotes/origin/claude` to choose a stack base. `scripts/verify-push.mjs:423-425` uses that
answer for affected-spec selection and subsequently checks its CI verdict. Live runs include
numerous `codex/*` branches.

**Impact:** A Codex layer whose actual parent is another Codex branch can fall back to main.
That broadens the diff to inherited work, increases related-test selection, and consults main's
CI instead of the immediate parent's. An unrelated contained Claude ref can also become the
heuristic answer. The exact local cost was not benchmarked.

**Recommendation:** One provider-neutral base resolver shared by verification, affected-spec
selection, and stack reporting. Prefer the actual PR base when available, then an explicitly
recorded local upstream, with a clearly labelled conservative fallback. Regression cases should
cover codex, claude, arbitrary branch names, merged-parent histories, and absent remote access.
Keep visual comparisons against the documented stack fork point; that is a different purpose
from selecting a layer's local tests.

### P0: Delete the obsolete visual baseline-commit procedure

**Evidence:** `.claude/skills/new-feature/SKILL.md:51-55` says a serialized visual job creates
`ci: capture visual baseline diffs`, then agents should watch the resulting visual-only check.
Current `.github/workflows/ci.yml:975-1044` compares through reg-suit, publishes S3 snapshots,
caches main's captures, and posts a sticky visual summary. It has no baseline git commit step.

**Impact:** An agent following the prescribed feature workflow can wait for an event that never
arrives, seek nonexistent baseline diffs, or misclassify an unfinished visual review as complete.
This directly connects instruction drift to both elapsed time and visual mistakes.

**Recommendation:** Replace that step with the current visual-triage entrypoint and a concrete
completion contract: capture jobs complete, comparison exists, affected images reviewed, every
changed/new/deleted image explained, and review tied to the exact head SHA. Add a small workflow
contract test for the skill's named outputs rather than another prose reminder.

### P1: Make required local browser evidence visible in the quick gate

**Evidence:** `.claude/skills/verify/SKILL.md:20-29` requires affected browser checks before
commit, then describes `verify:push --quick` as no-browser. `scripts/verify-push.mjs:174-194`
implements static checks plus import-related unit tests. `:274-280` explicitly reports all
Playwright specs unrun. `docs/agents/verifying.md:112-127` explains the deliberate tradeoff.

**Impact:** “Quick green” is honest but does not answer whether a changed interaction or shared
helper was exercised. The live map and sign-out failures show the kind of expensive late signal
that remains. Requiring every browser test locally would reverse an explicit user decision and
recreate the former hour-long gate.

**Recommendation:** Preserve the quick default. Produce a small per-change verification manifest
with affected routes, changed helper consumers, focused tests, capture paths, and observed SHA.
For rendering/interaction work, offer a bounded targeted-browser tier using a valid existing
build. Expose missing evidence explicitly, with CI as the intentional next source of evidence
when the local host is unsuitable. Never describe quick stamps as full assurance.

### P1: The quick gate repeats independent work and stops at the first failure

**Evidence:** Pre-commit lint/typecheck are mandatory in the verify skill; `staticSteps` repeats
lint, typecheck, repository guards, and guard tests before push
(`scripts/verify-push.mjs:153-171`). The execution loop runs sequentially and exits at first red
(`:510-569`). `scripts/check-all.mjs:1-25` already documents exactly why serial, fail-fast gates
create multiple fix-and-rerun cycles and implements independent fail-slow phases.

**Impact:** A change with lint and type failures can pay several complete gate starts, while
already-passing checks run again after commits that did not alter their inputs.

**Recommendation:** After regeneration/clean-tree validation, gather independent static failures
in one bounded pass; cap concurrency for shared machines. Reuse successful stage evidence by
content fingerprint plus toolchain/config/environment identity, not merely commit identity.
Keep the final aggregate stamp bound to HEAD. Do not cache network-dependent or base-verdict
checks without freshness semantics. Measure before/after p50 and p95 local verification time.

### P1: Consolidate CI failure evidence into one agent-readable result

**Evidence:** CI separately exposes failed-file annotations, check-repo artifacts, timing data,
visual-plan artifacts, and visual comments (`ci.yml:94-114`, `:224-243`, `:634-647`, `:1007-1044`).
The final aggregate job says whether jobs passed; it does not supply a unified repair plan.

**Impact:** Agents spend tool calls retrieving jobs, annotations, logs, and screenshots and can
mistake timeout warnings for the actual failure. The map run annotated tests near their time
budget, but their real failure was zero matching DOM elements in a shared setup assertion.

**Recommendation:** Publish one versioned result manifest per attempt: exact SHA/base, unique
failure signatures, first failing setup/helper, consumers, relevant bounded log excerpt,
artifact links, and exact minimal reproduction command. Classify assertion, infrastructure,
setup, selection, and visual-review failures. Preserve raw logs and avoid auto-asserting cause.
A `ci-triage` skill should consume this contract before downloading entire job logs.

### P1: Treat dependency/toolchain updates as coherent verified units

**Evidence:** The sampled main sequence `e82acdfc8 → b06347461e → 971c490d4` required a failed
package-bump run followed by two successful correction runs. The bump updates Biome/package
metadata; follow-on commits alter Biome configuration and linted sources.

**Recommendation:** A dependency-maintenance skill should read installed migration guidance,
apply config migration, run lockfile install plus the changed tool's gate, then emit one coherent
reviewable update. Keep upgrades separate from feature intent so agents can identify the source
of new diagnostics. Confirm the sequence's exact authorship and authorization before making
claims about how it bypassed policy; this audit does not establish those facts.

### P2: Separate machine setup cost from test cost before adding shards

**Evidence:** Every use of `.github/actions/setup/action.yml:9-18` sets up Node/pnpm and runs a
frozen install. Visual planning separately installs dependencies and lists tests
(`ci.yml:605-647`). Build and capture jobs have distinct setup. Test weighting already exists
in `vitest.config.ts:127-138`; durations refresh already exists.

**Recommendation:** Measure queue, checkout, install, build, fixture, test, artifact, and compare
phases separately. Optimize the dominant phase, not shard count by intuition. Evaluate a small
browser-image cache or reusable listing artifact only when measured savings exceed invalidation
and transfer costs. Do not remove Linux visual consistency or share mutable node_modules
between concurrent jobs to save installation time.

### P2: Reconcile docs and executable verification policy

**Evidence:** `docs/agents/verifying.md:24` describes UI tests as forks, while
`vitest.config.ts:199-218` selects `vmForks`. The verify skill still says CI runs `pnpm check`
whole; current CI splits guards, lint, typecheck, and unit shards into separate jobs.
`scripts/verify-push.mjs:135-140` and `ci.yml:1291-1292` maintain similar but nonidentical docs-only
filters (CI also excludes LICENSE). These are smaller examples of the same drift mechanism.

**Recommendation:** Generate the command matrix and stage descriptions from executable policy,
with docs retaining reasoning and explicit human decisions. Test shared selectors against a
small canonical matrix of changed paths. Avoid enforcing formatting details of prose as a proxy
for correct behavior.

## Constraints to preserve

- Full CI on every stack layer is an accepted explicit user decision, ADR
  `20261003-every-stack-layer-runs-ci`; do not quietly skip middle layers as an “optimization.”
- Per-commit main concurrency preserves visual baseline publication. `ci.yml:38-57` documents
  why cancelling queued main runs previously made visual comparisons blind.
- Affected PR visual capture already exists (`ci.yml:605-647`); recommending its introduction
  would duplicate current functionality.
- The repository has zero default Playwright retries and a narrowly scoped wedge recovery;
  replacing diagnosis with broad retries would reduce confidence while hiding repeated defects.
- Known local fixture CPU cost is documented in `docs/agents/verifying.md:129-175`. Read trace
  setup timing before treating a local timeout as an application performance regression.

## Suggested rollout and success criteria

1. Correct the two concrete policy/implementation mismatches first: provider-neutral base
   resolution and the obsolete visual completion step. These are bounded changes.
2. Ship the CI result manifest and targeted evidence manifest, then the lightweight triage and
   dependency-update skills. Prefer two useful skills to another broad universal checklist.
3. Measure two weeks of completed PR attempts: first-attempt green rate, cancellations per
   landed PR, time from first red to diagnosed cause, repeated failure signatures, verification
   minutes, and visual issues found before versus after merge. Track median and p95; segment
   feature, docs, dependency, and infrastructure changes.
4. Only then change caching/concurrency/gate policy. Preserve final correctness requirements and
   compare landed-work latency, not just time to first push.

No tests or builds were run for this read-only assessment. No CI retry was triggered, no issue
was created, and no repository policy was changed. All GitHub observations above are snapshots
of the cited runs rather than claims about the current status of their branches.
