# Next steps: delight-first, agent-native Scuba

This is the execution plan after the booking foundation. It combines the product roadmap with the
engineering capabilities needed for many short-lived AI agents—across providers—to develop Scuba
safely, efficiently, and in parallel.

## North star

Scuba should feel calmer, faster, and more trustworthy than the software a dive shop uses today.
The product should remove pre-dive uncertainty for staff and divers, while the repository makes the
correct implementation path easier than an expedient wrong one.

Every meaningful increment must improve at least one of these outcomes:

1. **Less staff coordination work** — fewer calls, messages, duplicate entries, and manual checks.
2. **More diver confidence** — clear next actions, visible readiness, and reassuring confirmations.
3. **Safer departure** — missing requirements become obvious early and fail closed where needed.
4. **Faster agent delivery** — narrow context, deterministic tooling, and parallel work without collisions.

## What to pull from Sybaris

Sybaris has useful patterns from operating a larger AI-maintained application. Pull in the principles,
not all of its current machinery.

> Review grounding (2026-07-18): findings here are drawn from Sybaris's `AGENTS.md`,
> `docs/03-architecture.md`, `docs/13-agent-coordination.md`,
> `docs/archive/REVIEW-2026-07-02-ai-process-token-efficiency.md`, its 12-skill library, its
> schema/migration workflow, and its provider-seam implementations (`src/lib/ai/`, `payments/`,
> `legal/`, `notify()`). Same stack as Scuba (Next.js + Drizzle + Auth.js + PGlite in dev), so
> process lessons transfer directly; its scale (~424 doc files, 130+ ADRs) previews where our
> conventions break.

### Adopt now

- **Token-economical orientation.** Keep `AGENTS.md` short and telegraphic. Add explicit “do not read”
  guidance for generated/large files, prefer tests as compressed specifications, and document quiet
  test commands.
- **Provider-neutral source of truth.** `AGENTS.md`, `docs/`, tests, and scripts define the workflow.
  Provider-specific folders such as `.claude/` are adapters, not the only place a rule exists.
- **Focused local feedback.** Agents iterate with the narrowest useful test; one stable command owns the
  complete pre-merge gate. Successful commands should be quiet and failures diagnostic.
- **Collision-resistant decisions.** Stop allocating new sequential ADR numbers once parallel work starts.
  Use `YYYYMMDD-short-slug` ids, one file per decision, and validate ADR structure automatically.
- **PR-visible coordination.** Branch names and draft PR descriptions carry active scope and ownership.
  Do not use a branch-local reservation ledger that other pending branches cannot see.
- **Tests as durable memory.** New behavior includes happy-path and important failure-path tests in the
  same change. Bugs are regression-first. Safety invariants get adversarial tests.
- **Timestamped migration folders.** Drizzle v1 groups each migration SQL file and snapshot under a
  full UTC timestamp/name directory, removing the shared journal-file collision point. Existing
  migrations were converted with `drizzle-kit up`; serialized finalization (below) still applies if
  two branches alter the same schema surface.
- **Honesty and stop rules.** Report failing checks verbatim; state explicitly what could not be verified
  rather than implying it works. Three failed fix attempts on the same symptom → stop, write down what is
  known and ruled out, and re-diagnose instead of trying a fourth variation. These rules matter most for
  weaker models, which are most prone to thrash and optimistic summaries.

### Adopt with the first external integration (M3+)

The strongest structural idea in Sybaris: **every external capability lives behind a small interface in
`src/lib/<capability>/`, with a stub implementation shipped first**, selected by env var. Features stay
fully testable with zero infrastructure (the PGlite posture extended to vendors), vendor choice becomes a
config change plus an ADR instead of a refactor, and no vendor SDK or HTTP call ever appears outside the
seam directory. Zod-validate at every seam boundary. Record the pattern in an ADR with the first seam.

| Seam | Milestone | Shape |
| --- | --- | --- |
| `SignatureProvider` | M3 | create/verify a signature request; v1 draw-on-canvas + typed consent in-house, vendor API slots in later |
| `notify()` | first outbound notification | one function owns "something happened"; v1 writes in-app/console, an email provider slides in behind it without touching call sites |
| `PaymentProvider` | M7 | checkout/cancel/`parseWebhook` normalizing into one `applyBillingEvent()`; v1 stub treats everything as paid |

