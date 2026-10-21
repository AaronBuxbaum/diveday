# Testing and CI audit — 2026-10-21

## Overall assessment

DiveDay has extensive, thoughtfully engineered tests. The main opportunity is to make the assurance
more trustworthy, rather than simply add more tests. The most consequential gaps are outside test
volume: GitHub does not require the checks to pass, some changes bypass specialized jobs, a retry
can erase an unrelated failure, and several reporting mechanisms can overstate what was tested.

The first investment should be enforcing and repairing the existing safety net. Then add a few
missing concurrency and browser-environment proofs, improve production-release evidence, and use
measured cost to simplify the harness. Blanket 100% coverage, blanket retries, a full browser matrix
on every PR, and wholesale fixture rewrites would be poor first moves.

This report contains **24 prioritized findings**, a current-run diagnosis, a test inventory, cleanup
opportunities, and an implementation sequence. Recommendations are proposals, not approved product
or architecture decisions. The initial audit changed no application code, CI configuration,
repository settings, deployments, or existing issues. The implementation follow-up below records
subsequent local harness work separately.

## Scope and evidence limits

- **Snapshot:** `35333db0338259eff8e93d1686e5cc5702c708c6`, detached HEAD, initially clean.
- **Date:** October 21, 2026, America/New_York. GitHub timestamps below are explicitly UTC.
- **Breadth:** all 11 workflow files; setup actions; test discovery/configuration; unit, UI,
  integration and real-Postgres harnesses; representative safety, security and money tests;
  infrastructure and extension tests; E2E, accessibility, visuals, performance, CI selection,
  reporting, release/migration and restore procedures.
- **Depth:** repository-wide inventory and risk-based source review, with three independent
  investigations and cross-checking. This is not a claim that every assertion in nearly half a
  million lines of tests was read individually.
- **Live evidence:** open PRs and all 172 open issues, active rulesets, main protection endpoint,
  recent workflow/job results, and selected failure logs and annotations were read from GitHub.
  There were no open PRs at the time of inspection.
- **Executed locally:** dependency-free guards, inventory/classification, and adversarial probes of
  exported selection/coverage functions. Detailed results appear at the end.
- **Not executed locally:** Vitest, a Next production build, Playwright, real Postgres, Stryker,
  dependency audit, or a full verification gate. This checkout has no installed Vitest binary;
  the first package command attempted dependency bootstrap and failed on registry DNS access.
  Authenticated read-only GitHub calls subsequently worked with network escalation. A full package
  installation was not needed to complete this audit and was not pursued.
- **Not verified:** live Vercel deployment protection/settings, current production SHA or behavior,
  live Neon version/data, AWS policies as deployed, billing, or off-repository restore records.
  Repository configuration and successful GitHub jobs are not proof of deployment.

## Implementation follow-up: local test cost

Subsequent work in the installed desktop checkout improved local selection and startup without
changing the full CI suites. The inventory and findings below remain the original audit snapshot;
this follow-up does not claim that every finding was fixed or the whole suite passed locally.

The local selector reads the changed paths before building expensive dependency graphs. Leaf
test-only changes run edited tests directly; production changes retain native Vitest import/alias
selection and conservative source-reader coverage. Global harness, dependency, schema and migration
changes or unknown inputs widen selection to the full unit suite; so does unavailable source-reader
discovery when dependency selection needs it. Guards still run. Full CI selection remains unchanged.
Quick verification uses the cheap changed-path reader and skips browser-test discovery and its
dependency graphs. Full verification still uses the existing affected-E2E selector; its duplicate
source-tree reads were not optimized in this change.

In the measured selection replay, local selection retained 253 of 1,878 non-guard test files,
including 16 database-backed files as a conservative safety margin. Quick-plan generation fell
from 1,957 ms to 99 ms. These measurements describe that replay and planning cost, not guaranteed
suite duration or a reduction to full CI coverage.

The shared source lexer now scans regular-expression literals explicitly instead of using the
backtracking expression flagged by CodeQL. Pathological slash-heavy and unterminated inputs have
regression coverage; this addresses scanner cost without weakening test discovery.

Database snapshot setup now imports PGlite, Drizzle and the seed graph only when its fingerprint
cache misses. The extracted builder participates in the fingerprint. Frozen-clock setup, the
three snapshot variants and atomic publication remain intact.

The follow-up also reused an existing targeted fixture fix for the readiness recap-photo action
unit tests: their data operations were already mocked, so an opaque mocked database handle avoids
an unrelated real-database bootstrap. This preserves the existing unit-test boundary; it does not
add database-integration assurance.

| Local follow-up evidence | Result and limit |
| --- | --- |
| Direct snapshot-wrapper import | 10,333 ms before; 156 ms after; a repeated import probe took 51 ms. This measures module loading, not total verification time. |
| Template regressions | Seven focused tests passed; cache hits avoid builder/seed imports, and builder changes invalidate the cache and publish all three variants. |
| Real isolated snapshot build and DB test | All three snapshots built and the focused integration passed in 132.30 seconds of process wall time. |
| Cached integration repeat | Passed in 145.19 seconds with unchanged snapshot modification times. Shared-host contention prevents an end-to-end speedup claim. |
| Static validation for snapshot extraction | Targeted Biome and full TypeScript checking passed. These checks do not establish browser, full-suite, CI or deployment success. |
| Reused recap-photo fixture fix | All five tests in `src/app/ready/[token]/recap-photo-actions.test.ts` passed in 9.30 seconds of process wall time. This is a targeted result, not a whole-suite timing claim. |

The integration timings are validation evidence, not a controlled performance comparison. The
original focused DB run reported 28.68 seconds inside Vitest but did not record process wall time;
that number cannot establish a before/after improvement. No timeout was widened for these changes.

## Inventory: what already exists

| Layer | Observed inventory | What it establishes |
| --- | ---: | --- |
| Tracked repository files | 8,190 | Scope, not quality |
| Tracked test/spec files across the tree | 2,037 | Includes non-default harness files |
| Lines in those test/spec files | 498,203 | Approximate maintenance surface; includes comments/fixtures |
| Files selected by the Vitest classifier | 1,892 | Discovery, not passing assertions |
| Vitest `db` / `ui` / `guards` | 563 / 449 / 24 | Isolation and runtime requirements |
| Vitest `lib` / `scripts` / `node` | 395 / 151 / 310 | Remaining selected projects |
| Real-Postgres test files | 28 | Separate engine/locking proof exists |
| E2E specs under `e2e/` | 142 | Broad browser behavior coverage |
| Infra test files | 13 | Includes synthesized-policy assertions |
| Critical journey ledger | 17 | Named required journeys, subject to F08 |
| Derived page-route coverage | 111/111 E2E, 110/111 visual | Source associations, subject to F09 |
| Derived axe coverage | 62/111, about 56% | Source associations, not measured scan completeness |
| Root `check-*` guard scripts | 63, all with sibling tests | Test existence, not semantic adequacy |
| Active quarantines | 0 of maximum 3 | Hygiene guard result at this snapshot |
| Safety-file branch floors | 11 files, 75%–100% | Narrow risk-based coverage enforcement |

