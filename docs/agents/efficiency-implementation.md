# Agent efficiency implementation — 2026-10-21

Disposition of the [assessment](../product/assessments/agent-efficiency-20261021.md).
This describes implemented mechanisms and bounded pilots, not measured improvements in cost or
landing time. Hosted CI, visual acceptance and comparable task cohorts must supply those outcomes.
The structural pilot reported six files / 116 tests and typecheck passing; that is local evidence,
with two independently framed domain reviews and a security review reporting no findings; hosted CI remains separate. A route capture is not a review, a configured hook is not observed execution, and missing usage
is unknown rather than zero.

## Commands

| Need | Command / artifact |
| --- | --- |
| Start or resume any provider | `pnpm agent:bootstrap --provider codex` (`claude` or `other`) |
| Retrieve focused contracts | `pnpm task:context --path src/components/ui/button.ts` |
| Retrieve a composition | `pnpm task:context --recipe row-actions` |
| Exercise the production recipe | `node scripts/visual-recipes.mjs row-actions` |
| Save or inspect durable state | `pnpm task:state <prepared-state.json>` / `pnpm task:state` |
| Plan changed UI evidence | `pnpm visual:review --grep <capture-title> --plan` |
| Generate changed UI evidence | `pnpm visual:review --grep <capture-title> --route <route> --role <role> --fixture <seed> --state <state> --expect <selector>` |
| Verify before push | `pnpm verify:push --quick`; JSON result in Git worktree metadata |
| Read hosted failures | Download the workflow's `ci-result-<attempt>` artifact |
| Import downloaded CI result | `pnpm task:metrics --import-ci <ci-result.json>` |
| Record explicit observations | `pnpm task:metrics <event.json>` |
| Review observed cohort metrics | `pnpm task:metrics --report` |
| Measure fixture setup | `node --import tsx src/test/db-template-profile.ts .agent-out/fixture-profile.json` |
| Check provider and documentation drift | `pnpm check:agents`, `pnpm check:docs`, `pnpm check:context-budget` |

The CI evidence producer runs inside CI with its environment; it is not a local replacement for
fetching a run. Visual capture flags require a real changed-content selector. See the
[provider contract](provider-contract.md) for state fields and manual host responsibilities.

## Context and provider findings

| Finding | Disposition and practical limit |
| --- | --- |
| C1: provider parity | Offline bootstrap exposes branch, Node, dependencies and state for all providers. Claude lifecycle hooks are configured but unverified; other hosts receive explicit commands. No invented Codex hook API. |
| C2: duplicated skills | One `.agents/skills` source, Claude symlinks, local/upstream provenance and mirror/path checks. Relative supporting links remain at the same directory depth. |
| C3: broad retrieval | Broad books become optional references. Path packets select exact sibling tests, rules and preserved invariants; common UI paths select executable recipes. Unmapped paths explicitly fall back to the route map. |
| C4: misleading budget | Reports distinguish repository Claude and canonical-provider estimates and excluded host context. The existing Claude ratchet remains; canonical estimates are not separate hard budgets. |
| C5: semantic conflicts | Corrected dark-scheme policy, scout capabilities, stack wording, schema/components and PGlite guidance. Tests cover concrete provider mirrors, command dependencies and branch fetch scope; they do not prove all prose semantics. |
| C6: visual retrieval | Five concrete recipes plus focused visual-review inputs provide a bounded entry point for ordinary changes. Broad audit mode remains appropriate for shared changes. |
| C7: handoff gaps | Validated local task state preserves immutable commits, exact decisions/provenance, checks, visual evidence, process ownership, pending work and next command. Transfer the ignored artifact when moving machines. |
| C8: recurrence loop | Task observations distinguish provider/task class, corrections, failure classes and sourced usage. Compare cohorts after enough tasks exist; no reduction in recurrence has yet been established. |

## Visual findings

