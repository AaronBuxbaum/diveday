# AI coding efficiency assessment

**Date:** 2026-10-21. **Repository snapshot:** `971c490d4ba1e863a3fb4e5a7ced4d5e94dd4522`.
**Requested outcome:** explain excess context/token use, slow delivery, repeated CI repairs,
and recurring visual mistakes; identify improvements and missing skills.

## Assessment

The strongest opportunity is to make the existing agent system coherent, selective, and
verifiable. DiveDay already has extensive instructions, 44 skills, 26 task-context areas,
tested repository guards, reusable UI primitives, affected-test selection, and sophisticated
visual tooling. Adding another broad checklist would often add reading without preventing a
mistake.

Five problems stand out:

1. **The effective workflow differs by provider.** Claude has automatic context, formatting,
   failure guidance, and push checks; the checked-in Codex setup does not demonstrate equivalent
   lifecycle wiring. Twenty local skill bodies are duplicated and three have diverged.
2. **Some instructions are wrong today.** A feature skill tells agents to await visual baseline
   commits CI no longer makes. Design context contradicts the light-only local review policy.
   Architecture guidance treats the already-implemented test database snapshots as future work.
3. **Retrieval is often too broad.** A small task can be directed toward roughly 24,000 words of
   general documentation, or a whole source directory, instead of its decisions, examples, and
   checks. The current context budget does not measure that cost or the host's injected context.
4. **The fastest checks do not carry enough evidence of what was exercised.** The quick gate
   intentionally omits browsers; separate instructions require focused checks, but no common
   artifact reconciles them. Visual coverage counts routes, while bugs occur in specific states.
5. **Shared files and imperfect tooling amplify each correction.** Stack-parent detection only
   considers Claude branches, visual captures live in a 10,304-line shared spec, and central
   bundles/ratchets are frequently edited. Repeated local checks and late browser failures then
   compound the cost.

The recommended direction is a small task packet, a reliable base resolver, a few tested
composition recipes, and one evidence record carried from implementation through CI and review.
Keep the safety and correctness standards; reduce the interpretation and orchestration work.

## Scope, evidence, and limits

This is a repository-wide structural and workflow audit, with targeted inspection of high-change
application modules. It is not an exhaustive line-by-line correctness review of every source file.
The review covers instructions, skills, provider configuration, hooks, scripts, CI, fixtures,
domain/data structure, design standards, primitives, visual tests, local history, and recent live
GitHub Actions results. Three focused research tracks supplied independent evidence; their full
reports are linked below.

| Evidence | Observed result | What it does not establish |
| --- | --- | --- |
| Agent-health command | 44 skills; 63 guard scripts have adjacent tests | That all guards are effective or all provider hooks run |
| Repository startup estimate | 2,047 words, approximately 2,800 tokens | Actual session tokens, plugin overhead, or billed cost |
| Route coverage | 110/111 visual; 62/111 axe | Changed-state coverage, reviewed pixels, or overall accessibility |
| Architecture guard | Pass; 14 existing violations across nine files | Absence of dependency debt |
| Baseline doc-link check | 713 Markdown files passed | Semantic correctness of instructions |
| Latest 50 sampled CI runs | 27 success, 16 failure, seven cancellation | Historical first-pass rate or developer fault |
| 32 sampled PR workflow runs | 13 success, 12 failure, seven cancellation | 32 distinct PRs or 32 first attempts |
| Completed PR runs in that sample | 12/25 failed, or 48% | A long-term rate; cancellations are excluded |

The CI sample spans approximately 2026-10-20 through 2026-10-21. Five runs had a final attempt
number above one, so final conclusions can hide earlier failures. No production data, runtime
behavior, CI configuration, or application code was changed. No CI reruns were requested.

Exact token spend and task-to-merge latency could not be measured from the available repository
and Actions sample. The report therefore distinguishes confirmed defects from plausible cost
mechanisms and proposed experiments. It does not promise a percentage saving.

Detailed evidence:

- [Instructions, retrieval, and handoffs](agent-efficiency-context-20261021.md): C1–C8.
- [CI, verification, and delivery](agent-efficiency-ci-20261021.md): live run links and findings.
- [Visual delivery](agent-efficiency-visual-20261021.md): V1–V9 and acceptance criteria.
- [Structure and measurement](agent-efficiency-structure-20261021.md): S1–S6, inventory and hotspots.

## Priorities

