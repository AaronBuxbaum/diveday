# Engineering follow-up evidence — 10 November 2026

This dated implementation record reconciles the selected ENG-03/04/05/16 review-board cards with
current source. It is not a new backlog or proof of production deployment. The original
[performance assessment](assessments/performance-cost-audit-20261021.md) retains its historical
observations. Pull requests and their current-head CI remain the delivery gate.

## Export resources (ENG-03 / DB-02)

Limits are four concurrent photos, 16 MiB per photo, 64 MiB total media, a 30-second shared
photo deadline, and 128 MiB of uncompressed ZIP input. The media pipeline reads public and signed private response
bodies incrementally against per-file and shared byte budgets, and stops queued work at a shared
deadline. Every failed or bounded item has an explicit manifest outcome; incomplete media remains
recoverable but cannot be reported as a successful backup. Uncompressed ZIP input is checked
before synchronous compression. Both staff download routes return a typed 413 refusal with
`no-store` instead of a generic failure; a refused diver archive records no completed export.

The regression tests cover body streaming occupying worker slots, simultaneous partial chunks,
byte and time limits, private media, and both download refusals. Independent security review
reran 42 export/route tests. The normal production build and 22 selected export, backup and smoke
browser tests passed on the local Mac with the repository-supported Chrome fallback.

Synthetic Node 24 probes used random 1 MiB photo bodies and a 2 ms mocked fetch delay, without a
database or network. RSS is the entire process high-water mark, not incremental export memory.

| Photos per export | Concurrent exports | Elapsed ms | Process max RSS KiB | Peak photo fetches |
| --- | ---: | ---: | ---: | ---: |
| 8 | 1 | 407 | 179728 | 4 |
| 32 | 1 | 810 | 278352 | 4 |
| 32 | 2 | 1549 | 295648 | 8 |

Both concurrent exports produced complete 33,565,363-byte ZIPs. These fixture observations are
not production thresholds, latency improvements or load-capacity guarantees. Database rows are
still materialized and compression is synchronous. Limits are per export, not a global process
or cross-instance admission controller. Durable streaming artifacts require representative estate
measurements and a separate design; these tests do not justify claiming them delivered.

DB-03's count-only settings query and bounded batching already existed before this work; its
five rehearsal/count parity tests passed. It was not reimplemented.

## Background reads (ENG-05 / DB-07, DB-09, DB-10)

Recap scans group pending eligible recipients once, skip fly-safe hydration for delivered or held
recipients, and process at most four departure jobs concurrently (up to two reads per job).
Transaction-bound reads remain serialized. Existing eligibility gates and outcome accounting are
unchanged. A delivered scan does no fly-safe hydration, and additional recipients on one departure
do not multiply its hydration reads.

Weekly digests read one Today graph, then project owner and staff inputs before grouping. Tests
compare both projections with the prior separate calls, including mixed operations rows. Monthly
reporting retains its SQL and arithmetic but schedules independent reads in 4/4/4/2 waves through
the existing transaction-aware helper.

Focused runs passed 128 recap/reporting tests, 46 Today/digest/query-budget tests, and 34
query-helper/digest tests. Independent domain/security review found no blocking issue. No real
PostgreSQL latency or production cost reduction was measured. Durable sweep pagination remains
a measurement-led larger step, not part of this query-reuse implementation.

## Resumed measurements and live documentation (ENG-04 / FE-07; ENG-16)

Web vitals retain rejected or throwing beacons and report changed measurements after resume or
bfcache restore. Accepted ID/value pairs are deduplicated; entry-route capability redaction remains
intact. Six lifecycle tests and the route/model suite pass (42 tests together); independent
review found no actionable defect. Browser queue acceptance does not establish delivery.
CloudWatch p75 describes reported observations, not a deduplicated final-per-visit population.

The testing guide now names real fixture helpers and the existing cross-tenant export example,
not the nonexistent `factories.ts`. Merged #4235 had already corrected removed task-packet
claims. The completed 3,868-line visual-polish execution record moved into
[the archive](visual-polish-plan-20261026.md); its old path retains section links.

Cost-report, project-quota and WhatsApp accounting work has its own source and evidence. This
record does not mark that remaining ENG-04 scope complete or assert any live provider plan/rate.
