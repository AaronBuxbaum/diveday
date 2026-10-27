# 20261027-fair-platform-backup-scheduling — Keep per-shop progress for the bounded platform backup

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The platform backup route visits shops in a five-minute function, stops admitting work at 240
seconds, and previously restarted from the same first shop every week. Its bucket credential cannot
list or read bundles, and the watchdog relies on date-first object keys and per-invocation census
counts. Progress must survive deadlines and overlapping cron calls without presenting a partial
invocation as complete or exposing a shop's diver data.

## Decision

Keep one `platform_backup_progress` row per shop with the last attempt time, last successful PUT
time, and a short lease token/expiry. The route orders untouched and least-recently-attempted shops
first. It atomically claims one shop in a short transaction with bounded lock waits, releases the
transaction before bundle or S3 work, and writes the success time only after S3 accepts the PUT. An
expired lease can be reclaimed after a crashed invocation; the token fences stale database updates,
not a late S3 request. Deterministic versioned object keys keep such writes additive. Shop deletion
cascades the checkpoint; the demo schedule reset clears it. It is not included in shop exports or
age-based retention. Each response and census remains specific to one invocation, and any skipped
shop makes that invocation incomplete. Scheduling fairness does not promise every shop completes
within one weekly period.

## Alternatives considered

- **No progress state** — rejected because a fixed oldest-first order can starve later shops forever.
- **A per-attempt history table or external queue** — rejected; one mutable checkpoint per shop is
  sufficient for ordering and avoids unbounded records or another service.
- **Skip shops already backed up in the current week** — rejected because every invocation should
  attempt a fresh full backup when its budget allows.

## Consequences

Attempt age is durable across periods, failures rotate behind untouched shops, and concurrent
invocations do not start the same shop while its lease is live. A shop that consistently exceeds
the lease could still have an in-flight request overlap after recovery; the DB token cannot fence
S3. Revisit only if per-shop backup age shows this bounded scheduler cannot provide acceptable
coverage; a durable continuation worker or streamed backup would then be a separate design.
