import { after } from "next/server";
import { getDb } from "@/db/client";
import { log } from "@/lib/log";
import { dispatchDueIntegrationDeliveries } from "./dispatcher";

/**
 * How many deliveries one write-path drain will take.
 *
 * Smaller than the cron's 50 on purpose. This runs attached to somebody's
 * request — a staffer who just took a payment, or Stripe's webhook — and the
 * job here is "get the event I just enqueued out of the door", not "work the
 * whole backlog". A shop that has accumulated a queue gets it drained by the
 * half-hourly pass, whose whole purpose is bulk; a request that wandered into
 * draining fifty deliveries would be holding a function open on somebody
 * else's arrears.
 */
export const WRITE_PATH_DISPATCH_LIMIT = 10;

/**
 * Drain the integration outbox after this response is sent.
 *
 * **Why this exists.** The outbox used to be drained only by
 * `/api/cron/integrations`, so a shop's Shopify/QuickBooks/Xero/Zapier event
 * waited for the next tick however idle the system was — up to half an hour for
 * something that was ready the instant the order was written (ADR
 * 20260919-integration-delivery-is-write-driven, issue #1900). Calling this
 * right after a write makes the common case seconds instead.
 *
 * **Why `after` and not an inline await.** The delivery crosses the open
 * internet to a third party. Awaiting it inside the action would put a
 * staffer's "take payment" button behind Zapier's response time, and a slow or
 * wedged provider would read to them as DiveDay being broken. `after` runs the
 * drain once the response has already gone out, inside the same invocation and
 * inside the route's own `maxDuration`.
 *
 * **Why it is safe to run alongside the cron.** `claimIntegrationDelivery` is a
 * conditional `UPDATE ... RETURNING`: two workers may select the same row and
 * exactly one wins it. That property is what the at-least-once contract has
 * always rested on (ADR 20260815-outbound-integration-webhooks-and-zapier), and
 * it is why adding a second drainer needs no lock, no queue and no schema
 * change. A freshly inserted delivery is immediately due — `next_attempt_at`
 * defaults to `now()` — so there is nothing to wake, only something to read.
 *
 * **This does not replace the cron.** Retries do. The backoff ladder in
 * `markIntegrationDeliveryFailed` runs 1, 2, 4, 8, 16, 32, 60 minutes, and
 * nothing re-reads a failed row until something drains again; a write-path
 * drain only happens when a shop happens to write. So `/api/cron/integrations`
 * keeps its `0,30` cadence exactly as it is — this shortens the *first*
 * attempt, not the recovery path.
 *
 * **Never throws into its caller.** An order that was written is written; a
 * failure to tell Xero about it must not surface as a failed action, and the
 * delivery row is durable, so the next pass picks it up regardless. Both the
 * scheduling and the drain are guarded.
 */
export function dispatchIntegrationsAfterResponse(): void {
  try {
    after(async () => {
      try {
        const summary = await dispatchDueIntegrationDeliveries(await getDb(), {
          limit: WRITE_PATH_DISPATCH_LIMIT,
        });
        // Silent when there was nothing to do, which is the common case on a
        // shop with no integration connected: one indexed read of an empty
        // set is not worth a log line per order.
        if (summary.scanned === 0) return;
        log("integrations.dispatch_after_response", "info", summary);
      } catch {
        // Deliberately not Sentry: the cron path already reports a failing
        // drain with its own monitor and `cron_integrations.scan_failed`, and
        // minting an issue here as well would double every provider outage.
        log("integrations.dispatch_after_response_failed", "error", {});
      }
    });
  } catch {
    // `after` throws when there is no request scope to attach to — a unit test
    // calling an action directly, or a future caller that is neither a Server
    // Function nor a Route Handler. The drain is an optimisation over a durable
    // row, so losing it is a latency regression and never a lost delivery.
    log("integrations.dispatch_after_response_unscheduled", "warn", {});
  }
}
