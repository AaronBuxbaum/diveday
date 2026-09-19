# 20260919-integration-delivery-is-write-driven — Drain the integration outbox after the write that fills it, and keep the cron for retries

- **Status:** Accepted
- **Date:** 2026-09-19

## Context

[20260815-outbound-integration-webhooks-and-zapier](20260815-outbound-integration-webhooks-and-zapier.md)
gave shop integrations an at-least-once outbox: a write enqueues an
`integration_deliveries` row, and `/api/cron/integrations` drains it. Nothing else drained it, so
the cron's cadence *was* the delivery latency. At the `*/10` it shipped with, an order reached a
shop's Zapier up to ten minutes after the money moved; at the `0,30` that
[20260919-health-check-does-not-wake-the-database](20260919-health-check-does-not-wake-the-database.md)
moved it to, up to thirty.

Neither figure is a considered answer to "how quickly should a shop's accounting system hear about
a sale". They are what fell out of a compute-cost decision, which is the wrong thing for a product
latency to be derived from. Issue #1900 recorded that and asked for the shape the polling was
standing in for.

The row is already durable and already due the moment it is written — `next_attempt_at` defaults to
`now()`. Nothing has to be woken; something simply has to look.

## Decision

**The request that enqueues a delivery also drains it, after its own response has been sent.**

- `dispatchIntegrationsAfterResponse()` (`src/features/integrations/dispatch-on-write.ts`) wraps
  Next's `after()` around the existing `dispatchDueIntegrationDeliveries`. It is called from the
  four app-layer writes that can enqueue an event: the new-order action (`order.created`), the
  Stripe `invoice.paid` webhook, and the refund and refresh actions (`order.paid` /
  `order.refunded`). A void writes no event and is deliberately not wired.
- **`after`, not an inline await.** The delivery crosses the open internet to a third party.
  Awaiting it would put a staffer's "take payment" button behind Zapier's response time, and a
  wedged provider would read to them as DiveDay being broken. On the Stripe webhook it would be
  worse than slow: Stripe retries a slow response, so a provider's latency would become a
  redelivery.
- **The write-path drain takes at most `WRITE_PATH_DISPATCH_LIMIT` (10) deliveries**, against the
  cron's 50. Its job is "get the event I just enqueued out", not "work the backlog"; a request that
  wandered into draining fifty would be holding a function open on somebody else's arrears.
- **`/api/cron/integrations` keeps its `0,30` cadence, unchanged.** This is the half of the
  decision most easily got wrong. Write-path dispatch shortens the *first* attempt; it does nothing
  for the *retry* path, because a failed delivery is only re-read when something drains again, and
  a shop that has stopped writing will never trigger that. The backoff ladder in
  `markIntegrationDeliveryFailed` runs 1, 2, 4, 8, 16, 32, 60 minutes, and the cron is still the
  floor under every rung of it. Slowing the cron down on the strength of this change would trade a
  latency win on the happy path for a recovery regression on the unhappy one.
- **Nothing is locked, queued or migrated.** `claimIntegrationDelivery` is a conditional
  `UPDATE ... RETURNING`: two drainers may select the same row and exactly one wins it. That is the
  property the at-least-once contract has always rested on, and it is what makes a second drainer a
  five-line addition rather than an architecture.
- **It never throws into its caller.** The order is written and committed before this runs; a
  failure to tell Xero about it must not surface as a failed action, and cannot lose the delivery,
  because the row outlives the request. Both the scheduling and the drain are guarded, and
  `src/features/integrations/dispatch-on-write.test.ts` asserts a rejecting drain resolves quietly.

## Alternatives considered

- **Await the delivery inline in the action** — simplest, and wrong for the two reasons above:
  a staffer waiting on a third party, and Stripe redelivering on a slow webhook response.
- **A real queue (SQS, QStash, Inngest)** — the textbook answer, and a new runtime dependency plus
  its own ADR, credentials, failure modes and bill, to buy what `after()` and an existing durable
  table already provide at this size. Revisit when a shop's volume makes a 10-delivery write-path
  drain the wrong bound, or when deliveries need to outlive the invocation that scheduled them.
- **Make the cron frequent again** — the thing this replaces. `*/10` was the single largest
  consumer of database compute in the product and still left a ten-minute worst case; the cost
  scaled with the clock and the latency did not improve.
- **Dispatch from inside `enqueueIntegrationEvent`** — the one choke point every event passes
  through, which is genuinely tempting. Rejected on two counts: it runs inside the caller's
  transaction, so it would schedule work for a write that may still roll back; and it would make
  `src/db` import `next/server`, coupling the framework-free layer to the framework and breaking
  every `src/db` unit test that has no request scope.
- **Leave it until a pilot shop complains** — the honest default, and what the issue recorded. The
  product owner chose to build it now.

## Consequences

- A shop's integration hears about an order in seconds rather than in up to half an hour, on the
  path that matters: the one where somebody is standing at the counter having just taken payment.
- The write path now does one indexed read of an empty set per order on shops with no integration
  connected — which is every shop today. It is on a connection that is already open and a compute
  that is already awake, so it costs nothing the health-check ADR was protecting.
- Function duration on four routes grows by however long the drain takes, bounded by each route's
  `maxDuration`. The Stripe webhook is the one to watch, because its budget is shared with the rest
  of the handler.
- **A new order-writing path that forgets to call the helper degrades silently** — the event still
  delivers, just at the next cron tick. `dispatch-on-write.test.ts` reads the three app-layer entry
  files and fails if the call is gone from any of them, which is a guard against deletion rather
  than against a genuinely new path; a fourth entry point is a thing a reviewer has to notice.
- **Escape hatch.** If the after-phase proves unreliable on the platform, or a provider's latency
  starts eating webhook budget, delete the four call sites: the cron alone is exactly the behaviour
  before this ADR, and nothing else has to be unwound.