### Adopt as the repository grows

- **Sharded product documentation.** When the roadmap and domain model outgrow their current small files,
  create one source file per feature and entity. Generate any aggregate catalog locally; do not make a
  central compiled file a merge-conflict hotspot.
- **Integration-owned generated artifacts.** If concurrent schema work becomes common, move final migration
  generation to a serialized integration step. Do not build this before it solves a real collision.
- **Path-aware validation.** CI should run the smallest trustworthy set for a change, while preserving a
  required full gate before merge.

### Do not copy yet

- A large hierarchy of process docs, dozens of specialized skills, migration finalizer automation, or
  generated documentation catalogs. Scuba is still small. Complexity must earn its maintenance cost.
- Sybaris-specific product boundaries, legal workflows, deployment exceptions, and historical workarounds.

## Target architecture for agent development

### 1. One canonical workflow, many provider adapters

Canonical instructions live in provider-neutral locations:

- `AGENTS.md` — compact entry point, invariants, orientation, commands.
- `docs/` — product, architecture, domain, and durable decisions.
- `scripts/` — deterministic operations an agent should not improvise.
- tests — executable behavioral contracts.

Provider-specific configuration may point to or summarize those sources, but must not introduce unique
requirements. Add a test or script that detects duplicated provider instructions drifting from the
canonical rules.

Before changing the current skill layout, write an ADR comparing:

1. canonical skills under `.agents/skills/` with `.claude/` adapters;
2. canonical skills under `docs/engineering/playbooks/` with provider adapters;
3. keeping `.claude/skills/` canonical while generating adapters for other providers.

Prefer the option that requires the least duplicated text and works for agents that can only read files.

### 2. Task packets that minimize discovery

Add a small script, tentatively `pnpm task:context -- <area>`, that prints a bounded task packet:

- relevant docs and ADRs;
- route/service/schema ownership map;
- related tests;
- invariants and required reviewers;
- focused validation commands;
- files that should not be read.

The packet should contain paths and short summaries, not concatenate whole files. Start with areas:
`bookings`, `waivers`, `certifications`, `gear`, `manifests`, `design`, `database`, and `auth`.

This is the main mechanism for making lower-level models productive: they should not have to rediscover
where code lives or infer the quality bar.

### 3. Explicit module contracts

Keep routes thin and make each product capability own a clear vertical slice:

```text
src/features/<feature>/
  service.ts       # framework-free orchestration and domain rules
  queries.ts       # feature-specific persistence
  schema.ts        # validation schemas and typed inputs
  *.test.ts        # contract and failure-path tests
  README.md        # brief boundary/invariants only when needed
```

Shared primitives remain in `src/lib/`; database schema remains in `src/db/`. Do not perform a broad
reorganization now. Apply the shape to the next new feature, then migrate existing code only when touched.
An ADR is required before establishing this as the permanent layout.

### 4. Parallel work without accidental overlap

For non-trivial parallel work:

- choose a unique feature slug;
- create a branch using that slug;
- open a draft PR early;
- state owned paths, expected schema changes, and ADR ids in the PR description;
- split work by vertical slice or non-overlapping layer, not by vague subtasks;
- keep generated artifacts out of feature-agent ownership when serialization is required;
- trial-merge the target branch before declaring work complete.

A coordinator may assign work, but repository structure and automated checks—not coordinator intelligence—
should prevent most collisions.

### 5. Mechanical quality gates for weaker agents

Add automated checks in this order:

1. **Architecture boundaries:** prevent `src/lib/` or feature domain code from importing `src/app/`.
2. **ADR validation:** filename/id alignment, required sections, duplicate ids, valid status.
3. **Documentation links:** fail on broken internal links and missing indexed docs.
4. **Schema safety:** require tenant ownership where applicable; test booking/capacity invariants.
5. **UI constraints:** lint against raw colors and unsupported design-token usage.
6. **Changed-surface evidence:** UI changes require screenshot artifacts or an explicit no-visual-change marker.
7. **Feature completeness:** templates/checks prompt for tests, docs, empty/loading/error states, and analytics
   events where relevant.