Here P0 means repair before further workflow optimization, not a production outage. Effort is
relative: S is a bounded correction, M spans several tools/tests, L is a staged structural change.
These are planning judgments, not elapsed-time promises.

| Priority | Improvement | Evidence | Effort | Completion criterion |
| --- | --- | --- | --- | --- |
| P0 | Resolve actual PR/stack base without provider prefixes | CI finding 1 | M | Codex, Claude, arbitrary names, offline fallback, and merged parents select correctly |
| P0 | Consolidate duplicated skills and repair stale workflow instructions | C2/C5, V1 | S–M | One owner per skill; every provider reference resolves; no obsolete baseline-commit instructions |
| P1 | Make provider capabilities explicit and portable | C1 | M | Fresh and resumed sessions show which bootstrap/check capabilities actually ran |
| P1 | Produce bounded, surface-specific task packets | C3/C6, V2 | M | Common tasks start with exact examples, decisions, tests, and captures instead of broad manuals |
| P1 | Bind visual evidence to fresh build inputs and explicit state | V3/V4 | M | Old UI and empty fixtures cannot satisfy changed-state verification |
| P1 | Orchestrate focused visual review through one entry point | V5 | M | One command assembles valid images/probe outputs; a reviewer separately records judgment |
| P1 | Publish a unified CI failure/result manifest | CI finding 5 | M | One bounded artifact identifies failing setup, affected tests, and reproduction commands |
| P1 | Preserve decisions and evidence in durable handoffs | C7 | S–M | A fresh worker resumes without reopening settled product decisions |
| P1 | Gather static failures together; reuse safe check results | CI finding 4 | M | Multiple independent failures arrive in one pass; cache invalidation is tested |
| P2 | Add runnable UI composition recipes | V7 | M | Approved menu, feedback, rail, form, and handoff patterns are easy to find and exercise |
| P2 | Split visual tests and other demonstrated shared hotspots | V6, S2 | L | Stable captures/selection; independent domains stop editing one central file |
| P2 | Refactor large, high-change modules along existing operations | S1/S4 | L | Smaller reading footprint without changed transaction or safety contracts |
| P2 | Establish recurrence and delivery metrics | C8, S6 | M | Comparable task cohorts have token, first-green, repair, and merge measures |
| P2 | Add targeted dependency-maintenance guidance | CI finding 6 | S–M | Tool upgrades include config migration and relevant validation in one reviewable change |

## Why work consumes more context than expected

### A small startup file is only a small part of the bill

The context ratchet measures selected repository Claude startup files and description lines.
It excludes the current host's global instructions, plugin catalog, tool schemas, memory,
on-demand skills, transitive documentation reads, screenshots, logs, and delegated transcripts.
Its roughly 2,800-token estimate is useful within that narrow scope. It should not be labelled
the cost of every session across providers.

Task-context entries commonly list roadmap, glossary, principles, and architecture as "Read."
Those files total 23,964 words in this checkout. The visual reference set of principles,
pixel-craft, settled questions, and surfaces totals 24,955 words. These totals are not observed
token consumption: a careful agent may read excerpts. The instructions should make the narrow
path explicit rather than rely on every agent to infer it.

**Proposed task packet:** relevant rule files, current decision anchors, exact domain invariant,
the operation or component to reuse, one current example, test entry points, changed locales,
capture IDs and fixture states, and exact validation commands. Everything else remains linked
for follow-up. Start with design, bookings, auth, and database entries, which currently have broad
pointers; use the more precise gear/work-orders entries as models. See C3 and V2.

### Provider migration has duplicated obligations without duplicating protection

The local skills have two tracked copies. The divergent copies include nonexistent
`.Codex/rules/` references. Current path checks concentrate on the Claude tree and miss these
Codex-visible errors. The repository's Codex configuration declares environment and MCP setup,
but does not declare equivalents of Claude's automatic formatting, command guards, failure
explanation, or compaction reminders. An external host may supply capabilities; none should be
assumed from the existence of a shared AGENTS file.

Make scripts the portable implementation and provider adapters the convenience layer. A session
bootstrap should state capabilities actually available, relevant rule paths, base/dirty state,
and current task-state artifact. Keep critical enforcement in commands and CI. Consolidate
skills with supported links or generated adapters, then test all exposed entry points. See C1/C2.

### Contradictory instructions cause rational agents to take different paths

