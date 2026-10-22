# Test selection and faster assurance — research, 2026-10-21

## Recommendation and decision boundary

Keep the full CI verdict while making affected tests run first, then collect enough evidence to
decide whether exclusion is justified. Evaluate Vitest's existing runtime dependency recording in
shadow mode before building a custom module recorder. Keep a separate model for filesystem,
subprocess and browser-to-server dependencies. A test's absence from a previous run's observations
is not proof that a change cannot affect it.

This is research and a proposed architecture, not an implemented selector or a benchmark. Sources
were read in the desktop checkout at HEAD `749028e685a5a7e2f7b481b28f6f8ab1262365e0`, including
ongoing local harness changes. Installed packages report Vitest 5.0.5 and Playwright 1.64.1. No test
suite, browser, server, benchmark or CI job was started for this research.

The accepted [every-layer CI ADR](../../architecture/decisions/20261003-every-stack-layer-runs-ci.md)
requires the whole gate on every stack layer; see its decision at lines 19–28. Prioritizing tests,
sharing correctly keyed build artifacts and observing proposed selections can fit that policy.
Replacing full per-layer runs with affected-only, sampled or scheduled runs needs an explicit
replacement decision. A nightly full run does not establish that an intervening merge was tested.

## What the current code already provides

| Mechanism | Evidence | Consequence for the proposal |
| --- | --- | --- |
| Cheap diff before graph construction | `scripts/e2e-affected.mjs:618–646`, `scripts/verify-push.mjs` quick branch | Preserve this split. Avoid building browser graphs for a unit-only local plan. |
| Native unit dependencies plus conservative filesystem-reader seeds | `scripts/test-affected.mjs:15–42`, `:108–115` | Vite owns aliases/imports. The reader augmentation is intentionally broad, not a precise read-set map. |
| Full fallback for global inputs, unknown paths and deletions | `scripts/test-affected.mjs:77–81` | Keep until a replacement can explain old importers, generated inputs and discovery changes. |
| Direct changed leaf tests | `scripts/test-affected.mjs:46–57`, `:82–105` | Avoid native discovery cost when the test is known to be a leaf; uncertainty keeps dependency selection. |
| Browser imports, route/copy heuristics and smoke additions | `scripts/e2e-affected.mjs:305–365`, `:385–465`, `:647–681` | Useful positive evidence; not a complete model of a deployed Next application. |
| Symbol-level propagation | `scripts/symbol-reach.mjs:260` onward | Useful for ranking. Exclusion also requires handling initialization effects, resolution changes and the base graph. |
| Bounded lexer for source guards | `scripts/e2e-source.mjs:4–81` | Efficient lexical scans are useful, but this reader does not establish JavaScript semantic dependency completeness. |
| Cost-weighted unit sharding | `src/test/shard-sequencer.ts:173–232` | Improve measurements and reuse this scheduler rather than replacing it with equal file counts. |
| Known base failures are mandatory local replays | `scripts/verify-push.mjs:179–208`, its replay validation in `main()` | Preserve this assurance exception even if ordinary affected selection is empty. |

The reader classifier recognizes actual `fs` imports and read-operation names, and explicitly
excludes operational database fixture loaders. It does not record which file, glob or directory a
particular test consumes. `src/test/source.ts:14–19` is a concrete example where directory membership
matters: adding a matching file changes the contract's input without editing an existing read file.
These observations support targeted dependency capture; they do not justify dropping the broad
reader augmentation immediately.

## Framework capabilities and their limits

### Vitest: compare static selection with the recorder already installed

The installed `node_modules/vitest/dist/chunks/cli-api.De07GUeT.js` contains:

- `AffectedModulesResolver` at line 9930: traverses per-project transformed graphs, including
  project setup, environments, configuration dependencies, snapshots and mocks.
- `DependenciesCache` at line 6115: persists loaded modules per test file in `dependencies.json`.
  Its update at lines 6170–6181 unions existing dependencies for partial runs instead of replacing
  them with incomplete observations. `resolveFiles` at line 6198 also includes plugin-watched
  inputs where the module runner exposes them.
- `RecordedModulesResolver` at line 10253: selects using those records. Missing project or test
  records widen the run. Configuration/environment changes can widen a whole project.
- The switch at line 10396: `experimental.recordDependencies` selects the recorded resolver in
  place of repeated static graph resolution.