`pnpm check` remains the simple local bar. Add `pnpm check:full` only when it provides a clearly different,
merge-level gate. Commands should print a one-line success summary and detailed actionable failures.

## Product sequence

Engineering work should support the next product slice rather than becoming an isolated platform project.

### Phase A — harden the development loop

Complete before or alongside the first waiver vertical slice:

- add token-economy and provider-neutrality rules to `AGENTS.md`;
- adopt collision-resistant ids for new ADRs;
- add ADR/document-link/architecture-boundary validation;
- define draft-PR coordination conventions;
- add the first bounded task packets (`waivers`, `design`, `database`);
- ensure the screenshot command produces predictable route/device/theme output and useful failure messages.

Success: a fresh agent can locate, implement, test, visually inspect, and summarize a small change without
reading the whole repository or inventing a workflow.

### Phase B — M3 waivers as a complete delightful slice

Build one end-to-end pre-arrival flow:

1. staff selects or creates a versioned waiver template;
2. a booking receives a secure, expiring completion link;
3. the diver completes identity confirmation, acknowledgements, medical questions, and signature;
4. referral-triggering medical answers fail closed and clearly explain the next step;
5. staff sees readiness, blockers, timestamps, and the signed record;
6. edits create a new immutable version rather than rewriting signed history.

Delight requirements:

- resumable mobile-first flow;
- progress expressed in meaningful steps, not a generic spinner;
- plain-language reassurance about why information is requested;
- confirmation that says exactly what is complete and what remains;
- staff exception handling without losing audit history;
- polished empty, expired-link, already-completed, validation, and unavailable states.

Architecture requirements:

- framework-free waiver state transitions and medical blocking rules;
- immutable signed artifact metadata;
- idempotent submission;
- explicit authorization and tenant scoping;
- adversarial tests for tampering, stale template versions, duplicate submission, and blocked medical state;
- an ADR for signature storage/retention and any external service.

### Phase C — M4 certification checks and unified readiness

Create a reusable requirement/readiness model rather than hard-coding waiver and certification status into
each screen.

- capture certification agency, level, identifier, expiry, and card images;
- define trip/site requirements separately from the diver’s evidence;
- support verified, pending, rejected, expired, and insufficient states;
- calculate a typed readiness result with human-readable reasons;
- expose the same result to staff roster, diver confirmation, and later manifest views.

The readiness service becomes a safety boundary. It must fail closed for unknown required evidence and have
table-driven tests covering every state combination.

### Phase D — M5 gear with operational delight

- inventory by gear type, size, state, and service status;
- diver sizing/preferences and booking-level requests;
- conflict-aware assignment with clear alternatives;
- fast bulk assignment for staff;
- service holds that cannot be overridden accidentally;
- packing/return views designed around real shop workflows.

Use constraint logic in tested domain services. Keep drag-and-drop or other rich UI as an optional layer over
accessible, explicit actions.

### Phase E — M6 manifest and roll call

Treat this as a dedicated safety project:

- derive the manifest from bookings, assignments, waiver/cert readiness, and crew;
- large sunlight-readable roll-call mode;
- offline-tolerant cached snapshot with explicit freshness and reconciliation status;
- no silent disappearance of divers when data is incomplete;
- print/PDF export from the same manifest model;
- incident-resistant audit trail for boarded/not-boarded changes.

Require a threat/failure-mode review, domain review, offline ADR, adversarial tests, and field testing on a
phone outdoors before calling the milestone complete.

## Delight backlog across every phase

Apply these continuously rather than postponing them to “polish”:

- global command/search for staff once there are enough entities to justify it;
- keyboard-first staff workflows with visible shortcuts;
- optimistic interaction only where rollback is safe and obvious;
- undo for reversible staff actions instead of confirmation dialogs everywhere;
- activity history written in operational language;
- saved filters/views for common shop roles;
- thoughtful demo data that tells a realistic story;
- accessible motion, contrast, focus, and touch targets;
- performance budgets for staff pages on ordinary phones and weak marina Wi-Fi;
- event instrumentation for abandonment, blocker frequency, and staff recovery paths.