Examples include unconditional dark captures versus color-only dark review; full local visual
comparison versus Linux-baseline guidance; a read-only Explore role prescribed for execution;
and CI access instructions that universalize an old cloud environment's restrictions.
[Verifying guidance](../../agents/verifying.md) says CI can only be read through MCP, while
[issue-tracker guidance](../../agents/issue-tracker.md) prescribes REST/CLI access. In this audit,
REST access worked. Preserve the historical lesson about positive completion checks, but probe
capabilities instead of treating one environment's incident as universal policy.

Operational facts should have one structured owner: supported providers, base policy, stage
commands, capture modes, artifacts, and role capabilities. Generate small references where
practical. Keep rationale in dated docs. A general semantic linter is unnecessary; exact contract
tests for the handful of high-cost facts will catch more than another admonition to read carefully.

## Why changes need several CI repair iterations

### The late failures are often shared contracts

In the inspected map run, six failures came from the same setup expectation: a marker selector
expected 20 elements and found none. Another sampled failure timed out in the shared sign-out
helper. These are good candidates for one focused interaction check before a wide suite. They
are not six independent problems, and a near-timeout annotation does not establish that a timeout
increase is the fix. The CI appendix links the exact runs and limits the root-cause claims.

A repair artifact should group identical setup failures, identify the first failing helper,
show the expected and observed fact, list consumers, and provide one reproduction command.
Raw logs remain available. Classify observations separately from suspected causes.

### The quick gate is a deliberate tradeoff with an incomplete evidence handoff

The approved quick gate avoids an hour-long local run and lets CI supply the full answer.
Retain it. The verify skill separately requires relevant browser checks before commit, but a
quick stamp does not say whether those happened, which build they used, or which states rendered.

Introduce an evidence manifest with per-check status: passed, failed, not run, or deferred to CI,
plus exact inputs and artifacts. Let a bounded interaction tier target the changed shared helper
or surface. It must reuse a verified build when valid and report omitted checks plainly.
Do not turn every text change into a full browser suite.

### Base selection can charge a task for inherited work

`stackBase` in [e2e-affected.mjs](../../../scripts/e2e-affected.mjs), lines 104–125, searches
`refs/remotes/origin/claude`. [verify-push.mjs](../../../scripts/verify-push.mjs), lines 423–447,
uses that result for both selection and the base CI verdict. A Codex stack can therefore fall
back to main, select inherited changes, and inspect the wrong parent's status.

Use the actual PR base where available, an explicit local base when working before a PR, and a
labelled conservative fallback when offline. Share the resolver across tools, but preserve the
different semantics of a visual fork-point comparison. Merely adding `codex/*` would leave the
underlying naming assumption in place.

### Verification repeats work and sometimes reports failures serially

Pre-commit lint/typecheck and pre-push static checks overlap. The push gate stops at the first
red stage even though another repository orchestrator already collects independent failures.
After regeneration and clean-input checks, gather independent static diagnostics together with
bounded concurrency. Cache safe successful stages by content, toolchain, configuration, and
relevant environment; stamp the final result against HEAD. A SHA-only cache misses reusable work,
while an incomplete content key can accept stale results. Measure both correctness and runtime.

Keep one validated push per round and full CI on every stack layer. Those are explicit decisions.
This assessment proposes better evidence and less redundant computation, not silently changing
the user's delivery policy.

## Why visual features repeat mistakes

### Route coverage is the wrong unit for many visual defects

The repository already records an example where a diver-profile capture had no orders, so it
never showed the payment section being changed. A route can have a screenshot and still miss
the open menu, validation error, undo control, long label, expanded row, or persisted outcome.
Screenshot existence is also different from a reviewer inspecting the correct image.

For meaningful UI changes, the worker brief should name role, route, fixture, state, viewport,
locale, and an expected visible fact. Assert that fact before capturing. Select the states
appropriate to the task; do not mechanically demand every combination. See V3.

### Old builds can make wrong evidence look successful

[check-e2e-build.mjs](../../../scripts/check-e2e-build.mjs), lines 59–66, warns when `src` is
newer than the build and continues. A passing capture of old code is as misleading as a failure
against old code. Configuration and other build inputs are outside that heuristic.

Fingerprint relevant build inputs and carry the build identity into capture metadata. A
verification capture must reject stale inputs; an exploratory capture may explicitly use them
with a visible label. Spec-only edits should still reuse a valid app build. This preserves the
fast path while making its evidence credible. See V4.