The raw file counts differ deliberately: the default Vitest selector does not discover every file
whose name resembles a test, and browser/simulation suites have their own entry points. None of
these counts is a test-case count or a statement that the full suite passed locally.

### Strengths to preserve

1. **Real database behavior is a first-class layer.** PGlite uses migrated snapshots; Postgres
   tests cover actual contention. The engine-divergence suite explicitly records and tests
   differences, including isolation, precision, ordering, DST and engine major versions.
2. **Safety invariants already have meaningful tests.** Admission/readiness combinations are
   enumerated; booking races, offline reload/reconciliation, medical/guardian flows, refunds,
   role/tenant refusals and exports have substantial coverage. Property/invariant testing is not
   wholly missing.
3. **Isolation and determinism receive real engineering attention.** Frozen time, private shops,
   fake providers, per-worker servers and database templates reduce accidental coupling.
4. **CI has a stable aggregate result.** Failures and cancellations propagate through `CI result`;
   the missing protection is requiring that result on GitHub, not inventing another result job.
5. **Cost controls are already sensible.** Build-once browser artifacts, cost-weighted sharding,
   affected visual captures, targeted local checks and documented screenshot tradeoffs exist.
6. **Infrastructure and extension tests are not absent.** CDK tests inspect synthesized trust,
   secret and policy contracts; extension tests exercise the shipped JavaScript and captcha
   refusal behavior. Live agency compatibility remains a separate manual concern.
7. **Failure evidence is unusually rich.** Traces/screenshots, duration reports, renderer probes,
   budget annotations, baseline validation and bounded quarantine provide a strong foundation.
8. **Supply-chain/workflow protections exist.** Third-party Actions are SHA-pinned, jobs have
   timeouts, infrastructure deployment uses an approval boundary and OIDC, and preview resolution
   refuses fork code before exposing deployment credentials. F02 and the existing reg-suit
   credential migration still matter.

## Current CI evidence

### Latest main run is red for an accessibility defect

