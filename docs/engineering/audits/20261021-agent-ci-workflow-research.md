# Agent publication and CI workflow research — 2026-10-21

**Status: research and proposals, not an accepted policy or implementation.** The existing verify
skill, push hook, stack policy and required reviews still apply. This note explores how an agent
could publish reviewable work sooner while preserving an authoritative merge decision.

## Finding

The strongest first move is to establish a real merge boundary, then separate saving a draft from
proving a candidate safe to merge. Making every local push carry most of CI's answer delays remote
feedback, while allowing merges without required checks makes those local controls carry more
responsibility than a client-side hook can reliably provide. Red draft feedback can be useful;
red main and an inaccurately green check remain defects.

This is a proposed change to the publication contract. It does **not** imply skipping full CI on
middle stack layers. [ADR 20261003](../../architecture/decisions/20261003-every-stack-layer-runs-ci.md)
explicitly rejected that policy because a green middle layer could mean its browser tests never
ran. Any eventual departure needs an explicit superseding decision and a different, honest check
contract.

## What was verified

The repository snapshot was inspected at `749028e685a5a7e2f7b481b28f6f8ab1262365e0`. Read-only
GitHub API queries and official documentation were checked on 2026-10-21. No heavy tests, runtime
changes, repository-setting changes or pushes were made for this research.

| Boundary | Current evidence and implication |
| --- | --- |
| Local publication | [verify-push.mjs](../../../scripts/verify-push.mjs) runs regeneration, whole lint/typecheck/repository safeguards, guards, then selected units. Global inputs or deletion can widen quick mode to all units; named base browser failures add a build and replay. “Quick” describes policy, not a latency bound. |
| Local stamp | `guard-push.mjs` (removed 2026-10-25) accepts a verification stamp for the exact SHA. A new merge/amend needs a new stamp. Its hook is a provider/tool convention, not server-side merge enforcement; it also deliberately fails open for unknown hook input. |
| Exceptional publication | The verify skill allows a stated override for saving ephemeral work or learning something only CI can answer. It rejects blaming an inherited failure. This is an exception, not a normal fast-publication lane. See [verification](../../agents/verifying.md) and [session hooks](../../agents/session-hooks.md). |
| Baseline failures | [base-ci.mjs](../../../scripts/base-ci.mjs) adds named failing unit/spec files, refuses unclassified failures without explicit files, and reports pending/unknown base CI. Unavailable API data fails open locally. Missing named replay files now refuse verification. |
| Remote proof | [ci.yml](../../../.github/workflows/ci.yml) runs every PR through its applicable full gate: four unit shards, build, six functional browser shards, visual jobs and specialized checks. `CI result` aggregates failures/cancellations. Some jobs intentionally skip by change category. |
| Stack pacing | The [stack skill](../../../.agents/skills/stacked-prs/SKILL.md) serializes one PR's CI at a time under the documented runner cap and stacks unrelated work too. This reduces shared-file conflicts but couples unrelated publication and repair latency. |
| Reuse already present | CI shares the `next-build` artifact with browser shards. Local `appTreeKey` reuses builds across test/docs-only changes. These reuse execution inputs, not arbitrary green verdicts. |
| Long-tail coverage | [E2E nightly](../../../.github/workflows/e2e-nightly.yml) runs quarantines and a bounded recent-failure flake hunt; [testing policy](../testing.md) caps quarantine at three tests and seven days. Nightly coverage is already distinct from PR coverage. |