### Good design knowledge is expensive to assemble at the point of use

The repository already has extensive controls, feedback rules, a pixel atlas, an independent
critic, and a settled-findings register. The missing piece is a concise route from an intent
such as "compact row actions" to a runnable composition using those primitives.

Pilot five examples: compact actions with confirmation, temporary success with persistent
actionable error, durable undo, settings with its rail, and a saved helper handoff with clear
next action. Import production primitives and show narrow width, long copy, pending, focus,
and failure where relevant. Extend the existing atlas/harness before adding a new dependency.
Examples must remain subordinate to accepted decisions and current production behavior. See V7.

### Visual review has many good tools but too much manual orchestration

Listing tests, selecting captures, forming grep commands, collecting images, generating tiles,
running probes, checking settled findings, and briefing a critic can be one bounded command
over existing tools. Its output should distinguish generated evidence from reviewed evidence.
The critic gets current artifacts and applicable constraints, not an entire unrelated image
fleet. Significant design review and safety reviews remain intact.

Visual differences currently warn rather than fail. Thus green CI alone cannot close visual
review. Record the review against exact head/build inputs and explain changed, new, and removed
images. The obsolete baseline-commit instruction should be removed first. See V1/V5/V9.

## Codebase cleanup with a plausible efficiency payoff

The structure appendix quantifies source areas and high-change paths. Target actual reading and
coordination cost, not a cosmetic rewrite.

- **Split the visual spec first among structural candidates.** It is 10,304 lines and appears
  134 times in the inspected non-merge history window. Update discovery/selection/coverage
  parsers before moving one domain. Preserve image names and matrices so the refactor does not
  erase baseline continuity.
- **Partition shared metadata only where it reduces simultaneous edits.** Ratchets and diver
  bundles dominate the local change-frequency sample. Keep a canonical aggregation interface;
  avoid replacing one file with several hand-maintained indexes. History counts include possible
  branch/squash duplication and are not conflict counts.
- **Split high-change domain modules by existing operation.** Bookings is 4,144 lines, erasure
  2,978, orders 2,767, manifests 2,382. Keep public barrels, one transaction owner, and explicit
  lock/side-effect ordering. Adopt a split when touching the area, with targeted behavioral and
  required adversarial reviews. Do not rebuild the architecture just to shorten files.
- **Move true repository source scans into the guard layer.** `form.test.tsx` contains broad
  source sweeps despite guidance that these belong in guards. Preserve their constraints while
  separating component behavior from repository policy.
- **Repair stale authoritative docs before adding new ones.** Architecture still describes
  old schema and test-fixture mechanisms. The current link checker cannot catch those meanings.
- **Profile fixture/cache costs before optimizing them.** Snapshot hashing invalidates on any
  non-test db edit. That is a conservative design; narrower invalidation needs dependency proof,
  not filename guesses. Snapshot hydration and atomic writes already exist.

The best local example is `seatDiver`: one operation owns booking consequences that previously
drifted across five doors. That makes forgetting a consequence difficult. Prefer this kind of
interface improvement to another instruction telling every caller what to remember.

## Skills: extend most, add few

| Capability | Recommended home | Concrete output |
| --- | --- | --- |
| Task-specific context | Extend `task:context` and `new-feature` | Bounded packet of decisions, symbols, exemplars, checks |
| Visual change planning | Extend `design-implementation` and worker spec | Relevant state/fixture/viewport contract |
| Scoped visual evidence | Extend `design-review`, `e2e-and-visual`, `visual-triage` | One fresh artifact manifest plus separate review verdict |
| CI diagnosis | Small new `ci-triage` skill, backed by a result manifest | Classified failure, minimal repro, shared cause, exact repair validation |
| Toolchain updates | Small new dependency-maintenance skill | Installed migration guidance, coherent config/package change, relevant checks |
| Provider setup/resume | Extend `run`, doctor/bootstrap, and handoff templates | Capability status, correct base, live task state |
| Reusable interaction patterns | Recipes beneath existing design skills | Runnable compositions using production primitives |
| Learning from recurrence | Extend papercuts/debug and task metrics | Confirmed recurring class promoted to a guard, recipe, fixture, or API |

Do not install more generic design, debugging, or code-review skills to address these findings.
The local library is already large. A new skill earns its place when it consumes a concrete
artifact and removes repeated decisions or tool calls. Fix the capability mismatch where a
read-only scout is told to execute tests; make role choice reflect tools actually available.