The [official experimental documentation](https://main.vitest.dev/config/experimental#experimental-recorddependencies)
describes runtime records for changed/related selection, partial-run merging and important limits:
arbitrary filesystem reads and externalized imports are not recorded; records can become stale
when imports change without a subsequent run. The live page labels this API 5.1.0+, although the
installed 5.0.5 bundle contains it. Treat this version mismatch as an evaluation requirement, not
as a supported configuration promise. Pin and test the actual runner version before adoption.

**Candidate experiment:** compare native static selection, recorded selection, and their union,
all augmented with the same conservative non-import dependencies. Run the full suite as the
oracle. A recorder's tighter result may reflect mocks accurately, or simply an unobserved branch.
Initially use the union for ordering rather than letting the recorded set erase static edges.
Do not persist records from aborted or incomplete runs as complete baselines.

Vitest separately documents
[watch triggers for non-imported files](https://vitest.dev/config/watchtriggerpatterns.html) and
[whole-suite triggers](https://vitest.dev/config/forcereruntriggers.html). These support the need
for explicit contracts around templates and subprocesses. Watch behavior is not automatically a
persisted CLI dependency database; validate the specific changed/related path before reusing it.

### Playwright: test imports are not application dependencies

The installed Playwright bundle
`node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/lib/common/index.js:205–238`
collects test-file import dependencies and selects tests that import changed files. This explains
the useful reach of the [official `--only-changed` option](https://playwright.dev/docs/test-cli),
but a browser spec that requests `/shop/...` does not thereby import the server route's module.
Replacing the existing route/application analysis with `--only-changed` would lose that bridge.

Playwright's [CI guidance](https://playwright.dev/docs/ci#fail-fast) explicitly treats changed-test
selection as a heuristic and recommends a full run after the preliminary run. This is directly
compatible with a faster first-failure path under the current ADR.

The [coverage API](https://playwright.dev/docs/api/class-coverage) measures page JavaScript/CSS
and is Chromium-only. It does not establish server-action, RSC, database or worker execution.
[Traces](https://playwright.dev/docs/trace-viewer-intro) record observed actions and related
diagnostics; a network request is evidence of an exercised endpoint, not a complete source-module
set. Neither should replace application dependency analysis on its own.

## A dependency model that can explain selection

Use one versioned manifest format with separate edge types. This is a proposal, not a new runtime
dependency or an approved architecture decision. Start at test-file granularity; exact individual
case mapping is more fragile for parameterized tests, concurrent cases, hooks and title changes.

| Edge type | What it records | Invalidation rule or limitation |
| --- | --- | --- |
| Module edge | Resolved importer/importee, project, resolver/config identity | Consider both base and head graphs; namespace imports and module initialization can broaden symbol-level reach. |
| File read | Normalized source or fixture path and content identity | Changes and deletion select all consuming test files. Include JSON, SQL, CSS, images and generated sources. |
| Directory/glob query | Directory, recursive flag, pattern, relevant membership | Addition, deletion and rename can change results even when no previously returned file changed. |
| Negative lookup | Missing path, failed resolution, existence/stat outcome | Creating a previously missing file invalidates the observation. Successful reads alone miss this. |
| Process contract | Executable/script, argv shape, declared inputs/configuration | Reads in child processes are invisible unless propagated. Unknown process contracts widen the appropriate suite. |
| Browser/server observation | Test/project, request route, server build identity, correlated server-module observations where available | Do not attribute concurrent server work using a process-wide current-test variable. Request IDs and async context are needed; background work needs separate attribution or a broader contract. |
| Semantic domain contract | Schema, migrations, seed/clock, auth/session, environment and build inputs | Keep explicit broad fallbacks even if historical runtime observations look narrow. |

Filesystem instrumentation is not just replacing `readFileSync`: consider promise/callback APIs,
streams, file handles, `stat`/`access`, aliases, symlinks, package resolution, subprocesses and
glob enumeration. Hooks can alter mocks or runtime semantics. Pilot on the shared source readers
and fixture APIs first; any uninstrumented reader remains under conservative classification.

Record normalized paths and dependency identities, not fixture contents, tokens, request bodies,
medical data or authentication headers. A raw browser trace is a debugging artifact with a
different privacy and retention surface from a small selection manifest.

### Manifest integrity and fallback policy

Key observations to repository tree/base identity, selector schema version, runner/Node/platform,
project configuration, resolver/transform settings, lockfile, relevant environment names/values
through a non-secret identity, build identity and seed/frozen-clock identity. Separate complete
baselines from partial observations. Shard outputs merge by union and retain completeness metadata;
one shard must not overwrite the other's edges. Publish atomically. Do not trust a cache restored
from an unrelated configuration or allow an untrusted PR artifact to replace a trusted baseline.

Retain the base manifest so a removed import or deleted file can reach its old consumers. Combine
base and head positive edges. New/unmapped files, failed resolution, unknown generators, corrupt or
missing manifests, changed dependency tooling, changed discovery configuration, schema/migrations
and incomplete server attribution widen selection. For a broad semantic input, use a whole-project
or whole-suite fallback rather than manufacturing a high confidence score.

When implementation later provides explicit contracts and tests for a class of changes, the
fallback can narrow for that class. Until then, absence of evidence is reported as unknown.

## Coverage and confidence: useful for ranking, insufficient for exclusion alone

Current Vitest coverage configuration targets eleven safety files (`vitest.config.ts:40–56`).
The workflow merges shard coverage for floors (`.github/workflows/ci.yml:267–290`). These aggregate
reports do not provide a complete test-file-to-all-source mapping. The
[Vitest coverage guide](https://vitest.dev/guide/coverage.html) explains V8/Istanbul measurement;
neither a reached line nor a high percentage proves that an assertion detects a fault.

Per-test-file coverage could augment ranking if collected with explicit attribution. Concurrent
tests, shared module initialization, hooks and accumulated coverage must not be casually assigned
to a single case. Client and server coverage need separate collection and source-map validation.
New branches cannot be selected by historical coverage of code that did not previously exist.

Expose evidence categories instead of an unjustified numeric certainty: edited test; direct
resolved dependency; explicit filesystem contract; observed runtime edge; route/copy heuristic;
or unknown/fallback. Every selected test should have a reason, and every excluded class should
name the assumptions allowing exclusion. A large number of observed successful selections does
not prove universal completeness.

For initial ordering: known failures first, then changed tests and explicit direct contracts,
then the union of module/runtime/route evidence, then the remaining suite. Consider duration,
failure history and fixture startup cost when packing shards. Ranking a short likely failure first
can improve time to feedback without weakening the eventual merge verdict. Avoid an additional
serial preliminary run that duplicates enough setup or test work to lengthen the critical path;
compare it with ordering the same complete work and publishing partial results early.

## Validation before any exclusion policy changes

1. **Shadow selection:** full CI still runs. Emit candidate sets, evidence reasons, fallback causes,
   manifest completeness and selection overhead alongside the actual per-test results. Keep first
   failures distinct from retry passes, cancelled jobs, collection errors and infrastructure errors.
2. **Historical replay:** evaluate the selector as it would have existed at each chosen commit,
   with that commit's base, tree, configuration and available dependency data. Reusing the head
   graph or the eventual fix's knowledge leaks future information. Include fixes involving copy,
   routes, helper imports, newly added files, fixture reads, schema and deleted dependencies.
   Existing logs reveal observed failures only; they cannot label unexecuted tests as passing.
3. **Adversarial fixtures and mutation:** introduce test-only graph cases for new glob members,
   previously missing files, dynamic imports, mocks, barrels, side effects, shared helpers, deletes,
   renames, environment/config changes, subprocess reads and concurrent server requests. Introduce
   representative application faults and verify both that the full oracle detects them and that
   the candidate selects a detector. An uncaught mutant does not automatically indict selection;
   the underlying assertions may miss it too.
4. **Measure the correct outcomes:** missed reproducible failing files/cases; time to first useful
   failure; queue plus critical-path wall time; runner/CPU minutes; cold/warm planning overhead;
   fixture/build startup; selected fraction by project; fallback frequency; cache storage/transfer;
   and instrumentation perturbation. Compare like runner classes, worker counts and cache states.
   A smaller selected count is not an end-to-end speedup measurement.
5. **Set promotion criteria in a decision:** require no observed reproducible failure omissions in
   the agreed replay/shadow corpus, complete accounting for skipped tests, tested unknown-input
   fallbacks, a rollback switch and a stated observation period. This is a release criterion, not
   a mathematical zero-miss guarantee. Continue independent full-suite audits after promotion if
   affected-only CI is approved; sampled complements alone cannot guarantee each merge's safety.

## Suggested implementation sequence and targets

First consolidate source reads into one per-invocation snapshot shared by `importGraph`,
`readModules` and route/copy selection; they currently read the same source tree through separate
paths (`scripts/e2e-affected.mjs:647–659`). Cache parsed modules by content plus parser/resolver
identity, with explicit deletion and directory-membership invalidation. Measure parsing separately
from runner transforms and database/browser startup before assuming this is the main bottleneck.

Then evaluate the installed Vitest recorded resolver, keeping the existing reader contracts and
full CI oracle. Add explicit reader declarations or instrumentation to the shared source helpers;
compare their reduced candidate set against the current broad augmentation. Keep route heuristics
and smoke tests while exploring server-correlated observations for browser prioritization. Only
after those comparisons should a proposal choose between dependency-only CI, a hybrid policy or
retaining full CI with better scheduling.

Useful initial targets are measurable acceptance checks rather than promised percentages:

- Every candidate decision has reasons and a declared fallback; discovery errors never become an
  empty successful selection.
- Every full-run test result can be joined to the shadow plan by project and stable file/test
  identity, including retries and skipped/collection-failed cases.
- No observed reproducible failure detector is excluded in the agreed validation corpus.
- Planning, cache transfer and instrumentation cost less than the execution/latency they save on
  representative cold and warm runs; report the actual distribution and sample size.
- Critical-path feedback improves without merely moving work into an unreported prerequisite or
  increasing contention for the other layers' workers.

The original [testing/CI audit](20261021-testing-and-ci.md) describes broader correctness gaps.
This note proposes selection work without claiming those gaps are resolved. Any later hard-to-
reverse runner, cache-trust or merge-gating choice requires an ADR; adding a runtime dependency
also requires one under the repository rules.