| Finding | Disposition and practical limit |
| --- | --- |
| V1: contradictory workflow | Canonical skills now prescribe scoped fresh changed-state capture, conditional dark checks and CI S3/sticky-summary review. No baseline commit or follow-up visual-only job is awaited; full local comparison is an explicit investigation. |
| V2: broad design context | Path routing returns production primitives, contract tests, recipe states and exact execution commands. It does not replace surface-specific acceptance criteria. |
| V3: route versus state proof | Focused capture requires route, role, fixture, state and a positive changed-content selector. Manifests preserve evidence; reviewers still judge whether that selector proves the intended feature. |
| V4: stale builds | Input fingerprints guard verification-grade build reuse. A spec-only change can reuse the application build; application input drift requires rebuilding. |
| V5: manual assembly | One bounded visual-review command produces run-scoped capture and probe inputs, freshness and rerun evidence. Status remains captured-not-reviewed until a reviewer inspects it. |
| V6: monolithic spec | Domain extraction is a pilot with discovery/coverage updates and stable capture names. It is not a claim that every visual domain has been separated. |
| V7: runnable compositions | Five executable recipes use existing production components/contracts: row actions, feedback, forms, settings and handoff. The handoff recipe documents current behavior and does not claim issue #2851 is implemented. |
| V8: source policy in UI tests | Structural pilot moved 481 source-policy lines out of form component tests into the guard layer. Component behavior and geometry evidence remain different verification layers. |
| V9: calibration metrics | Current-run manifests avoid mixing stale artifacts. Confirmed/possible judgments and supplied failure classes remain explicit; first-pass visual acceptance and precision still need observed cohorts. |

## Structure findings

| Finding | Disposition and practical limit |
| --- | --- |
| S1: large domain modules | Diver-detail operations moved to `src/db/bookings-diver-details.ts`; bookings shrank 252 lines with eight stable re-exports. Structural focused tests/typecheck passed; two independent domain reviews and the security review reported no findings. No repository-wide domain split is claimed. |
| S2: shared edit hotspots | Canonical skills remove duplicate edits; visual-domain extraction reduces one hotspot. Further locale/ratchet partitioning must preserve one reader and be justified by measured conflicts. |
| S3: architecture drift | Overview now describes schema directories, existing components and implemented snapshot/transaction test helpers. |
| S4: centralize omissions | Executable recipes and shared verification-base resolution own repeated workflow decisions. Existing seat-diver transaction/consequence ownership remains authoritative. |
| S5: fixture setup cost | Added opt-in fingerprint/cache/build timing and a fixture hydration profiler. One warm-cache observation under host contention measured a 1.7-second fingerprint and 2.6–3.8-second hydration; this is not a before/after comparison. Conservative invalidation remains until repeated observations justify changing it. |
| S6: outcome measurement | Record task-level events and sourced cached/uncached/output usage; compare like task classes. Historical start time, model spend and missing merge events are never synthesized. |

## Verification and CI findings

| Assessment finding | Disposition and practical limit |
| --- | --- |
| Provider-dependent PR base | Shared resolver uses actual PR/CI base or explicit local branch configuration. Unknown authoritative base broadens to main with a warning. Push upstream is not treated as a parent. |
| Obsolete baseline-commit procedure | Canonical new-feature, E2E, design-review and triage procedures use current S3 comparison/sticky-summary CI. Expected keys are explicit; visual triage preserves stack topology rather than requiring a main rebase. |
| Missing local browser visibility | Quick verification records omitted browser coverage explicitly. Focused visual-review provides independent evidence without silently making every quick gate a full browser run. |
| Repeated fail-fast work | Independent static stages collect failures at bounded concurrency. Reuse is a conservative lint-only content/environment pilot; typecheck, guards and base CI remain uncached. |
| Fragmented failures | CI publishes exact commit/base/attempt, job/step results, bounded annotations, diagnostic groups, artifact links and explicit missing evidence. Required pass/fail semantics remain intact. |
| Dependency updates | Focused dependency-maintenance skill requires compatibility evidence and affected contracts; no broad dependency migration is bundled. |
| Setup versus test cost | CI diagnostic grouping separates setup and test failures; measure durations before adding shards or weakening setup guarantees. |
| Docs versus executable policy | Provider contract and command table point at implemented interfaces. Local smoke tests establish those interfaces, not hosted CI or production success. |

## Measurement protocol

Use the first observed task-state save as a start observation, not the historical beginning of
work. Successful verification can append a verified observation when task state exists. Import
hosted CI evidence with run/attempt identity so repeated imports cannot inflate failures or usage.
Missing state means automatic attribution is unavailable. Detailed token usage requires a source
and unique event ID; leave it absent when the host does not provide it.

Compare provider/task-class cohorts with sample sizes. Report first green, time to merge, repeated
failure classes and corrections separately from setup/test duration. Include parent and workers
when usage is available. Until those observations accumulate, the deliverable is reduced drift,
bounded retrieval and reproducible evidence—not a quantified efficiency gain.