Dependency tooling deserves particular care: the session warns that the global Vercel CLI is
54.10.3 while this checkout declares `vercel` at `^64.5.0`. Neither establishes which executable
a command actually resolves. Strongly recommend upgrading the old global CLI with
`npm i -g vercel@latest` or `pnpm add -g vercel@latest`; first confirm executable/version and keep
repository toolchain changes separate. No upgrade was performed or external latest version
independently verified in this audit. This is secondary to the measured workflow problems.

## Delivery plan and acceptance experiments

### Phase 1: remove known wrong turns

Consolidate skills, fix invalid paths and obsolete visual instructions, correct the database
overview, repair provider-neutral base resolution, and reconcile role capabilities. Test the
specific contracts. These changes have direct evidence and do not require a broader process
redesign.

Acceptance exercise: start the same small task through each supported provider and verify it
finds the same rules, actual base, example, and validation path. No waiting for nonexistent CI
artifacts; no instruction that needs an unavailable role capability.

### Phase 2: make visual work and handoffs reproducible

Add task packets for the most frequent UI operations, visual state fields in worker specs,
build/capture fingerprints, the focused review command, and the CI evidence manifest. Extend the
handoff with accepted decisions in the user's terms, source links, SHAs, pending checks/reviews,
process ownership, and the next executable action. Keep these artifacts local to the task where
appropriate, not as new product-truth documents.

Acceptance exercise: one menu/feedback change and one form change each reach a valid first image
with a single orchestration command. A fresh reviewer can prove the requested state is present.
A fresh worker resumes without asking the user to repeat the accepted behavior.

### Phase 3: reduce repeated computation and shared editing

Gather static diagnostics together, pilot content-keyed stage reuse, split one visual domain,
and move one source scan. Pick one high-change domain-module split during related feature work.
Retain all relevant safety tests and review obligations. Compare before/after capture lists and
selection results; a faster selector that misses the affected state is a regression.

### Phase 4: evaluate policy with actual outcomes

Measure the next comparable cohorts of completed work, ideally over two weeks before and after
the changes. Use medians and a tail measure with sample sizes; small cohorts do not support a
confident p95. Track:

| Metric | Definition |
| --- | --- |
| Tokens/cost per landed task | Parent plus workers; separate cached input, uncached input, output; only where provider data exists |
| First-pass CI | First required run on the first ready-to-review SHA, with explicit cancellation handling |
| Repair iterations | Distinct corrective pushes before accepted green, classified by root cause |
| First useful visual feedback | Implementation start to first fresh capture of the requested state |
| Visual acceptance | First review accepted; later regressions and reviewer reversals tracked separately |
| Delivery latency | Active work, execution, queue, review wait, and merge wait reported separately |
| Repeated mistake rate | Same confirmed failure class recurring after a preventive change |
| Selection quality | Tests/captures selected, fallback reason, and missed relevant checks |

Segment docs-only, copy/UI, domain, schema, dependency, and infrastructure tasks. Track failed or
abandoned tasks too; measuring only merged PRs hides the worst waste. Use the results to decide
whether stacking, concurrency, or broader local checks need policy changes. Do not infer those
decisions from one noisy day of CI.

## What to preserve

Keep the domain gates, tenant isolation, safety reviews, immutable baselines, deterministic clock,
real database tests, tested guards, explicit exceptions, and honest distinction between tested,
merged, and deployed. Keep the existing affected-capture selection rather than rebuilding it.
Keep design rationale and settled exceptions, but retrieve the relevant entries. Keep the quick
gate as the default while exposing its missing evidence. Keep public and staff surfaces separate.

These safeguards are assets. The desired improvement is that a fresh agent reaches the right
implementation and reliable evidence with fewer reads, fewer guesses, and fewer repair rounds.

## Audit validation

Executed: repository health/context reporting, task-context listing, architecture guard,
documentation link checks, skill-copy comparison, tracked-file inventory, local-history queries,
and read-only GitHub run/job/annotation inspection. The agent-configuration check reported two
missing local MCP launcher binaries; that is an environment limitation, not an audit-doc defect.
No app build or browser run was necessary to produce this report, and none was used to claim
runtime correctness. Recommendations remain proposals; no application fixes, commits, pushes,
issues, or policy changes were made as part of the assessment.