## Prioritized implementation queue

### P0 — next

1. ~~Add agent-efficiency rules and collision-resistant ADR policy.~~ Shipped 2026-07-18 (AGENTS.md
   Context economy + Parallel work sections; ADR template/README updated).
2. ~~Add architecture-boundary, ADR-format, and docs-link checks.~~ Shipped 2026-07-18
   (`scripts/check-architecture.mjs`, `check-adrs.mjs`, `check-doc-links.mjs` via `pnpm check:repo`).
3. ~~Add `task:context` for waivers/design/database.~~ Shipped 2026-07-18 (`scripts/task-context.mjs`).
4. ~~Move migrations to Drizzle v1 timestamped folders.~~ Shipped 2026-07-18 (`drizzle-kit up`,
   [Drizzle v1 ADR](../architecture/decisions/20260718-drizzle-v1-beta.md)).
5. ~~Write the waiver data model and signature/retention ADR — establishing the `SignatureProvider` seam.~~
   Shipped 2026-07-18 (`src/lib/signatures.ts`,
   [20260718-waiver-signature-retention](../architecture/decisions/20260718-waiver-signature-retention.md)).
6. ~~Ship the smallest complete waiver vertical slice with a polished diver confirmation and staff status.~~
   Shipped 2026-07-18 (versioned templates, expiring token-hash links, resumable typed-consent flow,
   medical-review blocker, immutable evidence, and adversarial contracts).

### P1 — after the first waiver slice

1. ~~Add a staff-facing waiver activity timeline.~~ Shipped 2026-07-18 (`waiverActivityTimeline`;
   issued, started, signed, medically blocked, and replaced-link history on the staff trip roster).
   A richer, jurisdiction-specific medical questionnaire remains legal/policy follow-up. Versioning,
   referral, expiry, saved progress, and immutable signed evidence shipped in the first slice.
2. ~~Introduce the generic readiness result while designing certification checks.~~ Shipped
   2026-07-18 (`src/lib/readiness.ts`; shared by staff trip, diver confirmation, and future manifest work).
3. Add provider adapters or generated skill indexes based on the provider-neutral workflow ADR.
4. Add path-aware CI and changed-UI evidence enforcement.
5. Create realistic seeded scenarios and visual regression coverage for critical states.

### P2 — when parallelism or scale proves the need

1. Shard feature/entity docs and generate optional aggregates.
2. Serialize migration finalization if concurrent schema PRs collide repeatedly.
3. Introduce feature-folder boundaries incrementally.
4. Add a machine-readable task manifest for external orchestrators.
5. Add automated PR scope/collision warnings based on changed paths and declared ownership.

## Definition of done for a feature

A feature is done only when:

- the browser demonstrates a complete user outcome, including important failure states;
- the implementation follows documented module boundaries and tenant/auth rules;
- unit/integration tests pin domain behavior and one E2E path proves the user flow;
- safety-sensitive rules have adversarial tests and fail closed;
- light/dark and phone/desktop screenshots were inspected for UI changes;
- relevant docs, glossary entries, task packets, and ADRs are current;
- focused checks and `pnpm check` pass;
- the branch merges cleanly with its target;
- the PR summary states what changed, evidence collected, residual risks, and follow-up work.

## Measures

Track a small set of measures so “delight” and “agent efficiency” remain concrete:

- median time for staff to resolve a booking blocker;
- waiver completion rate before arrival and median completion time;
- percentage of departures with all readiness checks complete before the day of the trip;
- agent time from task start to first relevant test;
- tokens/files read before first code change (sampled, not exhaustively instrumented);
- PR rework caused by missed invariants, architecture drift, or merge collisions;
- escaped defects in safety-critical flows.

Review this document after M3’s first complete slice. Promote hard-to-reverse choices into ADRs; move shipped
items into the roadmap rather than allowing this plan to become an unbounded second backlog.
