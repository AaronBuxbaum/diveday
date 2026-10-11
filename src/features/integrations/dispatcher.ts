import type { DbExecutor } from "@/db/client";
import {
  claimIntegrationDelivery,
  type DueDeliveryOrder,
  hydrateIntegrationEventPayload,
  listDueIntegrationDeliveries,
  markIntegrationDeliveryDelivered,
  markIntegrationDeliveryFailed,
} from "@/db/integration-events";
import { markIntegrationError, markIntegrationHealthy } from "@/db/integrations";
import { deliverQuickBooksEvent, quickBooksConfigFromEnvironment } from "./quickbooks";
import { deliverXeroEvent, xeroConfigFromEnvironment } from "./xero";
import { deliverZapierEvent } from "./zapier";

/**
 * **The outbox drain's cadence: twice an hour, on `:00` and `:30`.**
 *
 * It shipped as a ten-minute poll, which was the single largest consumer of
 * database compute in the product and had nothing to do with how much work
 * there was to do. A serverless Postgres compute sleeps after five idle minutes and is
 * billed for the time it spends awake, so a pass every ten minutes is a
 * compute that is awake all month whether or not one delivery is due — and
 * with no shop connected yet, every one of those 144 daily passes drained an
 * empty outbox.
 *
 * Hourly, at `:03`, inside the five minutes the other hourly passes already
 * keep the database awake for, so this drain costs no wake-up of its own (it
 * was on their shared `:00` until they were staggered a minute apart, code
 * review 2026-10-10 item 11). It was `0,30` until
 * 2026-10-06, and the `:30` tick was a wake-up nothing else shared: about half
 * of the compute DiveDay pays for while nobody is using it (ADR
 * 20260919-integration-delivery-is-write-driven's amendment). The price is
 * the retry ladder in `markIntegrationDeliveryFailed`
 * (`src/db/integration-events.ts`), `min(60, 2 ** (attempt - 1))` minutes:
 * the cron is the real floor under every rung, so a failed delivery now
 * retries at the next hour (or the next write that drains), and the
 * dead-letter horizon stretches from roughly two hours to eight. A first
 * attempt is unaffected, because it is dispatched on write.
 *
 * Mirrors `vercel.json`, and `src/lib/cron-schedule.test.ts` fails if the two
 * drift. The cadence stops mattering entirely once delivery is dispatched on
 * write instead of polled for.
 */
export const INTEGRATIONS_CRON_CRONTAB = "3 * * * *";

export type IntegrationDispatchSummary = {
  scanned: number;
  delivered: number;
  retried: number;
  failed: number;
};

export async function dispatchDueIntegrationDeliveries(
  db: DbExecutor,
  input: { limit?: number; order?: DueDeliveryOrder; fetchImpl?: typeof fetch } = {},
): Promise<IntegrationDispatchSummary> {
  // `oldest-first` by default, which is what a backlog pass owes its rows. The
  // write path asks for `newest-first` so the delivery it just enqueued is in
  // the batch however long the queue behind it is -- see `DueDeliveryOrder`.
  const due = await listDueIntegrationDeliveries(db, input.limit ?? 25, input.order);
  const summary: IntegrationDispatchSummary = {
    scanned: due.length,
    delivered: 0,
    retried: 0,
    failed: 0,
  };
  const fetchImpl = input.fetchImpl ?? fetch;

  for (const candidate of due) {
    const claimed = await claimIntegrationDelivery(db, candidate.delivery.id);
    if (!claimed) continue;
    // The stored payload names the customer by id and nothing else; the name
    // and email are read here, at the moment of sending, so a 400-day-old event
    // row never holds a diver's identity (issue #1016).
    const event = await hydrateIntegrationEventPayload(db, candidate.event);
    let result: { status: "delivered" } | { status: "failed"; code: string; retryable: boolean };
    if (candidate.integration.provider === "quickbooks") {
      const config = quickBooksConfigFromEnvironment();
      result = config
        ? await deliverQuickBooksEvent(db, candidate.integration, event, config, fetchImpl)
        : { status: "failed", code: "quickbooks_not_configured", retryable: false };
    } else if (candidate.integration.provider === "xero") {
      const config = xeroConfigFromEnvironment();
      result = config
        ? await deliverXeroEvent(db, candidate.integration, event, config, fetchImpl)
        : { status: "failed", code: "xero_not_configured", retryable: false };
    } else if (candidate.integration.provider === "zapier") {
      result = await deliverZapierEvent(candidate.integration, event, fetchImpl);
    } else {
      result = { status: "failed", code: "provider_not_dispatchable", retryable: false };
    }

    if (result.status === "delivered") {
      await markIntegrationDeliveryDelivered(db, candidate.delivery.id);
      await markIntegrationHealthy(db, candidate.integration.id);
      summary.delivered += 1;
      continue;
    }

    await markIntegrationDeliveryFailed(db, {
      deliveryId: candidate.delivery.id,
      attemptCount: claimed.attemptCount,
      errorCode: result.code,
      retryable: result.retryable,
    });
    if (!result.retryable) await markIntegrationError(db, candidate.integration.id, result.code);
    if (result.retryable && claimed.attemptCount < 8) summary.retried += 1;
    else summary.failed += 1;
  }
  return summary;
}