The [existing audit](20261021-testing-and-ci.md#implementation-follow-up-local-test-cost) records
253 selected files out of 1,878 non-guard files in one conservative replay and quick planning of
99 ms versus 1,957 ms. Those are recorded scenarios, not current distributional latency or proof
that whole local verification is fast. This research did not rerun those benchmarks.

### Main admission is not currently configured by the visible rules

The live [repository metadata](https://api.github.com/repos/AaronBuxbaum/diveday) identifies a
public repository owned by a `User`. The classic main protection endpoint returned HTTP 404.
The only returned active [ruleset, 19471629](https://api.github.com/repos/AaronBuxbaum/diveday/rulesets/19471629),
contains `deletion` and `non_fast_forward` rules for the default branch, with no bypass actors.
It does not require a pull request or a status check. Its name, “No push to main,” does not express
the returned rules' actual effect. This is a settings snapshot, not a guarantee against later
changes or rules invisible to this account.

GitHub supports required checks through rulesets, including in public repositories on Free plans.
A required workflow can remain pending when its trigger is skipped; a conditionally skipped job
can report success. A stable aggregate must therefore validate the expected job matrix and
selection reasons, not merely count green icons. See [ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
and [required-check behavior](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/troubleshooting-required-status-checks).

### Native merge queue is not an immediately available switch

GitHub documents merge queue availability for organization-owned public repositories, or private
organization repositories on Enterprise Cloud. The current personal-owner metadata does not meet
that documented condition. Queue-based plans must first resolve eligibility, not promise a queue
here. Enabling it later also requires `merge_group` workflow triggers, which current `ci.yml` lacks.
See [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).

A practical nearer option is required checks plus a single accountable landing operator, checking
an up-to-date integration candidate and rechecking its SHA/base immediately before merge. A custom
queue needs race prevention, cancellation handling and recovery; it should not become an informal
shell loop. Transferring repository ownership to obtain native queue eligibility is a separate
human decision with broader consequences.

### Implementation status — 2026-10-29

The CI `CI result` job now compares the run's merge SHA and the event's head/base SHAs with the
current pull request from GitHub's API. It fails closed when the candidate moved or the live pull
request cannot be read. The job still validates all applicable full-CI lanes, as required by ADR
20261003. Read-only API inspection on 2026-10-29 found that ruleset 19471629 still contains only
`deletion` and `non_fast_forward`; classic branch protection still returns 404. The check therefore
does not block merges until a repository administrator updates the ruleset.

The remaining owner action is to edit **Settings → Rules → Rulesets → No push to main** (ruleset
19471629), require pull requests for the default branch, and require the successful **CI result**
check from **GitHub Actions** with the branch required to be up to date before merging. Save the
ruleset, then confirm through `GET /repos/AaronBuxbaum/diveday/rulesets/19471629` that the active
rules include the pull-request and required-status-check rules, the status context is `CI result`,
and no bypass actor can skip it. Do not change repository ownership or configure a merge queue as
part of this action.

## Proposed progressive gates

These are design alternatives for evaluation. No command or stamp below has been added.

| Stage | Proposed evidence | What it permits |
| --- | --- | --- |
| Edit loop | Reproduce the bug; run the edited regression first, then the smallest relevant behavior tests. Preserve red-before-green evidence where required. | More edits; no completeness claim. |
| Draft publication | Committed intended files, secret/file hygiene, changed-file syntax/lint, edited tests and explicit known limitations. Avoid a cold browser build merely to save a draft. | Publish a visibly unverified draft and begin remote feedback. This requires changing the current push contract after merge enforcement exists. |
| Fast remote feedback | Whole lint/typecheck/safeguards plus prioritized edited tests and affected tests, with an explicit selection manifest. Run alongside or ahead of the existing full gate, measuring the queue tradeoff. | Agent receives actionable failures quickly; still not merge eligible. |
| Reviewable candidate | Relevant behavioral proof, safety/security reviews where required, visual differences explained, baseline incidents resolved or carried. | Mark ready for final admission, not automatic merge. |
| Merge admission | Required aggregate for the exact up-to-date candidate, applicable full unit/browser/specialized matrix, complete review resolution and valid baseline provenance. | Human-authorized merge through the chosen landing process. |
| After merge | Main health, publication of required visual artifacts and applicable deployment verification. | Separate tested/merged/deployed claims. |
| Nightly/deep work | Quarantine repair, repeated flake probes, representative real-Postgres/restore/mutation/device coverage chosen by risk and cost. | Time-dependent and broad exploration; it cannot replace a blocking critical-journey regression. |

The least disruptive trial retains full remote CI on every PR and only evaluates a cheaper draft
publication lane. It preserves ADR 20261003. Delaying expensive remote jobs until cheap checks pass
could save failed-run minutes, but increases successful-run latency. Running a fast lane in parallel
can improve first feedback while consuming additional setup/runner capacity. Measure both before
choosing a dependency graph.

Moving browser proof exclusively to merge admission, testing only the top stack layer, or dropping
nightly-critical checks from PRs are larger alternatives. They risk late failure, incorrect
out-of-order merges and new meanings for “green.” They require an explicit policy decision,
credible admission enforcement and evidence that the lost earlier feedback is worth the saving.

## “Changed tests first” needs two separate meanings

**Ordering** should prioritize the tests an agent just edited, so a broken regression fails before
a long unrelated shard. **Selection** determines the additional tests that must run. Ordering does
not establish that the edited tests cover the change.

| Input | Defensible next step |
| --- | --- |
| Edited leaf test | Directly run it in its actual project; a guards-project test must not be excluded by `!guards`. |
| Shared exported/imported test fixture | Include its consumers through native dependency selection; do not assume every test is a leaf. |
| Production module | Native related/import selection plus conservative source-reader contracts; preserve wider merge proof. |
| Deletion, migration, schema, dependency/config change or unknown dependency data | Widen safely; a missing file cannot prove that its former importers disappeared. |
| Documentation contract input | Include source-reading contracts even when application imports do not reach the document. |
| No changed inputs | No affected contract seeds; only separately named baseline failures need replay, with guards retaining their own policy. |

These are current planner behaviors in [test-affected.mjs](../../../scripts/test-affected.mjs),
not a claim of perfect dynamic impact analysis. Vitest documents that `related` follows statically
resolvable imports and does not handle arbitrary variable imports. Disk reads and generated inputs
need separate treatment. See [Vitest CLI](https://vitest.dev/guide/cli.html#vitest-related).

A remote fast lane should consume the same versioned selection contract as local tooling and
report edited, dependent, contract-reader, forced-global and baseline-replay reasons separately.
Do not advertise “changed tests” when a global fallback selected everything. Record selection
precision and the failures found only by the full gate before considering narrower admission.

## Preserve stack evidence without repeating every expensive operation

Reuse is useful first for identical execution inputs: dependency downloads, compiled output and
immutable fixtures. Current build artifacts are already shared within a run. GitHub distinguishes
artifacts from dependency caches; a cache hit is not a test verdict. Its artifact tooling also
provides content digests. See [workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)
and [dependency caching](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows).

A proposed evidence record should identify source/test/config hashes, lockfile, Node/package
manager/browser/OS versions, schema/migrations/seed/frozen clock, build environment, selected tests,
shard identity, originating workflow/run and trust domain. Hash sensitive environment inputs without
publishing their values. Cache misses or incomplete provenance rerun the work. A test-only commit
may reuse the application build, but must execute its new tests. A lockfile or seed change cannot
inherit proof just because application source looks unchanged.

Reusing a test verdict across SHAs is a harder problem than artifact reuse. An identical tree can
still have a different integration base, workflow definition, environment or external dependency.
The candidate's required check must verify and disclose any reused evidence; copying an ancestor's
green status onto a child would recreate the ambiguity ADR 20261003 removed. Start with build reuse
and exact-input memoization inside one trusted workflow before considering cross-layer verdicts.

Forced stacks of unrelated work also deserve measurement: compare time saved resolving shared-file
conflicts with time lost to cascading invalidation, inherited failures and waiting for one layer's
whole CI. A proposal to separate unrelated ownership lanes from dependent stacks should retain an
explicit resource scheduler and shared-file ownership; branch topology alone is not scheduling.
This challenges current policy and is not permission to branch independently today.

## Superseded runs, main artifacts and baseline incidents

Keep three cancellation cases distinct:

- A newer push to the **same PR** can cancel obsolete work; a cancelled old SHA is not a passing
  candidate. Transfer ownership and useful diagnostics to the latest run.
- Opening a layer **above another PR** does not supersede that lower layer's merge obligation.
  Current ADR forbids cancelling/skipping its whole proof merely because it is now in the middle.
- A newer **main commit** does not automatically remove the need to publish the earlier commit's
  visual baseline. Current CI uses per-main-SHA concurrency groups to preserve those artifacts.

GitHub's default concurrency queue replaces a pending run; `cancel-in-progress` can also cancel
running work. Current documentation additionally describes `queue: max` for multiple pending runs,
with restrictions. This could inform a future scheduler, but is not implemented here and does not
justify changing baseline publication without a separate design. See [concurrency behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

For a red base, propose one incident keyed by base SHA, failing check and test identity. One named
repair owner reproduces and fixes it; other agents link evidence and continue safe draft work
instead of independently fixing the same spec or rerunning the entire base. New merges remain
blocked until their integration candidate passes. A candidate may carry the fix and prove it;
“inherited” alone never clears a failed check. Keep pending, unavailable history, infrastructure
failure, deterministic regression and demonstrated flake as separate states.

This coordinates the existing ownership rule instead of weakening it. Current local replay is a
useful repair mechanism, but requiring every unrelated draft to rebuild and replay a known base
browser defect can multiply the same cost. A cheaper publication lane would move that obligation
to accountable repair and merge admission, not label the defect harmless.

## Flakes and deterministic fixtures

Preserve first-attempt failures and their artifacts even when an allowed retry passes. Playwright
labels failure-then-pass tests flaky and recreates failed workers, so a clean retry is different
evidence from an uninterrupted pass. See [Playwright retries](https://playwright.dev/docs/test-retries).
Current [retry policy](../../../scripts/e2e-retry-policy.mjs) permits only one narrowly proved
renderer-wedge replay; mixed/unknown failures remain red. General retry-until-green would hide the
signal this workflow needs.

A fixture repair should target the causal boundary: isolated worker databases, private shops for
shop-wide settings, frozen clocks, controlled provider behavior and authoritative save receipts.
For example, the [payment regression](../../../e2e/ask-to-move.spec.ts) demonstrates that an
optimistic Paid label can precede persistence; a controlled request gate and success redirect wait
close that race. Auto-retrying assertions wait for their stated condition, not for unrelated work
such as persistence. See [assertion semantics](https://playwright.dev/docs/test-assertions).

Preserve issue-backed, nonrenewable quarantine expiry and the existing three-test cap while
measuring recovery. Assign one repair owner and link duplicate reports. Never classify missing
history as a clean flake hunt, widen test timeouts to accommodate shared-host contention, or make
an ordinary business failure eligible for the renderer exception. Schedule local heavy work with
a bounded owner-held lease, and record contention separately from test latency.

## Proposed agent/operator lifecycle

1. Claim the scope and read stack/base state. Name the owner, changed paths and intended proof.
2. Reproduce and run the edited regression first. Continue focused behavior checks while editing.
3. At a useful checkpoint, publish through the chosen publication policy. A draft receipt names
   exact SHA, tests run, omissions and baseline incident links; it never says verified implicitly.
4. Dispatch remote checks once per reviewable batch. Keep one owner for the current run and use
   event-driven completion or a bounded watch. An agent may hand off a persisted next action;
   ending a turn must not orphan a shell poller or force the agent to wait idly for every shard.
5. Triage the first failure by evidence. Repair product/test defects in the owning layer; route
   genuine infrastructure outages separately. Push a coherent fix batch that supersedes its own
   older run, retaining failure artifacts.
6. Obtain the applicable reviews and visual dispositions. Request merge admission only for the
   exact integration candidate; a base move invalidates or explicitly revalidates affected proof.
7. After human-authorized landing, report main health and deployment evidence separately. Clear
   claims, stop owned processes and leave an explicit owner/next action for any unfinished check.

Under today's policy, step 3 still means the existing verified push or its documented exceptional
reason. The cheaper draft lane above becomes valid only after an approved change to that contract.

## Proposed SLOs and measurement plan

All numbers below are **targets to test**, not measured facts, guarantees or current requirements.
Start by instrumenting two weeks of normal work, then revise targets against runner capacity and
risk. Record cold/warm installation, local contention, queue time and execution time separately.

| Measure | Initial proposed target | Definition |
| --- | --- | --- |
| Useful draft publication delay | p50 ≤2 min; p95 ≤5 min | From an agent declaring a publication checkpoint to remote SHA/PR availability; exclude coding/design time and report cold setup separately. |
| Edited-test feedback | Warm pure-unit/tooling p95 ≤60 s | From requesting the explicitly edited test to its first verdict; record config/discovery separately from execution. Database and browser tests get separate distributions and targets. |
| First actionable remote result | p50 ≤5 min; p95 ≤10 min | From push to a diagnostic with file/test identity; publish queue/start latency as a separate component. |
| Complete merge proof | p95 ≤30 min | From an admitted candidate's dispatch to authoritative full verdict, with a separately reported queue budget. This requires measurement before commitment. |
| Lost superseded work | ≤15% of PR runner-minutes weekly | Minutes spent on work cancelled by a newer same-PR push; exclude intentionally retained main artifact publication and report it separately. |
| Main proof coverage | 100% of merged candidates | Each merge links its exact required verdict and candidate/base identity; an enforcement invariant, not permission for a statistical failure allowance. |
| Main incident recovery | p95 ≤60 min during staffed/agent-active periods | From first confirmed required-gate regression to reverted or repaired admitted main; report inactive periods explicitly. |
| First-attempt workflow false-red rate | <5% of completed candidate workflows | Numerator: first-attempt red workflows subsequently demonstrated nondeterministic without a source fix, including eventual green reruns. Report ordinary-test, renderer and infrastructure buckets separately. Per-test rates are diagnostics only. |
| Quarantine repair | ≤3 concurrent; ≤7 days each | Existing hard bounds; report age and expiry, plus nightly execution and named owner. |
| Evidence completeness | 100% of failed remote attempts | Exact SHA/toolchain, failing identity, first-attempt report and useful trace/log attachment; unavailable evidence remains an incident. |

Do not extrapolate workflow reliability by assuming independent tests. Shared fixtures, runner
contention and infrastructure failures correlate outcomes; measure workflow false reds directly.

Evaluate three small pilots in order: enforce and verify merge admission; measure a cheaper draft
publication contract while preserving all full PR CI; then evaluate build/evidence reuse and
resource scheduling. Compare agent elapsed time, active repair time, runner-minutes, escaped
regressions and first-attempt reliability together. A faster push that only increases repair loops
has not met the goal.
