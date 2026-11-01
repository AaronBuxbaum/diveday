# DiveDay performance and cost assessment — 2026-10-21

**Recommendation:** improve work bounding, completion guarantees, and measurement before changing
hosting providers. The code already contains substantial performance engineering. The best next
investments remove repeated work and prevent slow providers or growing datasets from exhausting
request budgets. A cloud migration is not justified by the evidence collected here.

**Snapshot:** `35333db0338259eff8e93d1686e5cc5702c708c6`, clean detached checkout at audit start.
The assessment itself changed no runtime behavior, deployment, database, or vendor plan. Its findings
describe that snapshot. Aaron subsequently authorized the highest-priority map and retention fixes;
their implementation status is recorded below. Other priorities remain recommendations.

Read the [executive findings](#executive-findings), [implementation sequence](#prioritized-implementation-sequence)
and [cost model](#cost-model-and-business-impact) first. Detailed evidence follows for
[database/background work](#database-and-background-work), [frontend](#frontend-and-device-work),
[infrastructure](#infrastructure-cost-controls-and-delivery) and
[providers/cleanup](#additional-provider-and-maintainability-findings). The
[measurement plan](#measurement-and-acceptance-plan) and
[handoff](#existing-work-handoff-and-verification-record) close the assessment.

## Implementation status — 2026-10-21

| Finding | Status | Evidence and remaining limit |
| --- | --- | --- |
| FE-05: unsafe map HTML | [PR #2872](https://github.com/AaronBuxbaum/diveday/pull/2872) merged | Safe DOM construction and permitted link protocols; focused browser/unit checks and CI passed. |
| DB-05: dietary retention | [PR #2874](https://github.com/AaronBuxbaum/diveday/pull/2874) merged | Independent daily bounded cleanup, actual update counts, and incomplete/failure signals. Final CI: 36 successful checks, four expected skips; PostgreSQL: 85 tests, no skips. |
| DB-04: weekly retention budget and progress | [PR #2897](https://github.com/AaronBuxbaum/diveday/pull/2897) merged and validated; deployment not verified | Validated weekly head `0ee5dc5fc99639b97576f30de4395ec9113e80f4`: 40 terminal checks, 34 successful and six expected skips, no pending/failures. Hosted PostgreSQL passed 96 tests across 32 files with zero skips, including all five weekly concurrency cases. All 1,069 visual captures match the 1,069-image baseline; zero changed/new/deleted. Zero review threads. The earlier 159 focused tests passed; the historical broad local gate failed. |
| Mutation-time retention eligibility | [PR #2905](https://github.com/AaronBuxbaum/diveday/pull/2905) merged and validated; deployment not verified | Head `1df8a5ad`, based on weekly `0ee5dc5f`, changes four files. All test CI is green: 34 successful checks and four expected skips. Hosted PostgreSQL passed 98 tests across 32 files with zero skips, including all seven retention concurrency, legal-hold and overlap cases. All 1,069 fresh visual captures match the baseline. Zero review threads. DELETE repeats eligibility and counts returned rows. |

PRs #2897 and #2905 merged at 00:25:59 and 00:26:00 UTC respectively.
Both report merge commit `dd446fbf3326b9532b8607b65d264693a78808c6`. Fetched `main` has tree
`d862915b2268645f688bdeeeae136ef9036f85e1`, identical to validated eligibility head `1df8a5ad`.
Earlier runs were superseded; the completed hosted results above identify each validated head.

An inherited combined library/catalog accessibility test timed out on `e8b7fa86` after 8.03s of
setup, despite passing both scans and size assertions. The source-only split preserves all
assertions and the 15-second limit; current hosted replay passed library in 10.633s and catalog in
11.517s, both with retry 0 ([#2904](https://github.com/AaronBuxbaum/diveday/issues/2904)).

Both retention layers are merged and validated. Production deployment remains unverified. The UX
coordinator received the canonical main handoff and can continue. During earlier validation, a photo-action unit test
unnecessarily initialized a real database although every data operation was mocked. An isolated test-only correction preserved all
five behavior assertions and reduced the first focused case from 7,306 ms to 16 ms; these are local
observations, not production performance claims. The broad gate's shared-load timeouts and subsequent
focused passes are retained as evidence, not represented as a successful gate.

Aaron explicitly requested no further broad local testing across the running chats because the
computer has limited power. The published map-parent integration therefore used only source
inspection and lightweight generation, format and diff checks; no further broad gate, build, browser
or local PostgreSQL run was performed. Hosted CI is the final validation; its current-head results
are recorded above.

An unrelated certification-extension CI stall remains tracked in
[#2878](https://github.com/AaronBuxbaum/diveday/issues/2878). Its single test is quarantined through
October 28 and remains selected for nightly execution, with the missing full-Chromium prerequisite
added. The actual scheduled nightly run and production deployment of the merged changes have not
been verified. No dollar savings or production latency improvement is claimed from these fixes.

## Executive findings

The most important findings are:

1. **Backups can repeatedly miss newer shops.** The weekly platform export starts with the oldest
   shop every time and skips the remainder after 240 seconds. It reports incomplete coverage but
   does not resume. A larger estate can repeatedly protect the same prefix of shops (DB-01).
2. **Retention can exceed its deadline, and dietary notes bypass backlog reporting.** The deadline
   is checked after a whole round of tables. Dietary-note clearing takes only one 5,000-row batch
   per weekly run and cannot report itself as capped or failed in the summary (DB-04/05).
3. **Integration drain arithmetic does not fit its invocation.** Fifty sequential calls with a
   15-second timeout can require 750 seconds in a 300-second function, before database work (DB-06).
4. **Large exports hold the complete dataset, photos, CSVs and compressed output in memory.** Photo
   fetching starts all unique managed photos concurrently. Dataset growth raises memory, sockets,
   CPU and bandwidth together (DB-02).
5. **The cost report gives false confidence.** With an empty configuration, it still emits a
   historical monthly range and says AWS budgets are deployed. Its architecture and vendor-model
   assumptions have drifted (INF-01). Actual current monthly spend remains unknown.
6. **Plan-relative quota protection is missing.** The Neon warning is 120 CU-hours against an
   owner-chosen 300-hour budget; the currently published Free allowance is 100 hours per project.
   This is a risk if that is the production plan, which was not verified (INF-02).
7. **Staff devices repeat substantial unchanged work.** Whole-board offline priming repeats per
   tab, while per-trip polling, SSE invalidations and visible-page refresh add overlapping work.
   Coordinate and measure these paths without weakening freshness (FE-01/02/03/10).
8. **Map selections leak shop markers.** Each selection effect creates a new anchor without
   removing the previous anchor and rebuilds all site markers (FE-04).
9. **The map also has a security defect.** Persisted names enter Leaflet HTML without escaping.
   Independent review traced the staff write/read path. Browser exploitation was not executed
   (FE-05). This deserves its own focused fix, not a hidden performance refactor.
10. **Performance measurement misses important regressions.** Bundle gating measures only the
    intersection of route chunks; vitals stop after the first background transition; non-render
    jobs lack uniform query-cost scopes (FE-06/07, INF-05).

The first backend efficiency changes should be count-only export metadata, recap filtering before
hydration, and sharing digest reads. These eliminate demonstrably repeated work. Broad caching,
larger pools, reduced safety checks, and a new queue/realtime provider should not be the first moves.

## How to read this report

- **Confirmed** means the implementation or a dependency-free execution establishes the behavior.
  It does not mean an outage, privacy incident, or cost overrun was observed in production.
- **Conditional** means the failure needs a stated volume, provider delay, plan, or configuration.
- **Opportunity/hypothesis** means a plausible improvement with a measurement or design gate.
- **P1:** resolve correctness/reliability risks or establish the missing control before meaningful
  growth. It does not imply an active incident. **P2:** targeted next optimization.
  **P3:** lower-value cleanup or measurement-led experiment.
- **S/M/L effort** is relative scope, not a delivery-date promise. Schema, export, payment, medical,
  readiness and offline changes need the repository's required reviews and adversarial tests.

Each detailed entry supplies source evidence, the triggering workload, an approach, tradeoffs and
validation. Source line numbers refer to the snapshot above and will drift after changes.

## Scope, method and limitations

Three research passes examined database/backend, frontend/device behavior, and infrastructure/CI.
The coordinating pass checked notifications, provider boundaries, weather, rate limiting, configuration
and architecture cleanup; reconciled current GitHub issues; and independently checked the major
findings. A separate security review checked the map input path and dietary retention.

The tracked repository inventory is 8,190 files, including 4,406 under `src`, 353 under `scripts`,
23 under `infra`, 150 under `e2e`, and 14 under `extension`. The source includes 1,729 test files,
111 app pages and 62 API route handlers. Public assets total about 33.4 MB across 1,867 files.
These are repository counts/bytes, **not shipped JavaScript, transfer sizes, coverage percentages,
or proof that every line was reviewed**. Generated migration contents were not bulk-read.

| Area | Work examined | Confidence boundary |
| --- | --- | --- |
| Database | Client/pool, query helpers, schema/index patterns, Today/readiness, reporting, export/import, retention | Source and test contracts; no production EXPLAIN or row statistics |
| Background work | All 16 Vercel cron definitions; detailed backups, retention, integrations, recaps, digests and reminders | Source control flow; no live job duration distribution |
| Frontend | Root/staff/public composition, caching boundaries, JS budget, images/fonts/maps, schedule/list bounds, offline/SSE, telemetry | No production build, heap profile, device soak or browser exploit |
| Providers | Payments deadlines/idempotency, SMS/WhatsApp, weather, rate limiting, usage probes | Source and selected current official documentation; accounts not inspected |
| Infrastructure | Main/global/email stacks, storage/lifecycles, external health, observability, budget declarations | Declarations do not prove deployed resources |
| Delivery cost | CI job graph, build reuse, sharding, nightly work, existing test-cost issues | No live runner-minute or invoice reconciliation |
| Extension | Permissions and one-shot request/message lifecycle inventory | No agency account session; no specific new performance finding |
| Product/cleanup | Existing decisions, issue queue, architecture ratchet and dead configuration claims | No wholesale UX, legal, dive-safety or financial certification |

No production credentials, personal data, billing invoices, database contents or load tests were used.
The dependency tree was unavailable: `pnpm task:context` triggered an automatic installation that
failed DNS and was stopped. Context scripts were then run directly with Node. Vitest modules could
not load; no application tests, build, CDK synthesis or runtime benchmark is claimed. The bundled
Next.js guides were unavailable, so framework-boundary changes remain explicitly experimental.

Dependency-free checks completed:

- Documentation links passed before and after report creation.
- Architecture guard passed its ratchet, reporting **14 existing violations in 9 files**.
- Empty-environment execution reproduced the misleading cost report.
- Gate report ran locally; its initial network-dependent claims section could not read GitHub.
  Subsequent REST reads succeeded and returned **no open PRs**; issues were reconciled separately.
- Two test-module attempts could not load `vitest`; this is an environment limitation, not evidence
  of failing application assertions. No full-suite success is implied.

## Prioritized implementation sequence

| Order | Scope | Why first | Completion evidence |
| --- | --- | --- | --- |
| 1 | FE-05 map HTML; DB-05 dietary retention | Concrete security/privacy defects | Literal hostile-shaped names; 5,001-note backlog and injected failure tests |
| 2 | DB-01/04/06 progress and deadlines; OPS-01 limiter deadline | Prevent incomplete work and runaway waits | Repeated deadline-limited passes make fair progress; stalled transport resolves within budget |
| 3 | INF-01/02 and FE-07 trustworthy measurement | Decisions otherwise use misleading denominators or incomplete samples | Unknowns remain unknown; plan/project quotas and resumed sessions tested |
| 4 | FE-04, DB-03/07/09 | Direct wasted-work reductions with small behavioral scope | Constant marker layers; equivalent output with fewer queries/rows |
| 5 | DB-02 export limits; FE-01/02 coordination | Large resource multipliers | Bounded RSS/fan-out and fewer requests at unchanged freshness |
| 6 | INF-05, FE-06/08, OPS-02/03 | Unit economics and representative performance | Per-operation measurements, per-route budgets, SMS/provider reconciliation |
| 7 | DB-10/11/13, INF-04/07, FE-11, OPS-04/05 | Targeted follow-on efficiency and cleanup | Workload-specific benchmark, preserved contracts and lower maintenance burden |
| 8 | Realtime migration, distributed weather cache, asynchronous streaming exports | Larger designs only where justified | Measured break-even and capacity trigger, reviewed ADR |

Related items can share discovery, but each implementation should have a small acceptance contract.
For example, retention progress and dietary reporting belong together; a map security fix and marker
ownership may share a file but need separate regression assertions. Do not turn this into one giant
performance PR.

## Cost model and business impact

A defensible monthly total requires current invoices, plan/resource identities and a common billing
period. The existing $63.55–$83.55 figure is historical/static and is deliberately **not** repeated as
current spend. A low bill today also does not prove capacity for the next ten shops.

Track these units before assigning savings:

| Unit | Primary drivers | What to measure |
| --- | --- | --- |
| Active shop-month | Fixed support/platform allocation, database awake time, jobs | Active shops; fixed versus marginal spend; empty versus useful work |
| Completed booking | SQL/transaction time, Stripe attempts, notifications | Successful/failed attempts; lock duration; message/provider calls |
| Staff-hour | Page refreshes, offline board fetches, stream reconnects, telemetry | Visible/hidden tabs; bytes; renders; DB time; useful changes |
| Export GiB | Full data/photo download, compression, uploads and storage copies | RSS, CPU, bytes fetched/uploaded, artifact size, duration |
| Reminder delivered | Candidate scans, hydration, retries, channel and segment count | Candidates/skips/sends, delivery outcome, provider cost attribution |
| Green change | Runner setup/build/test time, visual PUTs, preview builds, agent effort | CI duration and billed minutes; artifacts/requests; repeated failed work |

Illustrative workload arithmetic, **not observed production usage**:

- Offline board timers: `tabs × active timer hours × 12` reads, before browser suspension and other
  triggers. Three tabs over eight hours configure 288 reads. Three-to-one cross-tab coalescing could
  remove up to two-thirds of that timer component, not two-thirds of the whole database bill.
- Visible one-minute refresh: at most 480 interval renders during an eligible eight-hour session;
  typing/tap suppression reduces the actual number.
- SSE retirement: `4 hours × 3600 / 242` is about 60 stream opens per live tab; connection packing,
  memory and active CPU determine billing, not simply viewer-hours.
- Slow integration batch: `50 × 15s = 750s`, versus a 300s invocation. Deadline correctness is useful
  even with zero paying shops and does not depend on pricing assumptions.
- Full weekly backups: annual retained bytes scale approximately with the sum of all weekly bundle
  sizes; for a constant size B, roughly `52 × B` each year, before versioning and tier charges.
- A RUM sampling change from 1 to p reduces expected sampled sessions by roughly `1-p`; fixed fees,
  other telemetry and event mixes keep that from being an equal percentage of the total bill.

For each optimization, compute net savings as avoided measured usage times the applicable rate,
minus new service costs and ongoing support. Compare that with engineering/review time. Small exact
wins are worthwhile; an expensive migration to save an unverified small monthly amount is not.

## Database and background work

## Scope and useful existing work

Reviewed database initialization/pooling, query helpers, paging/search/index guards, core schema
indexes, Today/readiness/manifest query assembly, reporting, export/import, retention, backup
runners, reminder/recap sweeps, weekly digests, integration dispatch, and query instrumentation.
Read the tests for query budgets, staff render cost, retention budgets/dietary notes, export,
backup runners, integration delivery, reporting, search indexes, and people foreign-key indexes.
This was a broad systems review plus targeted tracing, not line-by-line certification of every
DB method or every business invariant.

Existing safeguards worth preserving:

- `src/db/query-budgets.test.ts:38-137` protects batched readiness, constant-query paged orders,
  and a Today statement ceiling. `src/db/staff-render-cost.test.ts:551-718` additionally pins
  gate/chrome/Today/trip/public-trip/ready counts and phase ceilings. These are ceilings, not
  current measurements; Today is allowed 74 statements in that test and the trip render 68.
- `src/db/query-helpers.ts:30-37` runs query fan-out concurrently on a pool and sequentially in
  transactions. Do not replace it with indiscriminate `Promise.all`.
- `src/lib/db-pool-config.ts:36-81` already selects a 10-client Neon pooler pool versus five
  direct clients, with idle/connect timeouts. `src/db/client.ts:39-44,85-118` memoizes startup,
  clears failed initialization, and closes failed production pools.
- `src/db/dev-bootstrap.ts:33-71` already avoids repeated seeding with one indexed existence
  query; the seed graph is dynamically imported. A proposal to eliminate unconditional full
  seeding would be obsolete.
- `src/db/lock-bounds.ts:28-31` bounds seat/money lock waits to five seconds. Capacity locks and
  readiness freshness must survive any performance change.
- `src/db/search-indexes.test.ts:14-100` checks trigram coverage and the phone expression index;
  `src/db/schema/trips.ts:660-695` includes cross-shop cron time-window indexes. Do not call
  wildcard search or reminder windows universally unindexed.
- `src/db/people-fk-indexes.test.ts:14-69` deliberately indexes high-volume person FKs and
  ratchets others. Its 113 ceiling is a documented write-cost tradeoff, not 113 proven missing
  indexes to add blindly.
- Export reads use a read-only repeatable-read transaction (`src/db/export.ts:114-144`), while
  import fetches remote evidence before its transaction and bounds fetch concurrency
  (`src/db/import.ts:117-151`). Keep both properties.
- Backups have deterministic object keys, outcome reporting, a census, and an independent
  watchdog. Integration dispatch has an atomic claim, idempotency, retry caps, stale-processing
  recovery, provider timeouts, and first-attempt dispatch after writes. These mechanisms exist.

## Findings

### DB-01 — Platform backup has no progress checkpoint and can starve later shops (P1)

**Confirmed code; impact conditional on total estate backup time.**
`src/features/backup-export/platform-backup.ts:94-103` lists all real shops in ascending
`createdAt,id` order. `src/app/api/cron/platform-backup/route.ts:120-124` skips all remaining
shops once 240 seconds pass; it never persists a cursor, per-period completed set, or resume
job. Each weekly run starts again at the beginning. If the first shops consistently consume
240 seconds, newer shops can miss every logical backup. The census/watchdog detects the
short run; it does not cause the missed shops to run. This is not an assertion that all backup
protection disappears: provider recovery remains a separate layer.

**Change:** record a per-shop/per-period job with status and lease, resume unfinished work,
then publish aggregate completion. Prefer reusing the existing database job/outbox patterns
before adding a queue service. A small first step is oldest-success-first scheduling plus a
persisted continuation; a durable worker is the robust larger-estate design. Verify repeated
forced-deadline runs eventually back up every shop, including one slow and one failing shop.
Compare last successful backup age per shop, not just latest bucket write. Effort M.

### DB-02 — Export/backup memory and photo fan-out are unbounded (P1)

**Confirmed code; resource failure threshold needs measurement.**
`src/db/export.ts:273` and its table readers materialize the whole shop.
`src/features/backup-export/bundle.ts:53-79` retains bundle input, all photo bytes, generated
files, and the zip result. `src/lib/export.ts:430-435` synchronously compresses everything
with `zipSync`. `src/lib/export.ts:467-485` launches a fetch for every unique managed photo
in one `Promise.all` and reads each full `arrayBuffer`. The ten-second per-photo timeout
bounds individual waits, not simultaneous sockets, total bytes, or peak RSS. Photo growth
therefore increases memory, bandwidth, compression CPU, and request failure risk together.
Already-compressed image files also deserve a compression-level comparison.

**Change:** first cap concurrent fetches, enforce explicit total-size/resource budgets, and
measure peak RSS/time/bytes using realistic photo-heavy shops. Then make large exports durable
asynchronous artifacts using streamed CSV/zip generation and multipart upload, while preserving
relational snapshot semantics and download authorization. Incremental object reuse can reduce
weekly photo egress, but must retain portable, recoverable bundles and erasure semantics.
Do not merely raise function memory/time. Verify large history, slow/failing images, and
concurrent exports. Effort S for fetch limits, L for streaming snapshot job.

### DB-03 — Settings counts sometimes build the entire export (P2)

**Confirmed code.** `src/db/export.ts:1165-1187` promises counts without data materialization,
but any shop with a rehearsal trip takes `loadShopExportBundleInput` and counts the resulting
tables' rows. A shop that used rehearsal functionality makes a metadata/settings request
scale with all retained customer, transaction, and operational data. No photo fetch occurs in
this path, but the DB reads and in-memory CSV input assembly still occur. The ordinary branch
also awaits numerous counts one by one (`src/db/export.ts:1190` onward).

**Change:** reuse the export scope/exclusion predicates in count-only SQL so rehearsals are
excluded identically without loading full rows. Batch or use limited concurrent independent
counts on a pool, avoiding an unrestricted hundred-query burst. Add query/row-volume tests
comparing rehearsal and non-rehearsal shops at growing history sizes. Effort M. Good first
backend optimization because it changes no exported data contract.

### DB-04 — Retention's deadline is checked after a whole round, not each batch (P1)

**Confirmed control flow; failure requires slow batch/large backlog.**
`src/db/retention.ts:448-456` runs every pending table's `pruneBatch` before checking the
45-second budget; the route ceiling is 60 seconds (`src/app/api/cron/retention/route.ts:17`).
If the budget expires on the first table, all remaining tables still execute. The documented
reserve for one in-flight batch is therefore not enforced. A killed run can lose its summary
and leave later tables unprocessed. Existing `retention.budget.test.ts` tests zero budget as
one complete round, which codifies this behavior rather than simulating slow batches.

**Change:** check elapsed time before starting each batch, record unvisited/capped tables,
and rotate/persist the next start position so frequent expensive tables do not starve others.
Pair this with a per-statement bound; a wall-clock check cannot interrupt an already-running
SQL statement. Verify a synthetic slow first batch, deadlines across rounds, and eventual
fair progress. Preserve retention policy values. Effort M.

### DB-05 — Dietary-note retention falls outside the backlog machinery (P1)

**Confirmed code; privacy/backlog risk conditional on volume or errors.**
`src/db/retention.ts:98-124` clears at most one 5,000-row batch;
`src/db/retention.ts:458-463` invokes it once after the main draining loop. Its failures are
logged but not included in `failedTables`; its limit has no `capped` outcome. The route runs
weekly (`src/app/api/cron/retention/route.ts:37`), although dietary test/comments describe a
nightly pass. `src/lib/retention.ts:477` sets a 30-day cutoff. More than 5,000 newly expired
notes/week makes a growing backlog that the normal capped-table alarms do not describe.
Even without backlog, weekly scheduling means cutoff enforcement can lag by almost a week.
This is a policy/implementation alignment question, not permission to shorten retention.

**Change:** make note clearing a first-class bounded retention arm with remaining/failure
status, drain fairly under the shared deadline, and explicitly align the required deletion
cadence with the 30-day policy. Test more than one batch and injected update failure; check
oldest uncleared eligible note and alert on an overdue backlog. Effort M; privacy review.

### DB-06 — Integration batch timeout arithmetic exceeds the enclosing invocation (P1)

**Confirmed arithmetic; degradation occurs during slow provider responses.**
`src/app/api/cron/integrations/route.ts:12,67` allows 300 seconds and asks for 50 deliveries.
`src/features/integrations/dispatcher.ts:74` processes them sequentially, with no overall
elapsed-time budget. Zapier's per-call timeout is 15 seconds
(`src/features/integrations/zapier.ts:16,73`): 50 timed-out calls alone need 750 seconds, before
DB work. QuickBooks can require multiple provider calls. The per-call timeout prevents one
infinite wait, but does not make the pass fit. The write path similarly requests ten items
inside the originating invocation (`dispatch-on-write.ts:17,33`). Claims and stale-processing
recovery already prevent permanent loss, but killed work increases retries, duration cost,
and delivery latency.

**Change:** stop claiming work when the remaining invocation budget cannot safely finish an
item, record incomplete backlog, and resume. Use small bounded concurrency partitioned by
provider/integration where ordering and idempotency permit; keep accounting ordering intact.
Expose oldest pending age, queue depth, throughput, and timeout rate. Test a full batch of
15-second failures against a fake elapsed clock. Avoid simply enlarging batch sizes or
increasing polling. Effort M.

### DB-07 — Recap jobs hydrate already-sent work and fan out per departure (P2)

**Confirmed unnecessary work.** `src/db/recap.ts:1656-1666` obtains `alreadySent`, but
`src/db/recap.ts:1678-1720` then fetches executed dives and recent dive days per distinct
candidate trip before `src/db/recap.ts:1739` skips those bookings. Repeated hourly runs
recompute fly-safe facts for recaps that will not be sent. `rows.filter` inside each trip
iteration also creates O(trips × candidate bookings) application work; `Promise.all` submits
all trip hydration at once. For a large lookback this consumes pool queue, CPU, and DB reads
without producing a message.

**Change:** derive pending eligible recipients before costly hydration, retain exact held and
skipped outcome semantics, group bookings by trip once, then hydrate pending groups with
bounded concurrency or batched readers. Maintain safety gating for missing divers/late boarding
and identical fly-safe semantics. Add an invariant test: a fully delivered scan performs no
fly-safe hydration, and more bookings on one trip do not increase hydration query count.
Effort M; two safety reviews for any change affecting eligibility/fly-safe inputs.

### DB-08 — All-shop reminder/recap sweeps have no durable page boundary (P2)

**Confirmed growth pattern, not a current outage.**
`src/db/reminders.ts:377-427` loads every booking within a cross-shop horizon, then builds a
single `IN` list of all booking IDs. `src/db/recap.ts:1597-1666` follows the same pattern over
its lookback. Time windows and indexes constrain age but not number of shops/seats. Current
batch sending helps provider throughput but does not bound candidate memory/query parameters,
processing duration, or fair progress if one invocation cannot finish the window.

**Change:** keyset-page candidate IDs, exclude already-completed delivery work in the query
where practical, and checkpoint work under a wall-clock budget. Group batch hydration and
locale/provider resolution per page. Preserve idempotency and reschedule behavior; test
multiple pages, a crash/resume, and late eligible records. Capture candidates versus actual
messages so idle repeat scans are visible. Effort M/L.

### DB-09 — Weekly digest computes the expensive Today graph twice (P2)

**Confirmed duplication.** `src/db/weekly-digest.ts:305-323` calls `getTodayWork` twice with
only `includeOpsAlerts` different. Both share readiness evidence, which is good, but each
runs the main Today wave (`src/db/today.ts:1655-1800`), including common roll-call, boat-work,
waitlist, staffing, reviews, inbox, and equipment reads. This runs inside a cron, so React
request-cache assumptions should not be used to claim cross-call deduplication.

**Change:** split shared Today facts from role-specific projection, load the facts once, and
produce both digest grades from them. Keep financial/operations details absent from staff
output by construction and test both role outputs byte-for-byte against current fixtures.
Add a digest query-count budget. This saves actual repeated work rather than making two
copies run faster in parallel. Effort M.

### DB-10 — Monthly reporting has a long serial query chain; year CSV multiplies it (P2)

**Confirmed statement structure; latency benefit needs a real Postgres measurement.**
`src/db/reporting.ts:263-665` awaits at least fourteen top-level reads one after another for
one report (trip spine, waiver totals, multiple money sources, tips/referrals/types). Many
share only the input scope and can be independent. `getYearMonthInputs` at
`src/db/reporting.ts:979-986` fans monthly reports out, multiplying statements over the season
and competing for the pool. The separate money reads are intentional to prevent join
multiplication; merging all money into one naive join would corrupt revenue.

**Change:** first parallelize independent read functions through `queryAll` so transaction
callers stay serial. Then consider a single season-scope report query grouped by month, using
pre-aggregated sources/UNION rather than multiplied joins. Measure statement count, dependent
phases, pool wait, and total DB time for one-month and year exports with realistic refunds,
deposits, currencies, and imported histories. Effort M, preserve financial tests.

### DB-11 — One schema index duplicates an existing unique index exactly (P3)

**Confirmed definition.** `src/db/schema/trips.ts:801-802` defines both
`trip_dives_trip_number_unique` and `trip_dives_trip_idx` on `(tripId,diveNumber)`, with no
predicate or included-column distinction. Keeping both pays storage/WAL and write maintenance
for the same lookup key. This is a specific cleanup, not a reason to drop every overlapping
index. For example, full versus partial live-trip indexes can serve different reads.

**Change:** verify actual deployed index definitions/dependencies and query plans, retain the
unique constraint, remove the redundant nonunique index through normal generated migration
workflow. Inspect index usage/size before estimating savings. Effort S, likely small absolute
cost saving but straightforward maintenance improvement.

### DB-12 — Non-render cost attribution

Consolidated under INF-05 below; this is one recommendation, not a second work item.

### DB-13 — General statement execution has no application-defined server deadline (P2)

**Confirmed application config; database role/provider defaults are unknown.**
`src/lib/db-pool-config.ts:34-81` configures pool size and connection/idle timeouts only;
`src/db/lock-bounds.ts:31` applies only a lock-wait timeout. An explicit statement timeout
appears in the WhatsApp transaction (`src/db/whatsapp-accounts.ts:322-324`), not as a general
request-query policy. A connected but expensive query can occupy a backend long after a
short operation's useful deadline unless provider/role defaults supply a bound.

**Change:** inspect effective `SHOW statement_timeout`/transaction timeout settings first;
define operation-specific limits for interactive reads versus exports/maintenance and cancel
DB work when appropriate. Avoid globally setting an arbitrarily short timeout that breaks
safety/financial transactions or valid backups. Track cancellation and timeout rates with
retryable user outcomes. Effort M; primarily resilience and runaway-compute control.

## Frontend and device work

## Prioritized findings

### FE-01 — Coordinate offline priming across tabs and avoid redundant whole-board work (P1 opportunity, medium effort)

**Confirmed code behavior:** `src/components/OfflineManifestAutoSave.tsx:18,31-37,101-111` starts a
48-hour board fetch on mount, each visibility return, reconnect and every five minutes. Its interval
checks only `navigator.onLine`, not visibility. The in-flight promise belongs to that React mount,
so it coalesces overlapping triggers within one tab only. It mounts on every staff surface through
`src/app/shop/[shopSlug]/_components/ShopChrome.tsx:335`.

Each read calls `/api/offline-manifests/upcoming`; that handler constructs all trip manifests in the
window using `Promise.all(tripIds.map(...))` at `src/app/api/offline-manifests/upcoming/route.ts:100-159`,
including `getTripManifests`, checklist checks and boat safety. At the client, it decrypts existing
records to purge other tenants and re-encrypts current snapshots:
`src/lib/offline-manifest-store.ts:475-488,552-588,591-617`.

**Cost model:** while timers run, `tabs × 12` full-board requests/hour, plus visibility/reconnect
triggers. Three tabs per staff member over eight hours imply 288 interval requests per device-day,
not including the per-trip manager or manual activity. Browser throttling/freeze reduces actual
hidden-tab counts; this is configured cadence, not observed traffic. Each request scales with trips
and passengers, and device crypto/storage work repeats even for unchanged boards.

**Recommendation:** establish a per-device/per-tenant refresh coordinator using an existing browser
coordination seam (Web Locks/BroadcastChannel if supported, with a fallback); have one owner refresh
and notify all tabs that encrypted snapshots changed. Coalesce visibility and reconnect triggers.
Evaluate hidden-tab cadence only after proving the pre-departure/offline freshness contract: simply
turning off every hidden-tab fetch may leave the only boat copy stale. Retain foreground/manual
refresh, tenant purge, expired-copy labeling and pending-event preservation. Add version-aware
refresh only if the server version includes every readiness/medical/crew/boat dependency; timestamps
must not falsely freshen unverified stale data.

**Validation:** two tabs, one visible; both hidden; leader closes; network reconnect; shop switch;
pending offline events; force expiry. Count board requests, DB round trips, response bytes, crypto
CPU, snapshot age, and save failures across a realistic 48-hour board. Requires safety and security
reviews for implementation.

### FE-02 — Coalesce manifest invalidations before refreshing the whole server page (P1 opportunity, medium effort)

`src/components/use-offline-manifest-sync.ts:298-328` invokes `router.refresh()` on each refresh
trigger, with a five-minute online timer independent of visibility. At `:346-356`, every received
`manifest-changed` SSE event calls the same refresh immediately. Reconcile is deliberately coalesced
at `:140-173`, but the server render itself is not coalesced in this hook. A batch of applied offline
roll-call events can emit a burst of invalidations; the source comment explicitly documents this
case. Framework request coalescing may reduce actual fetches, and must be measured before claiming
one network request per event.

Add an in-flight/queued refresh or short bounded invalidation window so a burst causes one current
render and at most one trailing render; ensure a later event cannot be lost behind an older response.
Do not delay the local acknowledgement of a boarding/roll-call write. A small authenticated revision
endpoint can avoid unchanged full renders only if the invalidation coverage is complete. Validate
10/50-event reconnect bursts, simultaneous remote staff updates, stale response ordering, and
unchanged manual-refresh busy states. Measure RSC bytes, render queries and action-to-visible latency.

### FE-03 — Account for hidden SSE subscribers and use a device-level connection budget (P2 opportunity, medium effort)

The EventSource in `src/components/use-offline-manifest-sync.ts:346-357` remains connected until
unmount; there is no visibility lifecycle. The route deliberately retires it after 240 seconds and
retries after 2 seconds (`src/app/api/trips/[id]/manifest-events/route.ts:46-57`), sends 25-second
heartbeats (`:213`), and reruns authentication/authorization/trip lookup on reconnect. A live tab
therefore opens roughly 15 streams/hour, even with no business event. Three tabs over eight hours
are about 360 stream openings, before browser freezing or disconnects; no dollar amount is implied.

The implementation already shares one direct LISTEN connection per warm process and closes it after
120 seconds with no subscribers (`src/db/manifest-events.ts:21-37,115-124`), and caps subscribers at
500 per instance (`:40-59`). These are important existing protections. The missing view is
fleet-wide active instances/connections, hidden-tab hours, and cost per useful event; 500 per instance
is not a deployment-wide connection cap.

Prefer sharing one trip subscription across same-device tabs before adopting a new realtime vendor.
Assess closing hidden subscriptions against the existing Web Push/background-sync/freshness design.
Keep four-minute auth revalidation and polling fallback. Instrument subscriber-seconds, reconnects,
refused subscribers, useful-event rate, live direct connections and DB active hours. Hosted realtime
is a later evidence-based architectural choice, not an automatic cost saving.

### FE-04 — Fix the Leaflet shop-marker leak and stop rebuilding all markers on selection (P1 confirmed defect, small effort)

`src/components/map/SiteMap.tsx:96-100` removes only markers in `markersRef`. Site markers are added
to that map at `:178`, but the shop marker created at `:120-125` is never registered or removed.
The effect reruns on `selectedPinId`, `pins`, `shopAnchor`, `shopLabel`, and `onSelectPin` (`:189`).
Both `SiteLibraryLayout.tsx:26-34` and `CatalogMapLayout.tsx:24-32` recreate the callback as selection
changes. Each effect creates another shop anchor marker. All site markers also rebuild on each
selection rather than updating the previous and selected marker. With an anchor and N pins, K
selection effects retain K anchor markers and rebuild O(K×N) site markers.

Keep a dedicated anchor ref or use a layer group with deterministic cleanup. Separate pin dataset
reconciliation from selection styling; update only changed markers and preserve popup lifecycle.
Test that 100 alternating selections keep the layer count constant and still open the selected
popup and scroll the ledger correctly. No current SiteMap-specific test was found; existing
`DiveSiteMap.test.tsx` tests the separate route-map component. This defect follows directly from
resource ownership in source; browser memory/timing impact was not measured.

### FE-05 — Replace raw Leaflet HTML interpolation with safe DOM construction (P1 security finding, small/medium effort)

This is not a speculative optimization. While examining the map lifecycle, the audit found an unsafe
HTML sink. `src/app/shop/[shopSlug]/dive-sites/page.tsx:129-140` passes persisted `site.name` and
`site.locationName` into `SiteMap`. `src/lib/dive-sites.ts:91-96` validates string lengths and trims,
but does not reject HTML metacharacters. `src/components/map/SiteMap.tsx:143` interpolates `pin.name`
inside an HTML attribute, `:163-170` constructs and passes popup HTML containing name/subtitle/href,
and `:125` interpolates the shop name. React escaping does not protect strings passed directly to
Leaflet. The CSP explicitly keeps `unsafe-inline` (`src/lib/content-security-policy.ts:52-57`).

Confirmed: user-provided text reaches an HTML parser without escaping. A stored-XSS exploit has not
been executed in a browser in this audit. Use DOM nodes with `textContent` and explicit safe
attributes for icons/popups; validate link schemes at the generic component boundary. Preserve
ordinary punctuation and names. Test a name such as `"><img src=x onerror=...>` renders as literal
text, not markup, and test popup subtitle/shop name too. Request a security-reviewer implementation
review. File a focused security issue through the repository process rather than burying this in a
performance cleanup.

### FE-06 — Measure routes and interactions, not only the intersection of every JS bundle (P1 missing capability, medium effort)

`scripts/perf-budget.mjs:72-78` computes the intersection of first-load chunks across all routes;
`:131-136` sums only that intersection. The current ceiling is 170 KiB gzip (`:57`). A large
schedule-only, manifest-only, or booking-only dependency can grow indefinitely without changing this
number. A dependency reaching almost every route also escapes the intersection if one route lacks
it. The limitation is explicitly accepted in `docs/architecture/performance-budgets.md`, rather than
a hidden bug; a thorough cost/performance program should now close it.

Retain the global floor, and add per-route total first-load budgets and selected interaction-load
budgets for Today, arrivals, manifest, booking, schedule, and maps. Track RSC/HTML/JSON bytes as well
as JavaScript: server components can still ship oversized serialized props. Record p75/p95 action-to-
settled and navigation-to-content on a controlled low-end/mobile profile; don't conflate instantly
painted skeletons with loaded work. Use existing route-bundle-stats output, lower thresholds from
fresh baselines, and avoid arbitrary generic kilobyte targets. Historical 163.7 KiB on 2026-10-13 in
the docs was not remeasured here.

### FE-07 — Stop losing vitals after a staff tab's first background transition (P1 measurement defect, medium effort)

`src/app/web-vitals-client.tsx:38` initializes `sent` once. `:53-55` permanently sets it on the first
send, which `:68-72` triggers on any hidden transition or pagehide. Returning to the same tab does
not reset it; any later metric callbacks update the map (`:40-48`) but cannot send. A staffer
who opens Today, backgrounds the tab once, returns and experiences an hour of slow interactions is
represented only by the pre-background sample. The module's promise of final visit metrics is thus
not met for resumed visible sessions. It also marks `sent` before checking whether sendBeacon
returned true, so a rejected enqueue has no pagehide retry.

The module explicitly attributes all soft-navigation interactions to the entry route; that is a
known simplification, not a new defect. Together these gaps make route-level performance prioritizing
less reliable, especially for long-running staff sessions.

Define a visible-session/measurement-id contract and support subsequent reports with a sequence or
upsert semantics; blindly logging each repeat as an independent pageview would distort percentiles.
Retain duplicate suppression for hidden+pagehide, capability redaction and bounded payloads. Test
hide → visible → worse metric → hide, bfcache restoration, soft navigation, and sendBeacon false.
Separately add sampled navigation/interaction timing for staff routes rather than claiming load LCP
measures every SPA navigation.

### FE-08 — Batch mutation telemetry and make its marginal spend explicit (P2 opportunity, small/medium effort)

`src/app/observability-client.tsx:18-35` sends one beacon for every `diveday:mutation-settled` event,
containing a one-element `mutations` array. The server already accepts a batch and logs each mutation
(`src/app/api/vitals/route.ts:62-73`), and every call performs a rate-limit operation (`:46-48`) and
flushes logs before returning. For M instrumented user actions, this currently adds M telemetry
requests plus rate-limit work. Batching reduces request/limiter overhead; it does not by itself
reduce the number of log events or metric samples.

Use a bounded queue, short flush interval, maximum batch size and pagehide flush, with optional
sampling appropriate to traffic volume. Preserve action-name validation and no URL/person identifiers.
Track dropped reports and queue failures. Keep critical error reporting independent. Measure actions
per page, beacon invocations, limiter usage, and telemetry spend per active staff-hour before choosing
sampling rates.

### FE-09 — Overlapping telemetry products

Consolidated under INF-06 below. Deferred SDKs still consume bytes and events after initial load;
retain their distinct error, performance and analytics roles until measured overlap is established.

### FE-10 — Convert full-page periodic reads into change-aware refresh where justified (P2 opportunity, medium effort)

`src/components/LiveRefresh.tsx:45-56` refreshes the entire server page every minute while visible and
not typing, also on sufficiently spaced focus/visibility events. It already avoids hidden-tab work
and holds after taps; tests at `LiveRefresh.test.tsx:24-76` pin these good behaviors. For an eligible
visible eight-hour desk session this is up to 480 interval RSC renders, even with no domain changes.
Arrivals mounts it at `src/app/shop/[shopSlug]/trips/[id]/_arrivals/CheckInQueueRefresh.tsx:32`.

Measure unchanged refresh rate and render cost before changing it. Consider an authenticated cheap
revision read or existing invalidation source with a bounded fallback, preserving time-driven states
that change even without writes (departure boundaries, expiration) and the tap/typing safety guards.
Do not lengthen the interval indiscriminately on operational pages. Acceptance criteria: unchanged
render/query reduction with the same maximum business-state staleness, no rows moving under a tap,
and correct reconnection behavior.

### FE-11 — Recheck font preloads against rendered glyphs (P3 source-sized opportunity, small effort)

`src/app/_fonts/fonts.ts:126-165,236-252` globally preloads Plex Sans Latin Extended, Latin, and both
Plex Mono Latin weights, and `src/app/layout.tsx` applies all font variables. Local file sizes are
25,868 bytes (Sans Latin Extended), 40,240 (Sans Latin), 10,052 and 10,120 (Mono Latin weights): 86,280
bytes total across these unique source assets. These are source-file bytes, not a production network
capture. Latin Extended alone is about 25.3 KiB that a page with only Latin-range glyphs may not need.

Audit actual first viewport text, locale glyph use and priority waterfall; remove only unnecessary
preloads, retain unicode-range/lazy subsets and fallback metrics, and keep product typography. English
and Spanish pages, staff ledgers, scientific symbols and font-swap CLS need verification. This is a
lower priority than repeated board fetches or map lifecycle defects.

### FE-12 — Revisit request-only boundaries with this exact Next version (P2 hypothesis, medium effort)

There are explicit `await connection()` calls in staff chrome, schedule, public packages/courses/
sites/reviews and selected token pages (for example `ShopChrome.tsx:86`, `schedule/board/page.tsx:85`,
`s/[shopSlug]/packages/page.tsx:56`). Their comments often justify them only by data being live.
No assertion is made here that they are wrong: auth, cookies, dynamic params, current time and
partial-prefetch semantics differ by framework version. Bundled Next docs were unavailable.

After restoring dependencies, inspect version-matched `io()`, `connection()` and partial-prefetch
contracts. Classify each boundary as required request isolation versus safe prefetchable live read;
compare actual prefetched shell/data requests, click-to-content latency and query count. Keep auth,
capability pages, live seat availability and final mutation checks correct. Do not introduce broad
shared caching for personal, medical or authorization-sensitive state. This is a targeted experiment,
not a request to replace every connection call.

## Existing strengths to preserve

- Staff layout is synchronous and streams chrome beside children (`shop/[shopSlug]/layout.tsx:37-76`).
  Chrome and sidebar share a per-request cached loader (`ShopChrome.tsx:83`); shop reads are memoized.
- Marketing pages cache stable locale-specific content; public `OurYear` deliberately instruments
  cache hits before considering shared remote cache (`OurYear.tsx:25-51,80-87`). Do not pay for remote
  cache without examining that evidence.
- Leaflet, analytics/RUM, command palette and Sentry are lazy/deferred rather than all on the root
  floor. Server-only staff translations and explicit diver namespaces limit serialized copy
  (`src/i18n/DiverIntlProvider.tsx:25-31,53-58`).
- Font assets are local and unicode-range split; special fonts do not all preload. Image origin
  allowlisting and decode/resize limits already exist, and image-size arithmetic covers the visual
  suite's intentionally disabled optimizer. These are not missing basics.
- Schedule board reads are bounded by week/keyset and parallelize independent reads; closed add-panel
  course/site options load on demand (`schedule/board/page.tsx:112-120,134-186`). Diver and site lists
  page their rows. Do not label these whole-table browser lists.
- Pager disables prefetch, but ledger row prefetch has been measured and intentionally retained
  (`src/components/ui/ledger.tsx:680-726`). Blanket prefetch removal would reopen a settled tradeoff.
- SSE uses one LISTEN connection per process, bounded subscriber counts, graceful retirement,
  reconnection and idle close, with a polling fallback. Existing cleanup is tested.
- Offline data is encrypted, tenant-checked, freshness-labeled, expires, preserves pending events
  under a bound, and checks live readiness on replay. Optimization must preserve this contract.
- Scope of tests inspected: LiveRefresh, auto-save, offline-store/worker, SSE and LISTEN lifecycle,
  map/arrival-map siblings, telemetry/redaction, fonts, budget and relevant page helpers. Tests were
  read but not executed due the unavailable dependency tree.

## Infrastructure, cost controls and delivery

### INF-01 — Make the cost report honest and connected to measurements

**P1; confirmed; small-to-medium effort.**

Evidence: `scripts/cost-report.mjs:24-82,86-131,147-202` defines static provider inventories and
risks, checks only credential presence, and stamps them with the current timestamp. It never calls
the working usage collectors. `awsBudget: true` at line 151 and the string `deployed` at line 178
are emitted even for an empty environment. `monthlyBaseUsd: 43.55` is explicitly an August/September
bill snapshot, including variable S3 expenditure, but becomes part of `minimumFixedUsd` at line 165.
The upper bound adds an arbitrary $20. These are not current spend or a fixed floor.

Reproduced without reading local credentials:

```sh
node --input-type=module -e 'const {generateCostReport}=await import("./scripts/cost-report.mjs"); const r=generateCostReport({}); console.log(JSON.stringify({baseline:r.baselineMonthlySpend,probes:r.probeConfiguration,risks:r.architecturalRisks.map(x=>({id:x.id,name:x.name}))},null,2))'
```

Result: `$63.55 – $83.55 / month`, budgets `deployed`, and `Internal-Only Observability`, despite
having supplied no configuration or cloud evidence. This is a genuine behavior reproduction,
not a production billing observation.

The stale risks are independently contradicted by current code:

- External monitoring exists in `infra/lib/global-stack.ts:49-118`: Route 53 checks plus an SNS
  alarm; `infra/lib/observability.ts:677-705` defines its target. Do not buy a duplicate canary to
  satisfy W-3.
- Realtime uses `src/app/api/trips/[id]/manifest-events/route.ts`, not the old path in the cost
  document. It retires after 240 seconds (`:46,216`), rather than deliberately timing out at 300.
- LISTEN uses one connection per warm process with viewers, not per tablet
  (`src/db/manifest-events.ts:114-126`); idle connections close after 120 seconds (`:37`).
- Production rate limiting requires the Upstash pair in the environment registry
  (`config/env-registry.mjs:774-786`) and emits a warning on unexpected fallback
  (`src/lib/rate-limit.ts:232-248`). The static report cannot establish that production currently
  uses memory.
- `docs/architecture/infrastructure-costs-and-risks.md` still recommends a delivered S3 migration,
  describes a daily dump although the actual schedule is weekly
  (`infra/lib/infra-stack.ts:3736-3742`), and uses obsolete price/plan assumptions.

Recommendation: distinguish source inventory, historical invoice, current measurement, configured
probe, verified deployment, and unknown status as separate fields. Reuse usage collection; add
measurement window, source, currency, plan, and last verified date. Reconcile the document and
remove resolved risks. Validate an empty environment yields unknown deployment/spend; mocked live
readings carry their provenance; current source topology cannot silently drift from the report.

### INF-02 — Add plan- and project-aware database quota protection

**P1 if production is Free; otherwise P2 measurement work; confirmed conditional mismatch.**

`src/lib/cost-guardrails.ts:140-153` warns at 40% of 300 CU-hours, i.e. **120 CU-hours**.
The registry explicitly says these are owner-chosen guardrails, not provider allowances. That is a
valid budget, but does not make it a quota exhaustion warning. The current official Neon pricing
page lists **100 CU-hours monthly per project**, and 1 GB storage per Free project:
[Neon pricing](https://neon.com/pricing), checked 2026-10-21. The same page describes Launch as
usage-based, not the report's mandatory $19 base.

If the production project has that Free allowance, it can exhaust its 100-hour allowance before
this warning reaches 120. Actual production plan was not read, so an imminent outage is not
established. In addition, `src/lib/usage/neon.ts:113-125,143-175` requests org consumption and sums
all projects. A per-project quota cannot be safely evaluated using an org-wide total. Monthly
GiB-months (`cost-guardrails.ts:155-167`) likewise do not establish headroom against a current-size
storage limit.

Recommendation: keep owner budgets but add a separate plan/quota model with resource identity,
period, current utilization, and burn-rate runway. Validate against the actual production plan.
For quota-sensitive plans, warn before the quota with enough runway for daily sampling. Add tests
with a single 95/100 project and multiple projects whose aggregate hides the shape of the risk.
Do not automatically shut down bookings to save money; alert-only posture is deliberate.

### INF-03 — Replace conversation-based WhatsApp costing with delivered-message accounting

**P2; confirmed model mismatch; medium effort, actual billing owner needs account verification.**

`src/lib/cost-guardrails.ts:203-218` measures `conversations` with a 1,000 ceiling and marks the
reading console-only. `scripts/cost-report.mjs:67-73` describes utility/marketing conversations
above 1,000 free service conversations. Current official pricing describes charging per delivered
message, with category and market differentiation:
[WhatsApp Business Platform pricing](https://whatsappbusiness.com/products/platform-pricing/),
checked 2026-10-21. Developer pricing page fetch returned 429; the official business pricing page
was available through search.

A conversation count is not a useful forecast for sequences of chargeable templates. The correct
first step is a billing ledger keyed to provider message ID, category, recipient market, delivery
outcome, applicable rate/version, and responsible WABA/account. Reconcile against invoices before
presenting an estimated charge as actual cost. Existing notification semantics and opt-ins must
remain authoritative; switching every message to the cheapest channel is not a safe optimization.

### INF-04 — Bound CloudWatch transport time, not only retries and memory

**P2; confirmed missing application-level deadline; outage cost requires failure injection.**

`src/lib/observability/cloudwatch.ts:165-195` sets `maxAttempts: 2` but does not set an application
request deadline, abort signal, or explicit handler timeouts. `drain()` awaits create-stream and
PUT sequentially (`:269-293`); `flushLogs()` waits for a previous flush (`:314-320`). The breaker
counts completed failures (`:209-228`), so a transport that stalls without rejecting does not
advance it. A slow flush can consume post-response function time and delay callers that explicitly
await flushing, even while the application log buffer itself remains bounded.

Recommendation: add a small explicit connection/request/overall flush budget and cancellation
through the SDK; preserve fail-open logging and stdout. Test a never-settling transport, timeout,
and recovery. Measure p95 flush duration before/after. This is not a claim that AWS normally stalls
or that every successful request currently waits for logs; most use Next's post-response hook.

### INF-05 — Extend query/cost measurements to jobs, webhooks, and actions

**P2; confirmed observability gap; medium effort.**

`src/lib/observability/query-timing.ts:20-37` explicitly drops counts outside render passes or an
explicit `withQueryStats` scope; `:184-187` avoids misleading zero counts in route handlers/actions.
Render measurements are good, but background fan-out, webhook reconciliation and retries can
become the largest operational database workloads. Existing cron logs include useful item counts,
but not a uniform query/time/byte cost record for those paths.

Recommendation: wrap selected critical entrypoints in the existing explicit scope, emit bounded
job/template names, DB count/time, wall time, examined/changed/skipped rows, provider attempts, and
payload bytes. Keep IDs and SQL parameters out of high-cardinality metrics. Start with reminders,
integrations, backups, payment webhooks, and bulk actions; do not introduce tracing every SQL
statement into a new vendor. Validate known workloads at 1/10/100 shops, and report work per shop
rather than only total cron success.

### INF-06 — Measure and choose the telemetry overlap and sample rate

**P2 at traffic growth, P3 now; confirmed configuration, savings unmeasured.**

`src/app/observability-client.tsx:103-115` mounts custom WebVitals, MutationDurations, Vercel
Analytics, Speed Insights, and CloudWatch RUM. Sentry separately handles errors. Telemetry is
already idle-deferred and redacted; this is not a claim that all SDKs block initial rendering.
CloudWatch config defaults to full sampling in `infra/lib/infra-stack.ts:1732` and
`src/app/rum-client.tsx:57-65`. A sample-rate setting already exists, so no new sampling feature is
needed. Invalid sample input falls back to 1 even though its comment says a misconfigured rate
must never record everything at full price.

Recommendation: map each stream to a concrete decision/dashboard and active user, compare overlap,
and set the existing RUM rate based on observed sessions. For a sample rate change from 1 to p,
expected sampled sessions fall by approximately `(1-p)`, not necessarily total telemetry cost by
that fraction. Keep high-value rare error signals and enough low-volume shop coverage. Add a
configuration check for malformed rates. Measure events/session and received bytes before deleting
any provider; migration choices remain governed by H-20260907-far-diveday-migrate-onto.

### INF-07 — Plan nightly E2E work before paying for a build

**P3; confirmed avoidable work on empty nights; small effort.**

`.github/workflows/e2e-nightly.yml:44-59` installs dependencies/browser and runs `pnpm e2e:build`
before learning whether there are quarantined tests or recently failing specs. The quarantine
command allows no tests; only after the build does the flake hunt query recent failures and exit
when its list is empty. Thus a fully healthy week can still pay for a daily application build
whose output no test uses.

Recommendation: add a lightweight planning job which gathers both sets first, then conditionally
builds/runs only when the union is nonempty. Preserve an explicit successful/no-work summary and
alert lifecycle. If planning cannot determine the work because GitHub is unavailable, fail open
to the existing full build rather than silently treating an error as no tests. Benefit is
`empty nights × setup+build runner minutes`; no live run history was fetched to estimate dollars.
This does not relax the settled rule that every PR stack layer runs its full applicable gate.

### INF-08 — Attribute storage/request cost before changing retention

**P2 measurement, P3 architectural optimization; existing documented problem, not a new discovery.**

The historical AWS S3 line is explicitly unattributed (`scripts/cost-report.mjs:45-52` and
`docs/engineering/cost-guardrails-runbook.md:64-83`). The runbook already points out that visual
snapshot PUTs, not storage lifecycle, may dominate. The current pruner runs every six hours
(`infra/lib/infra-stack.ts:3841-3846`) and 60-day lifecycle is a failsafe. Increasing pruning
frequency again cannot reduce the number of PUTs generated by CI.

Recommendation: gather cost by usage type and bucket/resource, number and bytes of snapshot PUTs
per green run, comparison count, and build/test artifacts uploaded. Evaluate content-addressed
reuse or upload unchanged images only if requests dominate, while preserving exact commit-to-
baseline completeness. This is a design experiment, not an approved change to the regression
contract. Keep existing main-per-commit CI runs: they guarantee baseline ancestry
(`.github/workflows/ci.yml:39-57`).

Backup bytes also grow indefinitely by design: current exports never expire pending legal H-20260730-evidence-retention-period-deletion,
but transition to IA at 30 days and Glacier Instant Retrieval at 90
(`infra/lib/infra-stack.ts:1089-1125`). Do not prescribe deletion to save a small storage bill.
Report growth `weekly full exported bytes × 52 × years` before compression/dedup effects, and
separate legal evidence from operational recovery copies. Full DB dumps already expire at 35 days
in an unversioned, separate bucket (`:1192-1213`). Media has only incomplete-upload cleanup
(`:1288-1307`); audit failed-write and replacement cleanup before proposing a global orphan sweep.

### INF-09 — Cost realtime with measured process packing, not viewer-hours as GB-hours

**P2 measurement; migration not justified by inspected evidence.**

The old cost document multiplies 120 tablets × four hours × 30 days into 14,400 function-hours
and describes this as GB-hours, then associates 120 viewers with 120 direct LISTEN connections.
Current code shares a listener per warm instance and permits up to 500 subscribers per instance
(`src/db/manifest-events.ts:37-59,114-126`). Each stream reconnects about every 242 seconds
(`manifest-events/route.ts:46,57`), so a four-hour viewing session creates approximately 60 opens,
with auth/trip lookup work on each. That request-count estimate is useful; the cost estimate needs
instance memory, active CPU, concurrency packing and real deployment billing mode.

Current Vercel documentation describes separate active CPU, provisioned memory and invocation
meters: [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing), checked
2026-10-21. Do not infer the account is using those defaults without checking its settings.

Recommendation: measure live viewers per instance, process count/direct listener count, stream
opens/closes, refusal count, auth DB work and billed memory/CPU. Evaluate a dedicated transport
only when measured cost or direct connection headroom crosses an agreed threshold. Preserve
poll/visibility fallback and offline freshness semantics; safety review is required for a change.

### INF-10 — Keep the disabled dependency advisory gate visible as a known issue

**P2 reconciliation gap; an explicit prior exception, not permission for a blanket re-enable.**

`.github/workflows/ci.yml:115-125` intentionally disables `pnpm audit --audit-level high` with
`if: false`, citing Aaron's decision and #2826. It is a real temporary gap but not evidence that
new vulnerabilities should be filed independently or that the accepted exception should be
reversed during this audit. Live REST verification during this audit found #2826 **closed**, while this checkout still has
`if: false`. Reconcile the closure/merged fix and the intended re-enable condition; do not treat the
closed ticket as active ownership. Re-run the advisory audit after dependencies are restored before
restoring the gate, or record a specifically owned remaining exception. Developer tooling also runs on credentialed CI, so this is meaningful operational risk, not
merely package tidiness.

## Additional provider and maintainability findings

### OPS-01 — Put a real deadline around the distributed rate-limit request (P1, S)

**Confirmed missing application deadline; user impact requires a stalled provider.**
`src/lib/rate-limit.ts:159-177` awaits the Upstash fetch and response JSON without an abort signal.
The outer policy handles a rejected promise, but cannot fail open or closed while that promise is
still pending. Tests at `rate-limit.test.ts:81-126` simulate thrown/rejected failures, not a stalled
connection. This shared boundary sits in front of public writes, so a limiter intended to protect
availability can consume the useful lifetime of the request. A platform/network default eventually
ending the wait is not a deliberately chosen user-facing budget.

Add an explicit deadline covering headers and body, preserve each caller's existing failure policy,
and retain damped error reporting. Reuse the repository's bounded-provider pattern rather than
inventing retries for every public action. Test a request that never supplies headers, a body that
stalls, normal allow/deny responses, and both existing failure policies. Measure limiter p95 and
failure frequency. This is separate from whether production has configured Upstash; the environment
registry already requires the pair and warns about accidental memory fallback.

### OPS-02 — Measure SMS segments and remove avoidable encoding expansion (P2, S/M)

**Confirmed avoidable non-GSM punctuation; savings depend on actual message lengths and traffic.**
`src/lib/notifications/sms.ts:137-143` explicitly normalizes nonbreaking spaces to avoid UCS-2,
but leaves other template punctuation unchanged. `src/i18n/locales/en-US/diver.json:5581-5603`
contains an em dash in waiver/course-form texts and a curly apostrophe in the medical-review note.
The Spanish equivalents also contain the dash. One unsupported character changes the encoding for
the whole message. AWS documents the resulting single-part capacity change from 160 GSM characters
to 70 for the alternate encoding; concatenated parts have their own overhead.
Source: [AWS SMS best practices](https://docs.aws.amazon.com/sns/latest/dg/channels-sms-best-practices.html).

Build a segment estimator at the SMS seam and test actual rendered messages, including the appended
STOP line, long shop/trip names, dates, links, both locales and non-Latin customer content. Use plain
transport punctuation for replaceable typography; preserve language and meaning, and never strip
STOP instructions or medical/safety information to fit one segment. Keep site/email typography
unchanged. Do not claim all Spanish text can be made GSM-safe, or use character count alone as a
cost estimator. Record estimated segments and reconcile with provider delivery/billing data without
logging recipients or message bodies. A tenant/channel budget dashboard is a useful later control;
automatic suppression of critical service messages would need its own product policy.

### OPS-03 — Provision weather for commercial use and measure cache miss amplification (P1 decision, P2 optimization)

**Confirmed endpoint/configuration gap; account entitlement and production usage unknown.**
`src/lib/marine-forecast.ts:390-398` calls the public `marine-api.open-meteo.com` and
`api.open-meteo.com` endpoints without an API key. The existing cost inventory calls this free.
Current first-party pricing describes the free endpoint as non-commercial, with paid commercial
access through customer endpoints. Verify the required plan and marine endpoint support before
commercial launch; this is a provisioning decision, not a legal conclusion about present usage.
Source: [Open-Meteo pricing](https://open-meteo.com/en/pricing).

The adapter already has a bounded five-minute in-process cache with shared in-flight promises,
per-call four-second timeouts, and graceful omission. Those are useful protections. It deliberately
removes partial/failed responses from the cache (`marine-forecast.ts:333-362`) so missing wind is not
silently cached as a healthy complete answer. Multiple server instances still each miss separately;
a failing half can cause both providers to be called repeatedly.

First instrument calls, hits, partial responses and latency by low-cardinality operation. Then
consider short failure backoff, separate provider caches, or a shared provider-response cache if
instance duplication is material. Preserve provenance, valid-at time, weather/crew separation,
missing-data semantics and freshness. Do not turn a cached forecast into boarding authorization or
silently serve old weather as current. Test concurrent callers, one provider down, recovery, cache
expiry and forecast-window boundaries. A shared store has a fixed cost and operational burden; buy
it only if avoided calls or latency justify it.

### OPS-04 — Pay down the known architecture exceptions at useful seams (P3, M)

**Measured static result: 14 ratcheted violations in nine files.**
The architecture guard passes because these are accepted baseline entries; it does not establish
that all layers are clean. `collectViolations()` identifies value imports from `src/lib` into the
database in `auth.ts` (3), `credentials.ts` (1), `dive-declaration.ts` (1),
`dive-site-field-guide.ts` (1), `dive-site-import.ts` (1), `dive-site-template-sync.ts` (1),
`security-step-up.ts` (2), `session.ts` (3), and `usage/alert-ledger.ts` (1).

Some imports pull schema/runtime initialization into modules expected to be pure; other modules
are really loaders. Split pure shape/rule definitions from data acquisition, and move orchestration
to an appropriate feature/data boundary when changing the relevant feature. The aim is cheaper
isolated tests and clearer ownership, not cosmetic file-count reduction. Preserve request memoization
and live authorization when moving auth/session code; require security review. Validate that the
ratchet count falls, pure modules no longer need database startup, and focused behavioral tests stay
identical. No measured production latency saving is asserted.

### OPS-05 — Reconcile dormant AI configuration with the actual source (P3, S)

**Confirmed documentation/configuration mismatch in this snapshot.**
`config/env-registry.mjs:939-958` advertises Claude assists, an `ANTHROPIC_API_KEY`, a default
$15/shop monthly cap, and ADR `20261018-claude-assists`. That ADR file is absent. Searches of
application source found no Anthropic client/call path or enforcement of the advertised cap.
Existing [#2836](https://github.com/AaronBuxbaum/diveday/issues/2836) tracks the human provisioning
work; do not duplicate it or assume provisioning alone enables a completed feature.

Resolve whether this is intentionally staged configuration or abandoned implementation. Remove
unsupported claims/dead configuration or point them to the actual accepted design and owning work.
Do not present the $15 value as a real spending control until atomic reservation, actual-usage
reconciliation, concurrency, timeout/error charging and per-shop attribution are implemented and
tested. This is not a recommendation to add AI features during a performance audit, and no runtime
AI spend was established from this checkout. Agent-development costs are a separate operating cost.

## Missing capabilities worth building

These are the capabilities implied by the detailed findings, not a second feature backlog:

| Capability | Minimum useful version | Linked findings |
| --- | --- | --- |
| Honest cost evidence | Historical/configured/measured/verified/unknown fields, dates and billing windows | INF-01/02/03 |
| Unit economics | Cost/usage by active shop, completed booking, staff-hour, delivered message and export | INF-05, OPS-02 |
| Fair resumable jobs | Checkpoint, lease, remaining work, oldest unfinished age and a completion summary | DB-01/04/05/06/08 |
| Large-export job lifecycle | Bounded fetch/bytes now; durable authorized download artifact at scale | DB-02 |
| Device refresh ownership | One tenant-scoped owner, failover and unchanged-data handling | FE-01/02/03/10 |
| Route and interaction budgets | Per-route JS/RSC bytes and useful-content/action latency at realistic data size | FE-06/07 |
| Representative load fixtures | Real Postgres, large histories/photos, concurrent desks and provider outages | DB-10/12/13 |
| Messaging cost accounting | Segments/templates, attempts/delivery and billing responsibility | INF-03, OPS-02 |
| Deployment-aware cost inventory | Compare source declarations with actual plan/resource inventory | INF-01/02/09 |

Existing broad consolidation ideas are already on the issue shelf: outbox lifecycle (#2730), message
records (#2728), person-column metadata (#2724), cadence coordination (#2715) and connection status
(#2741). They may help implementation, but a single generic abstraction should not erase different
idempotency, safety, privacy, retry or accounting semantics. Prefer extracting a proven common
mechanism after fixing one concrete workload.

## Measurement and acceptance plan

Use an isolated production-like PostgreSQL environment and a production build of the pinned Next
version. PGlite remains useful for correctness; it cannot establish networked database performance.
Do not load-test production or send real customer messages to gather these baselines.

### Workload matrix

| Scenario | Fixture/variation | Signals and success criteria |
| --- | --- | --- |
| Staff desk | Today, arrivals, schedule; one and three tabs; visible/background/resume | Queries, phases, RSC bytes, p50/p95 useful-content latency, unchanged refresh ratio |
| Busy boat | Small and full roster; 10/50 offline events reconnect; concurrent desk update | Event-to-visible lag, no lost updates, preserved live readiness, bounded refresh count |
| Large customer history | Same current board with 1/3/10 years of synthetic history | Current-work cost remains bounded; count/report plans inspected |
| Export | Small and photo-heavy shops; one/two concurrent exports; slow image host | Peak RSS, sockets, CPU, total bytes/time; explicit complete/failure outcome |
| Background backlog | 1/10/100 shops; slow first tenant; failed provider; forced deadlines | Fair progress, checkpoint recovery, oldest pending age, full estate coverage |
| Retention | No backlog, 5,001 dietary notes, multiple table batches, slow/failing SQL | Policy cutoff honored; failure/capped work observable; deadline reserve respected |
| Map soak | 100 alternating selections and dataset replacement | Stable layer count and memory; correct popup/focus; literal hostile-shaped text |
| Telemetry | Hide/resume, rejected beacon, long-lived SPA, offline then reconnect | Correct sample identity and route attribution; bounded reporting overhead |
| CI | Empty nightly work, typical code change, docs-only change | Setup/build/test minutes, artifact PUTs/bytes, unchanged validation coverage |

Record baseline and candidate on the same commit fixture, device/network profile and deployment
shape. Use repeated trials and report sample count and p50/p95; do not call one local timing a
regression proof. Separate cold starts, cache hits, cache misses, SQL duration, pool queueing,
transaction hold time, frontend long tasks and provider waits. Use redacted query fingerprints and
EXPLAIN ANALYZE only on isolated fixtures. Avoid high-cardinality tenant IDs or personal values in
metrics. Existing request/route instrumentation should be extended before introducing another vendor.

For savings claims, reconcile a representative billing period: actual provider invoice/usage export,
active resource/plan, pricing date, allocations, fixed fees, taxes/credits and development versus
production. No current dollar total or percentage speedup is defensible until this packet exists.

### Changes deliberately not recommended without new evidence

- Do not replace Vercel/Neon with a self-managed cluster merely because SSE exists. The current
  listener is shared per process; the old per-viewer connection cost model is wrong.
- Do not remove readiness checks, tenant/role revalidation, capacity locks, offline expiry or signed
  evidence verification to reduce statements.
- Do not blindly replace `connection()`, introduce shared caching around sensitive/live state,
  increase pools, or parallelize transaction-bound reads.
- Do not delete retained backups/waivers or change H-20260730-evidence-retention-period-deletion retention obligations for a storage saving.
- Do not reduce PR safety coverage or skip stack-layer CI; those are settled correctness contracts.
- Do not consolidate public and staff pages, redesign all pagination, replace per-test isolation,
  or unify every outbox just to reduce file count.
- Do not buy a duplicate uptime probe: external liveness monitoring is already declared. The
  existing deeper public-schedule probe issue is a different capability.

## Existing work, handoff and verification record

The live issue list was checked to avoid relabeling known work as a discovery. Relevant existing
items include:

| Issue | Relationship to this assessment |
| --- | --- |
| [#1661](https://github.com/AaronBuxbaum/diveday/issues/1661) | Visual upload request cost; parked; INF-08 supplies measurement context |
| [#2729](https://github.com/AaronBuxbaum/diveday/issues/2729) | E2E per-test reset cost; already actionable |
| [#2692](https://github.com/AaronBuxbaum/diveday/issues/2692) | Visual CI OIDC switch; awaiting external deployment |
| [#2622](https://github.com/AaronBuxbaum/diveday/issues/2622) | Mutation runner activation; parked |
| [#2354](https://github.com/AaronBuxbaum/diveday/issues/2354) | Duration-refresh workflow permission; human task |
| [#1474](https://github.com/AaronBuxbaum/diveday/issues/1474) | Deeper public schedule probe; distinct from present liveness check |
| [#2826](https://github.com/AaronBuxbaum/diveday/issues/2826) | Closed advisory-fix issue; audit gate still disabled in this snapshot |
| [#2836](https://github.com/AaronBuxbaum/diveday/issues/2836) | AI provisioning; advertised runtime/cap not found in source |
| [#2833](https://github.com/AaronBuxbaum/diveday/issues/2833) | Audit old media objects; do not run a broad orphan deletion from this report |
| [#2846](https://github.com/AaronBuxbaum/diveday/issues/2846) | Drop storage-only combined fit columns after rollout; existing cleanup |

The tracker snapshot had 40 `needs-triage` issues, the repository's stated inbox ceiling. This report
preserves the new findings and implementation criteria without adding an audit-sized issue flood or
silently promoting ideas to approved work. No new issues or PRs were created. The next triage pass
should take the map input-trust and dietary-retention defects first, then the bounded-work defects;
reference these finding IDs so the technical evidence does not need rediscovery. This is an
assessment/handoff, not a claim that the findings are already fixed or tracked individually.

Independent security cross-check confirmed the map input path and dietary-note retention gap from
source. It found no demonstrated cross-tenant exploit and made no production backlog claim. For the
map, a regression fixture can use `"><img src=x onerror="this.dataset.audit='executed'">` as a name
and assert literal text with no inserted image/event handler. For retention, 5,001 eligible notes
plus an injected database failure expose the missing repeated-batch/failed-outcome contract. Actual
fixes still require their normal security and, where relevant, two dive-domain reviews.

The requested report is complete as a repository-wide source assessment with targeted validation.
Runtime performance, production spend, deployed-resource verification and proposed implementation
work remain unperformed and are not represented as completed results.

## Implementation status — 2026-10-27

Issue #3134 implementation is assembled on the stack based on #3133: DB-01 adds durable fair
platform-backup progress, DB-06 bounds integration dispatch by elapsed time, and OPS-01 bounds
Upstash rate-limit requests. Focused local tests and scoped static checks passed; one controlled
Postgres test was skipped. This records implementation and local evidence only: no production
measurements, deployment verification, or hosted CI result is claimed here.
