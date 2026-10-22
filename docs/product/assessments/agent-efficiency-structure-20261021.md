# Agent efficiency: code structure and measurement evidence

Assessment date: 2026-10-21. Checkout: `971c490d4ba1e863a3fb4e5a7ced4d5e94dd4522`.
This is a research appendix, not a refactoring mandate. Counts include tests unless stated.

## Inventory

Tracked `.ts`, `.tsx`, `.mjs`, and `.md` files, measured with `git ls-files` and newline counts:

| Area | Files | Lines | Files over 800 lines |
| --- | ---: | ---: | ---: |
| `src/app` | 1,832 | 291,085 | 20 |
| `src/components` | 371 | 61,807 | 8 |
| `src/db` | 832 | 323,771 | 98 |
| `src/lib` | 860 | 180,823 | 32 |
| `src/features` | 45 | 7,254 | 0 |
| `src/i18n` | 118 | 13,833 | 2 |
| `scripts` | 335 | 82,351 | 10 |
| `e2e` | 152 | 50,673 | 10 |
| `docs` | 650 | 85,419 | 8 |

These are navigation-size measures, not complexity scores or production-code LOC. JSON,
images, generated migrations, dependencies, and other extensions are excluded. The 800-line
threshold is descriptive; the repository's whole-file read threshold is 900 lines.

`node scripts/agent-health.mjs` reported 44 skills, five reviewer agents, 63 `check-*` guard
scripts with adjacent tests, 110/111 routes with visual coverage, and 62/111 with axe coverage.
The 63 scripts are not the same population as the 61 checks in the `check:repo` orchestration.
The architecture check passed with 14 ratcheted violations across nine files. Passing means no
new violation; it does not mean the existing dependency exceptions disappeared.

## S1. Reduce the reading footprint of high-change domain files

Examples:

| File | Lines | Natural responsibilities visible in its symbols |
| --- | ---: | --- |
| [bookings.ts](../../../src/db/bookings.ts) | 4,144 | Creation and parties, admission, movement/restoration, participant changes, cancellation, diver details, identity confirmation/splitting |
| [anonymize.ts](../../../src/db/anonymize.ts) | 2,978 | Erasure orchestrator plus many domain-specific scrubbers |
| [orders.ts](../../../src/db/orders.ts) | 2,767 | Order creation/issue, counter settlement, ledger queries, provider event application |
| [manifests.ts](../../../src/db/manifests.ts) | 2,382 | Checkpoint queries, manifest assembly, diver and crew writes, offline reconciliation |
| [notifications/kinds.ts](../../../src/lib/notifications/kinds.ts) | 2,304 | Notification-kind definitions |
| [form.tsx](../../../src/components/ui/form.tsx) | 1,203 | Shared field/control implementation |

The existing [size guard](../../../scripts/check-page-length.mjs), lines 90–95, limits source
file size for app/components and test files throughout `src`; it does not apply the source-file
limit to db/lib. The function guard covers those areas, so this is an asymmetry, not an absence
of all size protection.

Recommendation: split a high-change module along its existing responsibilities when the next
task touches it. Keep the public import stable through a barrel, following the existing trips
pattern. Keep transaction ownership and lock ordering explicit. Do not split a transaction into
independently committed operations just to meet a line budget. In erasure, preserve one visible
orchestrator and the existing coverage assertions. Safety reviews remain required.

Success is fewer symbols and files needed to change one behavior, unchanged interface behavior,
and less repeated reading. A broad move into `src/features` is not justified by these counts.
The four current feature modules already demonstrate useful interfaces without a repository-wide
migration: backup export, calendar sync, integrations, and recap after-state.

## S2. Shared edit hotspots are a measurable source of coordination work

A local-history query counted path appearances in reachable non-merge commits since 2026-10-07:

| Path | Appearances |
| --- | ---: |
| `scripts/ratchets.json` | 220 |
| `src/i18n/locales/es-ES/diver.json` | 167 |
| `src/i18n/locales/en-US/diver.json` | 158 |
| `e2e/visual.spec.ts` | 134 |
| `src/db/__snapshots__/export-bundle.shop.snap` | 118 |
| `src/i18n/locales/es-ES/staff/trips.json` | 101 |
| `src/i18n/locales/en-US/staff/trips.json` | 98 |
| `src/lib/notifications/kinds.ts` | 67 |
| `src/db/bookings.ts` | 67 |