[CI run 39611645665](https://github.com/AaronBuxbaum/diveday/actions/runs/39611645665) tested the
report's exact SHA. All four unit shards, typecheck, lint, safeguards, build, coverage floors and
visual comparison passed. Real Postgres was skipped by the path predicate. Playwright shard 1/6
failed; the remaining browser shards passed, and `CI result` correctly failed.

The failed test is
[e2e/a11y.spec.ts:284](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/e2e/a11y.spec.ts#L284),
the money/catalog/roster accessibility scan. The captured axe result reports `aria-command-name` on
`.leaflet-shop-marker`, rendered as a focusable `role="button"` without an accessible name, and a
`nested-interactive` violation. The shop marker is constructed in
[src/components/map/SiteMap.tsx:115–125](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/components/map/SiteMap.tsx#L115).
This is concrete failure evidence from CI, not a locally reproduced browser failure and not grounds
to label the run flaky.

The annotation's path is `e2e/a11y-scan.ts`, while the actual spec appears in its title/message.
Passing those real annotations to `rankFailedSpecs` returns `[]`. F06 explains why the nightly
failure selector loses this failure even though the test itself detected it correctly.

[Follow-ups run 39588407545](https://github.com/AaronBuxbaum/diveday/actions/runs/39588407545) also
failed, for malformed Kind/Effort metadata on existing issue #2848. This is tracker hygiene, not an
application regression. Conversely, [E2E nightly
39587064660](https://github.com/AaronBuxbaum/diveday/actions/runs/39587064660) completed 330
repeated tests successfully. The hunt does run useful tests; F06 identifies cases it misses, not a
claim that it never works.

### Recent outcomes and cost

The workflow API sample contained 97 CI runs from October 16 at 20:39 UTC through October 21 at
13:51 UTC. It is a recent bounded sample, not a long-term service-level measurement.

| Trigger | Runs | Success | Failure | Cancelled |
| --- | ---: | ---: | ---: | ---: |
| Pull request | 67 | 28 | 26 | 13 |
| Push | 25 | 15 | 10 | 0 |
| Scheduled Postgres | 5 | 5 | 0 | 0 |

These are run conclusions, not flake rates. A failure may be a correctly detected regression,
configuration issue, infrastructure problem or timing defect. Rerun attempts and cancellation also
make naive run-duration percentiles misleading; job timestamps are more useful here.

For [green main run 39543590407](https://github.com/AaronBuxbaum/diveday/actions/runs/39543590407),
the interval from the first job start to last completion was **14.22 minutes**, with **168.70 summed
active job-minutes**. Unit shards ranged **6.42–10.43 minutes**, functional browser shards
**7.28–11.63**, and visual capture shards **7.05–10.38**. The current red run used 173.65 active
job-minutes and a 15.00-minute job span. These sums exclude queue time and are not billed dollars;
runner hardware, billing multipliers and artifact cost were not inspected.

The practical target is less failed/repeated work and tighter shard balance, not merely more
parallel jobs. Diagnose the failure mix before calling nearly half the PR sample “flaky.”

## Priority map

P1 means a high-leverage assurance gap to address first; P2 means a material improvement after those
gaps; P3 denotes cleanup or measurement work. A priority is not a claim of an exploited security
flaw. S/M/L are relative implementation scopes, not promised dates.

| ID | Finding | Priority | Effort | Evidence type |
| --- | --- | --- | --- | --- |
| F01 | Main does not require passing CI or a PR | P1 | S | Live GitHub settings |
| F02 | Dependency advisory gate still disabled after blocker closed | P1 | S | Source + live issue |
| F03 | Dependency/runner edits bypass real Postgres | P1 | S | Source/control flow |
| F04 | Region/dependency edits bypass infra diff | P1 | S | Source/import closure |
| F05 | One wedge can authorize retry of unrelated failures | P1 | M | Control flow |
| F06 | Flake hunt misses helper failures and treats lookup failure as clean | P1 | M | Real-data and fault probes |
| F07 | Second-factor and delivery claims lack multi-session proof | P1 | M | Coverage inspection |
| F08 | Critical-journey guard accepts disabled declarations | P2 | M | Executed adversarial probe |
| F09 | Route scan credit can describe scans that never happened | P2 | M | Executed adversarial probe |
| F10 | Axe rule selection omits WCAG 2.1 categories | P2 | S | Config + primary docs |
| F11 | Unexpected page exceptions can leave browser tests green | P2 | M | Fixture control flow |
| F12 | Mutation testing remains blocked, not active | P2 | M | Known issue #2622 |
| F13 | High-risk action tests still replace DB contracts | P2 | M | Representative source tests |
| F14 | Shared-worker cleanup can fail with the assertion | P2 | S/M | Classifier + test control flow |
| F15 | Coverage floors do not follow extracted decisions | P2 | M | Coverage/import scope |
| F16 | Full docs-only local verify is weaker than CI | P2 | S | Planner comparison |
| F17 | Testing guide names missing fixtures and wrong pool | P2 | S | Filesystem + config |
| F18 | No mobile/touch engine behavior lane | P2 | M | Project inventory |
| F19 | Performance gate omits route-specific/journey cost | P2 | M | Documented scope |
| F20 | Unit harness has no unexpected-network tripwire | P2 | M | Setup inspection |
| F21 | Scheduled job health/alerts are inconsistent | P2 | S/M | Workflow comparison |
| F22 | Migration rehearsal lacks representative rows/serialization | P2 | M/L | Documented limitation |
| F23 | Restore proof is still absent from repository evidence | P2 | M | Runbook, not live restore audit |
| F24 | Release success lacks deployment-linked behavioral proof | P2 | M | Pipeline inspection |

## Findings and acceptance criteria

### F01 — Main does not require the tests to pass

**Evidence:** the live classic branch-protection endpoint returned `404 Branch not protected`. The
only listed active ruleset, [No push to
main](https://github.com/AaronBuxbaum/diveday/rules/19471629), targets the default branch but
contains only `deletion` and `non_fast_forward` restrictions. There is no required pull-request rule
or required-status-check rule in that returned ruleset. Its name overstates what it enforces.

**Consequence:** the expensive suite is advisory at the repository merge/push boundary. A user or
credential with write access can make an ordinary forward update without waiting for `CI result`.
This is not a claim that an unauthorized person can push, or that a particular past merge bypassed
checks. The red current main run makes the absence operationally relevant.

**Recommendation:** require the stable `CI result` check and a reviewed, explicitly chosen PR policy
on the default branch; verify how stacked PRs retarget before enforcing it. Include the relevant
infrastructure result for changes requiring it, using a result that reports reliably on all PRs.
Keep tightly scoped emergency bypass behavior only if the owner chooses it. Rename the ruleset to
match its actual policy. Changing these settings was outside this report's scope.

**Acceptance:** export the effective rules, show an unprivileged test PR cannot merge with red or
pending required checks, and confirm successful stack retargeting still works. No intentionally bad
commit needs to be pushed to main to prove the rule.

### F02 — The dependency advisory check is still off after its named blocker closed

**Evidence:**
[.github/workflows/ci.yml:115–125](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/ci.yml#L115)
has literal `if: false` on `pnpm audit --audit-level high`. Its comment says to remove that
condition when #2826 lands. [Issue #2826](https://github.com/AaronBuxbaum/diveday/issues/2826) is
closed, at 2026-10-19 13:42 UTC, while this October 21 snapshot retains the off switch. The
workspace already contains targeted overrides and a reviewed `braces` advisory exception.

**Consequence:** no newly introduced high/critical advisory is enforced by this job. Closing a
remediation issue did not restore the protection. This audit did not run a current advisory scan and
does not assert that the dependency tree is vulnerable today.

**Recommendation:** run a fresh audit, verify the closed issue's remediation still holds, and
restore the existing gate. If a new blocker remains, make it a bounded, specific exception with an
owner and review date. Do not silently undo the original suspension without checking its rationale;
the actionable discrepancy is that the condition for restoring it appears satisfied.

**Acceptance:** a current audit completes; explicit reviewed exceptions are the only suppression; a
regression test prevents this named check from remaining unconditionally disabled. Record scan
freshness so “configured” and “last ran successfully” remain distinct.


### F03 — real-Postgres selection ignores dependency and test-runner changes

Evidence:
[.github/workflows/ci.yml:1270–1272](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/ci.yml#L1270)
limits `db_paths` to `src/db`, `drizzle`, `src/test/postgres.ts`,
`scripts/previous-release-migrations.mjs`, and `ci.yml`.
[src/test/postgres.ts:1–7](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/test/postgres.ts#L1)
imports `drizzle-orm`, its node-postgres migrator, `pg`, and Vitest. `ci.yml:1329` runs the
real-server job only when this predicate is true (or nightly), while ordinary unit shards skip these
suites when their Postgres URL is absent
([src/test/postgres.ts:73–88](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/test/postgres.ts#L73)).

Consequence: a PR changing only `pnpm-lock.yaml`/`package.json` can upgrade the actual database
driver or migrator and merge without exercising real PostgreSQL. Likewise a `vitest.config.ts`,
shared setup, or environment change can invalidate the harness without asking its only real-server
job to run. Nightly detection comes after merge.

Recommendation: maintain an explicit tested dependency-input closure for this job, including package
manifest/lockfile/workspace install policy, Vitest config/setup and shared CI setup. Keep path
gating; improve its completeness rather than making every docs edit run Postgres.

Validation: table-driven changed-path cases must select this job for driver/migrator/runner changes
and skip true docs-only edits. Execute a temporary-repository change-classification test, not a
substring test alone.

### F04 — infrastructure diff gate misses configuration that changes stack placement

Evidence:
[.github/workflows/infra.yml:74](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/infra.yml#L74)
watches only `infra`, `cdk.json` and `infra.yml`;
[infra/lib/stack-config.ts:29–40](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/infra/lib/stack-config.ts#L29)
re-exports the stack/region constants from `config/aws-regions.mjs`.

Consequence: a region or stack-name change in the single source of truth can skip the
synth/diff/destructive-change review entirely. CDK dependency upgrades and changes to the invoked
wrapper `scripts/infra-cdk.mjs` also skip it. The normal unit suite may catch some behavior, but it
does not replace the deployed-stack diff promised by this workflow.

Recommendation: include `config/aws-regions.mjs`, dependency inputs, relevant wrapper/shared setup
inputs, and a tested dependency-closure rule for infra. Test a config-only region edit explicitly.

Validation: dry-run classification on config-only and lockfile-only commits; assert synth/diff is
selected. No AWS deployment needed to test the gate.

### F05 — A renderer wedge permits unrelated flaky failures to turn green

Evidence:
[.github/workflows/ci.yml:480-489](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/ci.yml#L480)
and `:744-746`. The script greps the entire shard log for `wedged, not slow`, then reruns **every**
failure with `--last-failed`. A shard with test A wedged and test B failing an ordinary intermittent
assertion will become green if both pass the rerun. This contradicts the adjacent promise that every
non-wedge failure remains red on its first attempt. This is established by control-flow inspection;
no assertion that a historical run exploited it.

Recommendation: classify individual failed test IDs from structured first-attempt evidence. Retry
only the proven wedge IDs, and keep the final result red if any other ID failed initially. Preserve
both first and second attempt reports. Regression test the mixed A-wedge/B-ordinary-failure case as
well as pure wedge, pure app failure and absent/malformed evidence.

### F06 — Nightly flake hunting reports unavailable history as a clean history

Evidence:
[scripts/e2e-recent-failures.mjs:60-82](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/scripts/e2e-recent-failures.mjs#L60);
[.github/workflows/e2e-nightly.yml:53-56](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/e2e-nightly.yml#L53).
Any `gh` error is caught, printed to stderr, and exits successfully with no paths. The workflow
treats no paths as “No spec failed on CI in the last 7 days,” so broken credentials/API/rate
limiting can stop the hunt while its alert closes as success. Even changing the Node exit code alone
is insufficient: `mapfile < <(node ...)` does not propagate the producer's exit status.

Reproduced safely using a temporary `gh` shim that exits 1: script exited 0 and produced zero stdout
bytes. Logs are `/tmp/diveday-history-stdout.txt` and `/tmp/diveday-history-stderr.txt`.

Recommendation: return structured status and fail explicitly on history retrieval failure; first
execute the producer into a temporary file under a checked command, then mapfile the successful
result. Test empty successful history separately from authentication errors and partial-page errors.
Also paginate runs/jobs/annotations (`per_page=100` is currently a fixed truncation), include
relevant visual shard failures or explicitly document their omission, and record inspected run
count/window in the summary. Do **not** claim Actions job IDs are necessarily different from
check-run IDs; primary GitHub docs give examples where they match.

**Additional verified blind spot:** the current main failure's annotation path is
`e2e/a11y-scan.ts`; `rankFailedSpecs` accepts only paths ending in `.spec.ts`. Feeding the actual
annotations from job 119263262792 into the function returned an empty list. Prefer the structured
Playwright report/test identity over stack-frame annotation paths. Include helper-thrown errors in
the acceptance cases. The Actions job and check-run IDs matched in this sample; an alleged ID
mismatch was investigated and rejected as a finding.

### F07 — Real concurrency proof is still missing for security and delivery CAS paths (high-value coverage gap)

Evidence: `src/db/account-security.test.ts:21-24,59-80` describes a race and uses Promise.all on one
freshly hydrated PGlite. Fresh avoids nested-savepoint confusion but does not create independent
server connections. `src/db/account-security.ts:109-135,148-174` consumes TOTP/recovery codes with
conditional updates. No real-Postgres suite calls `verifyAccountSecondFactor`. This is a verified
gap in the concurrency proof, not proof that its atomic SQL is wrong.

Similarly
[src/db/integration-events.ts:566-595](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/db/integration-events.ts#L566)
explicitly claims two cron workers can select one delivery but only one wins, and
[src/db/notifications.ts:797-827](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/db/notifications.ts#L797)
conditionally claims queued notifications. Searches of all `*.postgres.test.ts` found neither
`claimIntegrationDelivery` nor `drainNotificationRetries`; their ordinary tests cannot exercise
distinct competing database sessions.

Recommendation: add targeted real-Postgres tests for two/five uses of one recovery code,
simultaneous same-step TOTP sign-ins, two workers claiming one integration delivery, and two queue
drains competing for one notification. Also test different recovery codes concurrently so successful
consumption of one cannot restore another. Reuse holdRowLock/waitForLockWaiters and keep the fake
provider suspended until losers resolve. Assert one accepted sign-in/provider call, exact final
counters, and no lost updates. Run deliberate guard deletion to prove each test fails on the defect
it is meant to catch. Keep existing sequential PGlite tests.

### F08 — Critical-journey guard accepts commented-out and suite-skipped tests

Evidence:
[scripts/check-critical-journeys.mjs:49-58](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/scripts/check-critical-journeys.mjs#L49);
corresponding tests only cover direct `test.skip`. `findTest` regex sees source text without parsing
comments or parent `describe.skip`; callback `test.skip(...)` or quarantined critical journeys are
also not semantically evaluated.

Reproduced: `findTest("// test('critical', async()=>{});", 'critical')` returns `test`;
`findTest("test.describe.skip('disabled',()=>{test('critical',async()=>{})})", 'critical')` also
returns `test`. This defeats the documented floor while the guard stays green. No currently disabled
critical journey was found; this is a verified guard weakness, not a current missing journey claim.

Recommendation: use a syntax-aware declaration check or a Playwright discovery reporter and
cross-check actual outcomes for required journey IDs. Add comments, skipped parent suites, callback
skips, quarantine and expected-failure annotations to guard tests. Keep existing baseline ledger,
avoiding a new manually duplicated list.

### F09 — Route/accessibility coverage credits can describe scans that never happened

Evidence:
[scripts/check-route-coverage.mjs:304-317](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/scripts/check-route-coverage.mjs#L304).
`A11Y_SCAN.test(source)` is computed once for the entire spec, then every path literal anywhere in
that spec is credited with a scan. This credits setup routes and routes in tests that contain no
scan. Ordinary E2E coverage likewise accepts a literal regardless of whether it is navigated or
asserted.

Reproduced by calling the exported function with two tests: test A navigates `/a` and scans; test B
navigates `/b` without scanning. Both `/a` and `/b` receive `a11y: ['demo.spec.ts']`. Thus 62/111 is
an upper bound of source associations, not demonstrated scanning completeness.

Recommendation: at minimum associate scans with their test block and last resolved navigation;
preferably capture visited route + scan/capture records from the runtime helper and publish that
ledger alongside source coverage. Treat source inference as candidate coverage, retain written
click-reached exceptions, and add adversarial tests for setup navigation, comments, unrelated
literals and multiple pages in one test. Runtime coverage can remain periodic rather than adding all
scans to every PR.

### F10 — Accessibility tag selection omits WCAG 2.1 rules

Evidence:
[e2e/a11y-scan.ts:220](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/e2e/a11y-scan.ts#L220)
selects only `wcag2a`, `wcag2aa`, `wcag22aa`. Axe tags identify a rule's own WCAG version; the 2.2
tag does not imply inclusion of the 2.1 categories. `wcag21a` and `wcag21aa` are absent, so, for
example, the `autocomplete-valid` rule (tagged wcag21aa) is not selected.

Primary verification: [Deque API tag
documentation](https://www.deque.com/axe/core-documentation/api-documentation/) and [axe rule
descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md). This is
a configuration omission, not a claim that any current form violates the excluded rules.

Recommendation: include both 2.1 tags; test the helper's selected rule inventory against a small
deliberately invalid autocomplete fixture and a valid control. Keep the explained document-title
handling separate. Rename the stated scan coverage precisely and retain a manual
keyboard/screen-reader checklist because automated scans cannot establish full conformance.

### F11 — Unhandled application exceptions can pass green browser tests

Evidence: `e2e/fixtures.ts:391-403,455-476` collects console errors and page exceptions, but only
hydration-pattern matches trigger a failure after an otherwise passing test. Other uncaught
exceptions are diagnostic output only when something else fails. A flow can satisfy its visible
assertion while background client code throws.

Recommendation: fail on unexpected `pageerror` across fixture-owned pages, with narrow explicit
allowances for intentionally exercised errors. Introduce console-error gating separately to avoid
converting blocked third-party network noise into failures. Add a harness test injecting an ordinary
`Error` (parallel to the existing hydration-error harness test), and confirm intentional
provider/refusal tests remain valid. This is a detection gap, not proof of current user-visible
runtime exceptions.

### F12 — Mutation testing exists as configuration, but currently supplies no scheduled assurance

Evidence:
[stryker.config.mjs:10-18](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/stryker.config.mjs#L10)
records a trial where all in-function mutants survived because the runtime switch did not reach the
module; manually activating a survivor failed 16 tests.
[.github/workflows/mutation.yml:15-20](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/mutation.yml#L15)
has only workflow_dispatch, with schedule intentionally disabled. Its matrix is readiness and
trip-admission only; `stryker.vitest.config.ts` limits tests to the pure lib project.

Recommendation: treat this as a blocked capability with an explicit compatibility canary. Before any
score or survivor issue is trusted, activate a known in-function mutant and require its test to
fail, while the baseline passes. Keep the schedule disabled until that canary succeeds; then restore
the two-module pilot and widen only after reports are actionable. Do not interpret the recorded 7.5%
score as weak assertions. Do not blindly enable the schedule as the fix.

Already tracked in [#2622](https://github.com/AaronBuxbaum/diveday/issues/2622); reuse that issue.

### F13 — The documented migration away from mocked database contracts remains materially incomplete

Evidence:
[docs/engineering/testing.md:29-34](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/engineering/testing.md#L29)
explicitly says database mocks pin call shapes and migrate when touched.
`src/app/ready/[token]/booking-actions.cancel.test.ts:15-18,52-62,78-105` replaces cancellations,
refunds, trail writes and mail, constructs `db: {} as never`, and asserts calls.
[src/app/api/medical-clearances/[recordId]/route.test.ts:17-21](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/app/api/medical-clearances/%5BrecordId%5D/route.test.ts#L17)
mocks the database authorization/read/activity operations. Numerous capability, waiver, payment and
route tests have the same shape. Mocking `getDb` to return a real test db is not this defect and
should not be counted with fake domain functions.

Consequence: the action test can be green while the real database return shape, tenant scope or
persisted outcomes diverge. This does not mean the underlying DB function lacks tests; it means its
composition is unproven at this layer.

Recommendation: prioritize money/capability action contracts, using real PGlite and fake external
providers while mocking only framework/session boundaries. Assert persisted
cancellation/refund/event outcomes, tenant refusal and expired-token behavior. Retain narrow
provider-error unit tests where useful. Inventory and ratchet non-client domain DB mocks rather than
demanding a mass rewrite. Validation should break when a real DB result changes or a tenant boundary
is removed, not only when helper arguments change.

### F14 — Shared lib workers depend on happy-path cleanup; failing spies can contaminate later tests

Evidence: `src/test/projects.ts:65-67,108-116` excludes module mocking and stubEnv/stubGlobal from
shared lib workers, but not spyOn or useFakeTimers. Executing classifyTestFile with either call
returns lib. `vitest.config.ts` sets lib `isolate:false`;
[src/test/setup.ts:1-47](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/test/setup.ts#L1)
installs no global afterEach restoration.
[src/lib/payments/connect.test.ts:67-75](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/lib/payments/connect.test.ts#L67)
restores console.warn only after awaited calls and assertions; an assertion failure skips
restoration. Similar explicit end-of-body restore appears in provider tests.

Consequence: when the first failure happens, later tests in the same worker may run with a prior
console/global spy, producing secondary failures or suppressing diagnostics. This is a structural
failure-path cleanup weakness; I did not reproduce a current order-dependent green-suite failure.

Recommendation: use lifecycle-guaranteed mock restoration for shared projects, or register local
onTestFinished/afterEach before exercising the spy. Extend the classifier/guard to timer/global
mutation cases where cleanup cannot be guaranteed. Add a harness regression with a deliberately
failing first test and a second test observing restored behavior. Add periodic reproducible shuffled
runs of the cheap lib/guards projects; no workflow currently invokes sequence.shuffle, although the
config comments cite manual shuffled validation.

### F15 — Safety coverage floor ownership is narrower than the safety logic graph

Evidence:
[vitest.config.ts:41-54](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/vitest.config.ts#L41)
and
[scripts/coverage-floors.mjs:29-41](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/scripts/coverage-floors.mjs#L29)
measure eleven explicit files; floors range from 75% promo-caps to 100% authz/trips.
[src/db/bookings.ts:1-110](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/db/bookings.ts#L1)
imports policy/consequence logic from booking-gates, boat-safety, course-ratios, participant-types,
seat-locks, certification-evidence and other modules. `src/db/seat-claims.ts` and
`src/db/seat-diver.ts` are substantial safety-relevant modules outside this allowlist.

Consequence: moving a covered decision into an excluded helper can retain a green floor while
reducing visibility into that decision. This is a scope/maintenance gap, not a claim those helpers
have no tests.

Recommendation: maintain risk-owned module groups for boarding, capability/identity and money, with
an explicit extraction rule: when a monitored module delegates a decision, review whether its new
owner joins coverage/mutation monitoring. Begin with report-only branch summaries for these adjacent
modules; select meaningful floors after examining uncovered branches. Do not impose whole-tree
targets or inflate tests solely for percentages. Existing parity test between config and floor list
should remain, but cannot decide whether the list is complete.

### F16 — docs-only local pre-push gate is weaker than docs-only CI

Evidence:
[scripts/verify-push.mjs:203–205](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/scripts/verify-push.mjs#L203)
returns after static steps on docs-only diffs; static steps (`:153–170`) include the guards project
but no non-guard tests. CI explicitly selects and runs non-guard tests quoting docs/Markdown
(`ci.yml:301–340`), including DB-backed and infrastructure tests.

Consequence: full `verify:push` can approve a docs-only commit without running the
document-dependent non-guard tests that CI will ask it to pass. This differs from the quick mode's
deliberate broader omissions. Document truth can break a behavioral test and only be discovered
after push.

Recommendation: extract the CI document-test selector and invoke it from both CI and full local
verify; print the omission explicitly if quick mode continues to skip it. Prefer an explicit
dependency manifest for dynamic readers if textual selection proves incomplete.

Validation: a docs-only fixture invalidating a known non-guard document consumer fails both full
local verification and CI, without invoking browser builds.

### F17 — Test documentation promises fixtures that do not exist and describes the wrong worker pool

Evidence:
[docs/engineering/testing.md:39-41](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/engineering/testing.md#L39)
directs authors to `src/test/factories.ts` and named
`secondShop/aDiver/aTrip/aBooking/staffWithRole` helpers; that file is absent from the checkout.
[docs/engineering/testing.md:596-601](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/engineering/testing.md#L596)
says the config uses threads, while actual
[vitest.config.ts:122](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/vitest.config.ts#L122)
uses forks and explains why threads crashed V8/PGlite.
`src/db/engine-divergence.postgres.test.ts:9-12,47` also carries old suite counts.

Recommendation: either implement the documented typed row factories, starting with tenant/role
fixtures that simplify refusal tests, or correct the documentation to the real API immediately.
Remove contradictory historical pool advice and date historical performance measurements. Add
existence checks for documented fixture entry points. This is a concrete contributor-efficiency
issue: following the testing guide currently sends an agent to a nonexistent helper and an unsafe
pool choice.

### F18 — No touch/mobile-engine behavioral lane

Evidence:
[playwright.config.ts:248-266](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/playwright.config.ts#L248)
has only a Desktop Chrome project. Searches of `e2e`, workflow files and the day simulation find no
`isMobile`, `hasTouch`, `touchscreen`, WebKit or Firefox project. Phone captures and target geometry
change viewport only; they do not exercise touch events, mobile input behavior or Safari/WebKit
storage/service-worker behavior. The simulation also uses Desktop Chrome
([scripts/simulate-day/playwright.config.ts:49-57](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/scripts/simulate-day/playwright.config.ts#L49)).

Recommendation: preserve Chromium-only screenshot determinism, but add a small behavioral nightly
lane for mobile WebKit and touch Chromium covering public booking, waiver signature/guardian form,
navigation/drawer, and offline manifest save/reload/reconcile. Add Firefox only if supported-user
evidence justifies it. Start with high-risk journeys rather than duplicating every test across all
engines; remove Chromium-only launch flags from that separate lane. Treat real iOS verification as a
separate release/manual check, not a claim satisfied by desktop WebKit alone.

### F19 — Performance gate measures shared bytes, not journey performance

Evidence: `scripts/perf-budget.mjs:9-11,39-40,68-79` deliberately budgets the intersection of
first-load chunks across routes. Route-specific growth can pass; server latency, hydration cost,
interaction responsiveness, image/layout regressions and slow/offline transition behavior are not
measured by that byte ceiling. Source search found no automated LCP/CLS/INP or controlled
network/CPU performance test in the browser fleet. Existing web-vital instrumentation and ordinary
test timeouts are different evidence.

Recommendation: retain the useful 170 KB common-floor gate and add per-critical-route transfer/JS
budgets first. Collect a scheduled controlled cold/warm booking, schedule and manifest trace with
documented runner/network conditions; baseline variance before making timings blocking. Use robust
repeated measurements and a small journey set, not fragile wall-clock assertions in every functional
test. This intentionally expands documented scope and needs prioritization, not an emergency fix.

### F20 — The ordinary unit harness has no explicit unexpected-network tripwire (hardening opportunity)

Evidence: `src/test/setup.ts` does environment adaptation and timeouts only; `vitest.config.ts`
blanks DB and Sentry settings and directs PGlite to memory, but does not block outbound HTTP
globally. Provider tests inject fake fetch/SDK clients, e.g.
`src/lib/payments/checkout.test.ts:11-12,38-65`; this protects the tested call sites but not an
accidentally uninjected new call.

Recommendation: add a test-harness network-deny mechanism with explicit local/mock exceptions and a
regression proving accidental external fetch fails with a useful message. Design it around both
fetch and SDK transports; preserve the dedicated Postgres job's connection allowance. This is not
evidence that any current test sends production requests. Existing defensive blank configuration
should stay.

### F21 — scheduled pipeline health is uneven

Evidence: the nightly branch of `ci.yml` runs only `real-postgres` (`ci.yml:1323–1405`); `CI result`
explicitly excludes schedule (`:1414`), and this workflow has no `workflow-alert.mjs` call. In
contrast, `e2e-nightly.yml`, `simulate-day.yml`, `durations-refresh.yml` and `mutation.yml` use
open/update/close red-run issues. `persona-bots.yml:16–21` explicitly describes returning success
for failures inside the walk; its upload accepts absent artifacts as a warning.

Consequence: a failed nightly migration proof has a red GitHub run but no matching issue-based
notification path; a persona walk that never completes may stay green. Infrastructure/setup failure
and a clean product sweep can be indistinguishable to the user's normal tracker workflow.

Recommendation: unify scheduled-run health reporting around completed/partial/not-run/failed plus
last successful run time. Keep product findings advisory and off PR gates; make a broken monitoring
job observable. Do not silently change the intentional non-gating persona policy—separate job-health
notifications from finding severity.

Validation: simulate failed setup, failed scan, empty findings and completed findings. Only a
genuinely completed run updates the healthy timestamp/closes an operational alert.

### F22 — migration rehearsal lacks representative data and production deploy serialization

Evidence:
[src/db/migrations.postgres.test.ts:125–145](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/src/db/migrations.postgres.test.ts#L125)
applies previous schema, then current schema, and compares fingerprints without seeding
representative previous-release rows.
[scripts/vercel-build.mjs:14–43](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/scripts/vercel-build.mjs#L14)
runs migration then build without an advisory lock around migration. The deploy runbook explicitly
documents empty-data rehearsal, no drift detection, concurrent production deploy risk and the human
one-at-a-time policy.

Consequence: CI proves SQL/schema compatibility, not that new constraints fit existing rows, that
backfills remain bounded, or that two simultaneous release builds serialize migrations. A later
build failure can leave the schema ahead of live code by design.

Recommendation: before real pilot data, add representative previous-release migration fixtures for
changed tables, including boundary/null/deleted records; rehearse lock and constraint failures in
disposable Postgres. Add production migration serialization and a drift check when adopting this
operational hardening. Do not claim the absence is newly discovered or ignore the documented
pre-pilot acceptance.

Validation: a deliberately invalid existing row makes the rehearsal fail; two concurrent migrators
are serialized; a build failure after migration leaves the previous app's read/write contract valid.
Verify the actual Neon engine major before deciding version parity work—repository comments say it
was not measured.

### F23 — Restore capability has no recorded end-to-end proof

**Evidence:**
[docs/engineering/backup-and-restore-runbook.md:463–517](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/engineering/backup-and-restore-runbook.md#L463)
requires a quarterly restore and still records `_never_` in its restore-test log. It explicitly says
neither the scheduled shop export nor the full dump has been restored. Backup freshness/size alarms
and export unit tests exist; they do not prove the archive can recover a usable shop and account
sign-in.

**Consequence:** schema/export correctness is well tested locally, but recovery-time and actual
restorability are unproven in repository evidence. An off-repository rehearsal may exist; this audit
did not inspect production backup objects or run a restore and cannot rule one out.

**Recommendation:** run the existing isolated restore procedure before relying on it for pilot
operations. Record artifact identity, restore duration, row/waiver integrity checks, actual staff
sign-in and cleanup. Automate safe synthetic restore rehearsal where practical; keep access to real
personal/medical backups tightly scoped. Link evidence to the existing human gate rather than
inventing another checklist or promising an unmeasured recovery objective.

**Acceptance:** a dated, reproducible successful restore record, with failure diagnostics and a
named next rehearsal date. A successful backup upload is not the acceptance criterion.

### F24 — A successful release is not linked to behavioral deployment evidence

**Evidence:**
[vercel.json:3–9](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/vercel.json#L3)
enables main deployments and calls `scripts/vercel-build.mjs`. That script checks production
environment/migration safety, migrates, and builds; it does not wait for the GitHub `CI result`. The
inspected workflows have no deployment-status-triggered browser smoke test. Local CI uses its own
built server and blanked provider configuration, while previews are deliberately on-demand. Actual
Vercel protection settings were not read.

**Consequence:** source/build success and production behavior remain separate facts. F01 means the
repository itself currently does not enforce the intended pre-merge dependency on CI. Even after F01
is fixed, CI does not prove the deployed configuration, domain/cookie handling, real schema
connection and provider wiring match the tested build.

**Recommendation:** first require CI before merge. Then define a small deployment-linked,
non-destructive smoke check tied to the exact deployed SHA: public health/render, safe auth/session
boundary and a synthetic tenant read. Keep writes and provider sandbox behavior explicitly isolated.
Record deployment URL/SHA and completion outcome; alert on a failed or missing check. Verify current
Vercel project protection before choosing whether to gate promotion or merely alert. This audit
makes no claim that the red main snapshot reached production.

**Acceptance:** a deliberately broken preview configuration fails the smoke check, the exact build
identity is recorded, and a passing unrelated commit cannot satisfy the release proof. Document
rollback behavior; do not add an unreviewed auto-rollback touching production data.

## Cleanup and cost improvements

### Replace source-spelling assurances with small executable contracts

The existing scripts already export useful pure functions. Use them to centralize change selection,
job result aggregation, failure classification and runtime coverage recording. Leave a small
workflow-wiring check, then test behavior with path and result fixtures.

A concrete mutation probe replaced every recognized DB input in the CI path list with nonexistent
paths. `findCiChangeDetectionViolations` returned `[]` for both the real and broken workflow. The
guard currently pins git-range spelling, not whether the specialized job runs for relevant changes.
F03 and F04 are examples of the resulting gap. Add cases for changed dependencies/config,
renames/deletions, unknown diff bases, skipped producers, failed/cancelled dependencies and every
supported workflow trigger. Workflow syntax validation would complement these tests, not replace
them.

Do not build a generic policy framework merely to avoid a few lines of YAML. Extract only the
contracts that need executable tests or currently drift between local and CI entry points.

### Split large suites only after discovery and identity are safe

`e2e/visual.spec.ts` is 10,161 lines; `e2e/helpers.ts` 1,194; `e2e/a11y.spec.ts` 1,126;
`e2e/fixtures.ts` 836. Main CI is 1,441 lines. These are review/conflict surfaces worth reducing.

First make visual discovery accept domain-grouped capture specs: current coverage and selection code
special-cases `visual.spec.ts`. Then extract cohesive capture/harness primitives and split by
surface or domain, preserving image names, test identity, shard selection and artifact filenames.
Otherwise a tidy-looking split can silently lose route credit, change baselines or run visual tests
in functional shards. A file split alone does not make the suite faster.

Move historical explanations from executable configuration into linked ADRs/runbooks where that
reduces contradictory instructions. Preserve the reasons for intentional choices such as forks,
typechecking during build, no routine retries, and reduced screenshot combinations.

### Measure the reset and shard costs before adding workers

Reuse [#2729](https://github.com/AaronBuxbaum/diveday/issues/2729), which already targets the
per-test reset cost, and [#2804](https://github.com/AaronBuxbaum/diveday/issues/2804), which already
targets the guardian co-signature test's budget. Neither is a reason to widen generic timeouts.

Collect weekly job setup/install/build/test/upload time, queue delay, test p50/p95 duration,
slowest-shard imbalance, active runner-minutes and repeated-run cost. Use first-attempt outcomes
when reporting reliability. Distinguish product assertions, timeouts, browser wedges, setup failures
and cancelled superseded runs. The current green sample's 6.42–10.43-minute unit range suggests
checking duration freshness and fixture cost before buying more shards; it is not sufficient alone
to conclude the scheduler is wrong.

The tracker-only scheduled workflow installs the full dependency tree before running Node scripts.
Check their complete import closure; if it is standard-library-only, install-free execution is a
small improvement. Retain Node-version control. Preserve the shared browser build and existing main
visual-baseline publishing behavior when reducing work.

### Reduce fixture and source-reader duplication incrementally

There are already open ideas about named test facts and reset design:
[#2759](https://github.com/AaronBuxbaum/diveday/issues/2759),
[#2760](https://github.com/AaronBuxbaum/diveday/issues/2760),
[#2761](https://github.com/AaronBuxbaum/diveday/issues/2761), and
[#2762](https://github.com/AaronBuxbaum/diveday/issues/2762). Existing ideas also cover shared
walkers/ratchets ([#2775](https://github.com/AaronBuxbaum/diveday/issues/2775)) and route registries
([#2738](https://github.com/AaronBuxbaum/diveday/issues/2738)). Treat these as candidates to
evaluate, not approved rewrites or evidence that one giant registry is the answer.

Start with typed factories that actually exist and make tenant/role/refusal cases readable, a single
tested docs-test selector, and shared fixture primitives used by multiple suites. Measure fixture
construction time and failure readability. Preserve private-shop ownership and rollback boundaries.
New abstraction is worthwhile when it removes a demonstrated mismatch, not merely because two tests
look similar.

### Make intentional test-environment differences visible

The browser fixture substitutes an empty stylesheet for remote branded Google Fonts
([e2e/fixtures.ts:708–711](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/e2e/fixtures.ts#L708)).
Screenshots therefore validate fallback-font layout where those fonts would otherwise load. Consider
deterministic local font fixtures or a separate approved typography capture. Do not reintroduce
nondeterministic third-party font requests across every screenshot.

The same fixture deliberately overrides `navigator.onLine` and delivers synthetic online/offline
events
([e2e/fixtures.ts:606–653](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/e2e/fixtures.ts#L606)).
Preserve these useful deterministic reconciliation tests, while adding a small unpatched lifecycle
check in the mobile lane. Likewise, the documented omission of phone-width dark captures is an
accepted cost tradeoff, not an accidental missing matrix to restore without evidence.

## Further investigations worth scoping

These are opportunities, not established defects:

| Area | Existing proof | Additional question and first useful experiment |
| --- | --- | --- |
| Large-data behavior | Query-count, pagination and DB tests | Seed realistic Postgres cardinalities and inspect search/roster/export query plans, memory and payload size; do not treat PGlite timing as production timing |
| Provider contracts | Fake fetch/SDK adapter tests | Maintain representative provider payload fixtures tied to API versions; run isolated sandbox smoke checks only where useful and affordable |
| Test discovery | Classifier and direct-source rules | Add cases for transitive fixtures, global mutation and new file extensions; compare selected inventory to declared suite intent |
| Extension compatibility | Actual JS parsing/fill/captcha tests | Rehearse published agency pages and permitted human-account paths using the existing extension pilot runbook |
| Visual/security publishing | SHA-pinned actions, reviewed OIDC infra | Finish existing reg-suit OIDC work [#2692](https://github.com/AaronBuxbaum/diveday/issues/2692), then verify deployed trust and secret removal |
| Human acceptance | Persona probes, simulation, manual gate register | Preserve real shop/screen-reader/crew walkthroughs; deterministic bots cannot approve safety policy or establish operational usability |

## Recommended implementation sequence

### 1. Make existing results enforceable and honest

Address F01–F06 first: effective branch protection, advisory scan restoration, complete specialized
job selection, per-test wedge retry classification, and reliable failure-history input. Add semantic
regression tests while doing so. Resolve the current accessibility defect with its focused browser
proof; repair #2848's tracker metadata separately. Do not hide either failure by changing
thresholds.

**Completion evidence:** required checks visible in GitHub's effective rules, audit step actually
executed, config/lockfile-only fixtures select the right jobs, mixed wedge/application failure stays
red, and helper-origin failures remain discoverable.

### 2. Strengthen risk-specific proof

Add F07's contention cases, fix critical-journey and accessibility-report semantics, include all
intended axe categories, and gate unexpected page exceptions. Migrate a small set of high-risk
mocked action tests. Repair shared-worker cleanup and inaccurate documentation. Unblock mutation
only when its compatibility canary is trustworthy.

**Completion evidence:** deliberate removal of each race/refusal guard makes its focused test fail;
actual executed journey/scan records match the claimed ledger; in-function mutants are demonstrably
activated. No whole-tree coverage target is needed.

### 3. Close environment and release gaps

Pilot a small mobile/touch behavior lane; collect performance baselines before blocking on timings;
add unexpected-network detection carefully. Extend migration fixtures, serialize migration execution
if adopting that operational hardening, rehearse restore, and record deployment-linked smoke
results.

**Completion evidence:** named real-environment differences are tested or explicitly accepted, a
restore record exists, and release checks identify the exact deployment they exercised.

### 4. Pay down maintenance cost using the measurements

Reduce reset overhead, refresh shard costs and split giant suites with identity-preserving discovery
tests. Consolidate duplicated selectors before introducing new static checks. Keep the job-minute
and first-attempt reliability baseline so a faster pipeline is not mistaken for a stronger one.

## Tracking and ownership

Existing open work was checked rather than duplicated: mutation #2622, reg-suit OIDC #2692, reset
overhead #2729 and guardian budget #2804. The advisory remediation issue #2826 is closed but the
gate restoration is incomplete at this snapshot. The fixture/registry ideas above remain ideas.

**No new issues were filed.** The live tracker already had **40 `needs-triage` issues**, the maximum
stated by
[docs/agents/issue-tracker.md:315–317](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/agents/issue-tracker.md#L315).
Adding the audit's findings would exceed that ceiling. This report is the requested review hand-off,
with numbered findings and acceptance criteria; it is not a replacement task registry or a claim
that the findings have been assigned. Promote the highest-priority findings into individual issues
after triage makes room, and link the accepted ones back here. No quota override or automatic
approval-policy change was made.

## Verification log

| Check | Result |
| --- | --- |
| Git snapshot / initial status | Exact SHA recorded; no initial tracked changes |
| GitHub open PRs/issues | 0 open PRs; all 172 open issues read, across two non-empty pages |
| Branch settings | Classic main protection 404; one active ruleset, deletion/non-fast-forward only |
| `node scripts/gate-freshness.mjs` | Local gate register read: 150 rows, 77 open, 3 deferred, 70 closed; not proof human actions occurred |
| `node scripts/agent-health.mjs` | Completed inventory and route/guard summary |
| `node scripts/check-ci-change-detection.mjs` | Passed current syntax checks; semantic counterexample also accepted |
| `node scripts/check-critical-journeys.mjs` | Passed 17 current ledger entries; disabled-declaration counterexamples accepted |
| `node scripts/check-route-coverage.mjs` | Passed 111 routes, 110 captures, 1 exemption; unrelated scan-credit counterexample confirmed |
| `node scripts/check-action-pins.mjs` | Passed 13 workflow/action YAML files |
| `node scripts/check-e2e-hygiene.mjs` | Passed; no quarantine, 186 banked long literals |
| `node scripts/check-e2e-fixtures.mjs` | Passed; 142 specs, 27 guarded test-route files, 29 registered handlers |
| Documentation link check | Passed 713 existing files initially, then all 714 including this report |
| Test-project classifier | Executed with Node; 1,892 selected files |
| Flake-history fault injection | A temporary failing `gh` shim yielded exit 0 and empty selection |
| Latest real failure annotations | Selector returned `[]` despite failed `a11y.spec.ts` |
| Full application/runtime gates | Not run locally; dependency bootstrap failed, and suites need installed dependencies/runtime resources |

### Compact adversarial probe results

These probes import the repository's exported pure functions and do not modify source files:

```json
{
  "commentedJourney": "test",
  "skippedSuiteJourney": "test",
  "scanCredit": [
    {
      "route": "/a",
      "a11y": [
        "demo.spec.ts"
      ]
    },
    {
      "route": "/b",
      "a11y": [
        "demo.spec.ts"
      ]
    }
  ],
  "ciMutationApplied": true,
  "originalCiViolations": [],
  "brokenCiViolations": [],
  "actualFailedSpecSelection": [],
  "docsOnlyFullPlan": [
    "regen",
    "lint",
    "typecheck",
    "check:repo",
    "guards"
  ]
}
```

The scan-credit fixture contains two independent tests: `/a` navigates and calls
`expectNoA11yViolations`; `/b` only navigates. Both receive scan credit. The CI mutation replaces
recognized DB input paths with nonexistent ones; the boolean confirms the replacement actually
occurred. These are reproduced guard limitations, not a claim that current critical journeys are
commented out or skipped.

## Source navigation

Source references below and throughout the report are pinned to the audited commit. This keeps the
evidence reviewable as the working tree evolves.

- [Main workflow](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/ci.yml)
- [Infrastructure workflow](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/.github/workflows/infra.yml)
- [Testing strategy](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/engineering/testing.md)
- [Vitest configuration](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/vitest.config.ts)
- [Playwright configuration](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/playwright.config.ts)
- [Deployment and migration runbook](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/engineering/deploy-and-migrations-runbook.md)
- [Backup and restore runbook](https://github.com/AaronBuxbaum/diveday/blob/35333db0338259eff8e93d1686e5cc5702c708c6/docs/engineering/backup-and-restore-runbook.md)
