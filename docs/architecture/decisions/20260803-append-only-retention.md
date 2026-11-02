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

`RETENTION_DAYS` in `src/lib/retention.ts` is the one list of pruned tables and their windows, each
with its reason beside it. The table below is the set this record argued for, not the current list;
see the [2026-10-12 amendment](#amendment-2026-10-12--retention_days-is-the-list).

| Table | Days | Why |
| --- | --- | --- |
| `stripe_webhook_events` | 400 | ~133× Stripe's own ~3-day live retry window. Chronological evidence for `hasNewerAccountUpdate`, so this is a correctness bound, not a convenience one. Holds no diver data — event ids, types, account ids, timestamps. |
| `notification_delivery_attempts` | 400 | The durable proof a shop did or did not reach a diver. A season plus a year, so last year's incident is answerable during this year's same week. |
| `activity_events` | 1095 | Staff-facing operational narrative; small rows, and the thing a shop reconstructs an old season from. **The longest personal-data window in the app**: `params` holds the actor's and the diver's names as rendered words (`src/lib/activity.ts`), so three years of name-bearing lines is the price of the narrative. Erasure redacts them by id and by name on request (`src/db/anonymize.ts`); the window only bounds what nobody asked to erase. |
| `account_tokens` | 90 **past each token's own expiry** | Hashed bearer credentials over account takeover, so the conservative direction is the *opposite*: long enough for an incident review, no longer. A live token is never eligible at any age. |
| `account_sessions` | 90 **past each session's own expiry** | Added 2026-10-10 (code review item 38). One row per device sign-in, carrying its IP address and user agent, deleted before only by sign-out, revocation or erasure, so a staffer who never signed out kept them for ever. Same incident-review argument and same clock as `account_tokens`; every use slides `expires_at` forward, so a session still honoured is never eligible. |
| `notification_send_queue` | 90 **past the row being finished** | Added 2026-10-12 (code review 2026-10-11, item 14). Only `sent` rows and `failed` rows whose payload is already cleared: a finished row holds no personal data (every terminal write clears it), only an idempotency key, so the window bounds growth. A queued, processing or parked row is never eligible. |
| `waiver_deliveries` | 400 | Added 2026-10-12 (item 14). The latest delivery outcome of one waiver link on one channel, carrying the provider's bounce text. The same question as `notification_delivery_attempts`, so the same window; the signed waiver itself is `waiver_records`, which no clock touches. |
| `setup_requests` | 365 | Added 2026-10-12 (item 14). A shop asking to be set up: a person's name, email and phone, not yet anybody's customer. A season to follow it up; the single-use setup link goes with it by cascade. Reverses [20261007-setup-request-form](20261007-setup-request-form.md)'s "kept until asked" for this one table. |
| `email_bounces` | 90 | Added 2026-10-22. One row per address SES bounced or drew a complaint for: the address in clear, the reason, which email, the shop and who sent it, kept for DiveDay to debug its own delivery. A quarter shows a pattern; SES's suppression list, not this table, stops the next send. The erasure deletes a diver's rows by address. |
| `booking_payment_events` | 2555 | The local money ledger, at the ordinary seven-year financial horizon. Listed rather than left unbounded so "how long is a shop's money history kept?" has an answer in the same table as everything else. |

### Kept for ever, by decision

Every event-like trail without a window, one line each (the same list heads `src/lib/retention.ts`):

- `roll_call_events`, `roll_call_crew_events`, `booking_arrival_events`, `buddy_team_events`: safety records of who was on a boat and with whom ([20260804-buddy-teams](20260804-buddy-teams.md)).
- `trip_stage_events`: the crew's taps through a departure's day, kept as incident evidence (product owner, 2026-09-10, issue #1397).
- `pre_departure_check_events`: who confirmed each item of the shop's pre-departure safety check, the document an insurer or investigator asks for ([20260824-pre-departure-safety-check](20260824-pre-departure-safety-check.md); classified by the dive-domain review of code review 2026-10-13).
- `gear_service_events`: a unit's service and test history, which is equipment evidence (product owner, 2026-08-20).
- `trip_change_events`, `review_moderation_events`, `work_order_events`: who changed what on a departure, a review or a ticket, read as the record itself (the first two by the product owner, 2026-10-13, issue #2316, over the `activity_events` window).
- `held_sends`, `media_deletion_attempts`, `processor_erasure_obligations`, `payment_operation_intents`: deleted by their own work when it is done; a clock would delete what is still owed.
- `waiver_records` and the course-form records: signed evidence, H-20260730-evidence-retention-period-deletion's question, never a clock's.

`activity_events` is not on this list: it has the longest window here, 1,095 days (three years), stated in the table above.

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
- **`DELETE ... LIMIT`** — Postgres has no such thing; select candidates with a bounded query,
  then delete still-eligible candidates and count the rows returned by `DELETE ... RETURNING`.

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

## Amendment 2026-10-12 — `RETENTION_DAYS` is the list

The windows table above grew stale: by 2026-10-10 `RetainedTable` held twenty tables, and the table
here six. It is kept as the set this record argued for, and no longer answers "how long is X kept?".
`RETENTION_DAYS` does, with each window's reason in a docblock beside it, and `src/db/retention.ts`
holds the column each window is measured against. A table joins or leaves there, not here.

Two additions carry the argument of a row above. `shop_contact_email_confirmation_tokens` and
`booking_capabilities` are hashed bearer credentials, pruned 90 days past each row's own
`expires_at`, as `account_tokens` is. For `booking_capabilities` the end of that window is visible to
a diver: a dead link stops naming its shop
([capability runbook](../../engineering/capability-telemetry-runbook.md#after-the-prune-a-dead-link-names-no-shop)).
The trails left unbounded on purpose are named in `UNBOUNDED_BY_DECISION` in the same file.
No window changed in this amendment; the numbers stay HD-11's and H-20260916-far-deletion-promise-reach's.

## Amendment 2026-10-13 — a run drains, under a time budget

The escape hatch above assumed a capped table would be noticed. It was only logged: `tablesCapped` sat in the `prune_complete` line and nothing alarmed, and at one batch of 5 000 rows a week a table gaining more than about 714 rows a day never converged (fourth review, row 18). `pruneExpiredRecords` now takes batches in rounds, one per table and then again for each table still `capped`, until every table is inside its window or 45 of the route's 60 seconds are spent (`PRUNE_TIME_BUDGET_MS`). `PRUNE_BATCH_LIMIT` is now the bound per batch, not per run. A table still `capped` when the budget runs out logs `cron_retention.prune_capped`, which the CronPassFailures alarm counts (`infra/lib/observability.ts`). It alarms on one such run, not two in a row: the run is weekly, CloudWatch's alarm period ceiling is one day, and a backlog that survives 45 seconds of deletes is already growing faster than the prune. The response is the hatch above: a daily schedule, or a faster arm.

## Amendment 2026-10-21 — dietary notes drain independently each day

`DIETARY_NOTE_RETENTION_DAYS` remains 30, measured strictly before the departure's start-time
cutoff. This is eligibility policy, not a guarantee that no note survives its thirtieth day:
`GET /api/cron/dietary-retention` runs daily at 03:09 UTC (`9 3 * * *`), normally clearing newly
eligible notes on its next run. Missed, failed or capped runs add latency. The weekly table prune
remains Sunday 03:08 UTC (`8 3 * * 0`) and no longer clears dietary notes, so a table backlog
cannot postpone the dietary sweep's first batch.

The dietary sweep admits bounded batches for 45 seconds, using monotonic elapsed time and one
captured eligibility cutoff. This bounds admission; one admitted database statement can still be
in flight after the deadline. A full last batch conservatively reports `capped`, without starting
an extra query after the deadline. Each statement updates only the note and counts rows returned
by the update, including on deleted departures. Eligibility selection and mutation share one
statement snapshot, avoiding a separate select/update gap; this does not serialize against later
concurrent departure moves. Bookings, statuses and other booking data survive. A failed statement
leaves earlier completed batches counted and resumable.

The fail-closed bearer gate precedes the daily Sentry check-in. Its compiled monitor identity is
`diveday-dietary-retention`; the monitor schedule shares `DIETARY_RETENTION_CRONTAB` with a test
against deployment. Failed or capped outcomes close the monitor with `error`; statement failures
answer 500, bootstrap failures 503, and caps retain the weekly route's explicit 200 convention.
`cron_dietary_retention.clear_failed` (including bootstrap) and `.clear_capped` join the existing
`CronPassFailures` alarm. Reporting contains only counts and outcome codes, never notes,
identities or database error text, and log shipping is awaited.

## Amendment 2026-10-21 — weekly batch admission and durable progress

The weekly prune checks monotonic elapsed time before every batch, including the first round,
and again after its reservation commits. Equality with the 45-second deadline admits no work;
a zero budget runs no table query. It awaits the single admitted batch before reporting. This
bounds admission, not statement duration: a slow batch can still exceed the deadline or the
platform's 60-second ceiling.

One global `retention_prune_state` row records the next canonical table code. Each invocation
initializes it once with `INSERT ... ON CONFLICT DO NOTHING`. Before each batch a short
transaction sets the existing five-second lock timeout, locks that row, chooses the next pending
table starting at the cursor, and advances to its canonical successor. It commits before any
destructive batch. Overlapping reservations serialize their choice; the lock never spans a
prune. Termination after reservation, or a failing batch, therefore leaves the successor durable.
An unknown code restarts at the first canonical table. Each round visits a pending table once;
later rounds consider only full, nonfailed tables. A run must receive the database itself, never
an enclosing transaction that would defer the checkpoint commit until after deletion.

The explicit transaction adds five sequential query/response waits per admitted batch (`BEGIN`,
lock timeout, locked read, update, `COMMIT`), plus the single initialization per run. This buys a
clear commit boundary and bounded lock contention; no latency improvement has been measured.
Concurrent invocations can still overlap destructive batches. The cursor coordinates priority,
not ownership or exclusive processing, and a reserved but unexecuted batch will be revisited
when priority cycles back.

Outcomes distinguish drained tables, failed arms, unresolved full batches (`capped`), and
never-visited tables (`skipped`, unknown eligibility). Earlier successful deletion counts survive
a later failed batch. `cron_retention.prune_capped` carries separate `tablesCapped` and
`tablesSkipped` fields; arm failures emit the alarmed `cron_retention.prune_failed` event. Failed,
capped or skipped work closes the Sentry monitor with `error`; arm failures retain HTTP 500 and
budget-limited runs retain HTTP 200. Checkpoint failures stop admissions and use the existing
503 failure path. Reports contain table codes and counts only.

The machinery row has a primary key and a singleton check, contains no personal data or foreign
keys, and is explicitly outside shop export, deletion, person erasure and age-based retention.
It is created lazily, requires no demo seed, and does not change eligibility or retention windows.


## Amendment 2026-10-21 — eligibility survives candidate selection

Weekly batches reapply the same captured age cutoff and every extra eligibility predicate in
`DELETE`, alongside the bounded candidate IDs. In particular, a legal hold committed while the
delete waits for its report row lock protects the report and its cascaded evidence. This does not
serialize a hold that starts after deletion wins the row lock.

Counts come from `DELETE ... RETURNING`, so overlapping sweeps cannot both count the same deleted
row. A full candidate batch remains capped even when fewer candidates are deleted: candidates
protected or changed since selection do not prove that eligible rows behind the limit are drained.
The existing admission budget, checkpoint commit boundary and retention windows stay unchanged.