Method: `git log --since=2026-10-07 --no-merges --format= --name-only -- src scripts e2e`,
then count nonempty path rows. Branch and squash commits can both be reachable, so these are
neither unique changes nor PR counts. They identify likely coordination hotspots; they do not
measure merge-conflict frequency or prove that a particular file caused a delay.

Prioritize partitioning the 10,304-line visual spec into domain capture modules, and consider
domain partitions for diver copy and ratchet storage. Preserve generated aggregation and one
canonical reader interface. Splitting a file is useful only if independent tasks stop editing
the same partition. Adding another hand-maintained registry would defeat the purpose.

The global stacking policy partly compensates for these shared files. Reduce avoidable shared
edits before judging whether that policy itself should change. Any change to the user's explicit
stacking policy is a decision, not an audit-time implementation.

## S3. Authoritative architecture guidance has semantic drift

[Architecture overview](../../architecture/overview.md), lines 39–40 and 63–65, still describes
`schema.ts`, components "when it exists," and feature modules as proven on one feature.
The current route map points to `src/db/schema/`, hundreds of component files exist, and there
are four feature modules.

More materially, lines 84–85 say a migrate-once template database is a future proposal.
[db-template.ts](../../../src/test/db-template.ts), lines 13–20 and 91 onward, already builds
reusable snapshots; [db.ts](../../../src/test/db.ts), lines 160–275, provides a file-scoped
database with per-test rollback. [Testing documentation](../../engineering/testing.md),
"The test database is a snapshot, not a boot," describes the implemented mechanism.

An agent reading the architecture document first can reject the implemented test optimization
or propose it again. Internal links all passed before the audit (713 Markdown files checked);
link validity cannot detect stale meaning. Fix the overview and attach narrow behavioral
assertions to prescriptive facts that can be derived from code. Historical rationale should be
dated and distinguish its decision from the current mechanism.

## S4. Use existing successful centralization as the pattern

[seat-diver.ts](../../../src/db/seat-diver.ts), lines 32–46, explains an actual recurring
failure: five entry points repeated booking consequences, and some omitted waiver delivery or
activity recording. `seatDiver` gives callers one consequence path with explicit variation.
This is more effective than reminding every future agent to remember four side effects.

[recap-after-state](../../../src/features/recap-after-state/README.md) similarly documents one
assembler, its two callers, what it owns, and what remains in db/auth/copy. The architecture
guard prevents callers from reaching into its private implementation.

Apply that pattern where evidence shows repeated omissions: one operation owns required side
effects; one UI recipe owns a repeated interaction; one validator owns a rule. Avoid creating
wrappers that merely rename a call and add another file to read.

## S5. Test setup has a possible optimization target, not a measured bottleneck

[inputsFingerprint](../../../src/test/db-template.ts), lines 45–65, hashes all non-test files
under `drizzle`, `src/db`, and `src/content`, plus the frozen clock. A query-only db edit therefore
invalidates snapshots even when the seed inputs did not change. This is intentionally conservative.

Instrument fingerprint time, snapshot rebuild frequency, and rebuild duration first. If material,
derive an exact seed/migration dependency closure and test invalidation comprehensively, including
dependencies outside these directories and relevant tool versions. Do not narrow the cache key
using guessed filename patterns. Current snapshot hydration and atomic publishing already solve
large costs; claiming they are missing would repeat the repository's documentation mistake.

## S6. Measure outcomes rather than instruction volume

Current health tooling measures context words, guard test presence, and route coverage. It does
not establish tokens per accepted change, first-pass CI rate, total time to merge, repeat failure
rate, or visual rework. Repository-local context accounting also omits injected personal/plugin
instructions and provider-specific prompt behavior.

Add a small delivery record keyed by commit and PR: task class, provider, base SHA, selected
checks, time spent executing/queued/repairing, first failure signature, retry count, and visual
review outcome. Use provider usage data only if actually available; distinguish cached input,
uncached input, output, and cost. Do not estimate spend from a word-count heuristic.

Run comparisons within task classes and report sample sizes. A copy change, booking transaction,
and schema/export change have different legitimate verification costs. Track total tokens across
parent and workers; cheaper-looking parent transcripts can hide duplicated delegated context.

## Verification and limits

Executed successfully: agent health, architecture guard, task-context listing, and baseline
documentation link check. Inventory and change-frequency measurements came from tracked files
and local history. No runtime behavior, production data, or dependency installation was changed.
This appendix is a structural audit, not a line-by-line correctness or security review.
