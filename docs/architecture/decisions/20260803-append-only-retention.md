# 20260803-append-only-retention — Prune the append-only tables on a named per-table window

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

Nothing in this product has ever deleted an append-only row. `stripe_webhook_events`,
`notification_delivery_attempts`, `activity_events` and `account_tokens` all grow for as long as a
shop keeps trading — finding **DATA-M4** of the 2026-08-02 review, and the tail of **PAY-L4**
("`stripe_webhook_events` unbounded"). The new local money trail
([20260803-booking-payment-events](20260803-booking-payment-events.md)) is a fifth.

The review attached a constraint to the Stripe table specifically, and it is the reason this record
exists at all rather than a `DELETE ... WHERE created_at < interval '90 days'` somewhere:

> `stripe_webhook_events` rows are now load-bearing **evidence**, not just dedup state —
> `hasNewerAccountUpdate` reads their `occurred_at` — so any pruning window must outlast Stripe's
> own retry window, not merely be convenient.

That is not hypothetical. `account.updated` is otherwise pure last-write-wins, and its only defence
against out-of-order delivery is comparing an incoming event's `occurred_at` against the rows
already in this table. Prune a row inside Stripe's retry horizon and an older redelivery reads as
fresh, regressing `charges_enabled` — fail-open on the flag that gates order and checkout creation.

**The window values are HD-11's decision, not an agent's.** HD-11 owns the retention half of the
erasure-versus-signed-evidence question and has not been through counsel. What ships here is the
*mechanism*, with conservative defaults in one obvious table.

## Decision

**One prune pass, one window per table, one file a human edits.**

- **`src/lib/retention.ts`** holds `RETENTION_DAYS` — the whole policy, one entry per table, each
  with the reasoning for its number in a docblock beside it. Framework-free; it knows nothing about
  the database. Changing a window is an edit to this one table and nothing else moves.
- **`src/db/retention.ts`** knows only *which column* each window is measured against, and deletes.
  Every arm is bounded (`PRUNE_BATCH_LIMIT`, 5 000 rows per table per pass — a backlog converges
  over successive passes instead of trying to delete a decade inside one function invocation) and
  independent (one arm throwing is reported with its table code; the rest still run).
- **`GET /api/cron/retention`**, weekly (`30 3 * * 0` in `vercel.json`), with the **same fail-closed
  `CRON_SECRET` bearer auth** as `/api/cron/reminders`: unconfigured is 503, wrong token is 401, and
  neither deletes anything. The auth gate runs before the Sentry check-in so an unauthorized probe
  can never tell the monitor a pass happened. Weekly rather than daily because the windows are
  measured in hundreds of days.
- **It reports what it deleted** three ways: per-table outcomes in the response body, one
  `cron_retention.prune_complete` line naming each table's count and window, and its own Sentry Cron
  Monitor check-in — separate from the daily tick's, because a missed prune and a missed reminders
  run are different incidents. A partial pass answers 500 so the scheduler's log agrees with Sentry.

### The windows, and why

| Table | Days | Why |
| --- | --- | --- |
| `stripe_webhook_events` | 400 | ~133× Stripe's own ~3-day live retry window. Chronological evidence for `hasNewerAccountUpdate`, so this is a correctness bound, not a convenience one. Holds no diver data — event ids, types, account ids, timestamps. |
| `notification_delivery_attempts` | 400 | The durable proof a shop did or did not reach a diver. A season plus a year, so last year's incident is answerable during this year's same week. |
| `activity_events` | 1095 | Staff-facing operational narrative; small rows, and the thing a shop reconstructs an old season from. |
| `account_tokens` | 90 **past each token's own expiry** | Hashed bearer credentials over account takeover, so the conservative direction is the *opposite*: long enough for an incident review, no longer. A live token is never eligible at any age. |
| `booking_payment_events` | 2555 | The local money ledger, at the ordinary seven-year financial horizon. Listed rather than left unbounded so "how long is a shop's money history kept?" has an answer in the same table as everything else. |

`retentionWindowsOutlastStripeRetries()` asserts the first row's relationship to
`STRIPE_WEBHOOK_RETRY_DAYS`, and a unit test holds it — shortening that window has to fail a test,
not merely a code review.

## Alternatives considered

- **A single global window** — would have to be the longest one, which keeps hashed reset tokens for
  seven years, or the shortest, which prunes Stripe evidence inside its retry horizon. The tables
  answer different questions; one number cannot.
- **Delete `stripe_webhook_events` rows once handled** — this is the mistake
  `releaseStripeWebhookEventClaim` already documents at length: the row is *other* events' evidence,
  not only its own.
- **Postgres partitioning / `pg_cron`** — a real answer at a scale this product is nowhere near, and
  a new operational dependency. The app already owns a scheduler seam (`vercel.json` + a route) and
  no timer of its own ([20260721-scheduled-reminder-cadence](20260721-scheduled-reminder-cadence.md)).
- **Add the prune to the existing daily tick** — would run a table scan 364 days a year to delete
  nothing, and couples a retention failure to the reminders monitor.
- **`DELETE ... LIMIT`** — Postgres has no such thing; the two-statement select-then-delete also
  makes the reported count the count actually deleted rather than an estimate.

## Consequences

Makes easy: bounding five tables that had no bound, with a policy a non-agent can read and change
in one place, and a report that distinguishes "nothing was eligible" from "the pass stopped
running".

Makes harder: nothing operationally, but it commits the product to a *stated* retention posture,
which is a claim a shop's own compliance answer may now lean on. That is precisely why the numbers
are marked as HD-11's to confirm.

### What this deliberately did not do

- **It did not decide the windows.** They are safe defaults in one constant table, flagged for
  HD-11 in the file, in the route, and here. Shortening any of them is a policy change, not a code
  change.
- **It does not prune every growing table.** `payment_operation_intents`, `notification_deliveries`,
  `media_deletion_attempts`, `processor_erasure_obligations` and the roll-call tables are untouched.
  The roll-call tables are safety evidence and the obligation ledger is compliance state; the other
  two are candidates for a later pass and were left out rather than given a number nobody had
  thought about.
- **It does not anonymize.** Pruning is deletion by age, full stop. It is not, and must not be
  mistaken for, the diver-erasure mechanism
  ([20260802-diver-data-erasure](20260802-diver-data-erasure.md)) — erasure is triggered by a
  person's request and scrubs identity; this is a clock.
- **It does not archive first.** Deleted rows are gone, not moved to cold storage. If an
  export-before-delete is ever wanted, it belongs in the same pass and would change the batch
  shape.
- **It does not run in dev or tests automatically.** There is no timer; the route runs only when a
  scheduler calls it with the secret.

### Escape hatch

If a window turns out to be wrong, it is one number in `RETENTION_DAYS` — but only forward: rows
already pruned are not recoverable, which is why every default here errs long. If the batch cap
turns out to leave a table permanently behind, raise `PRUNE_BATCH_LIMIT` or move the schedule to
daily; both are one-line changes. Disabling the mechanism entirely is removing one `crons` entry.
