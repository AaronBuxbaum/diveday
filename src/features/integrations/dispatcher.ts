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
import { IntegrationDeliveryDeadlineError } from "./delivery-deadline";
import { deliverQuickBooksEvent, quickBooksConfigFromEnvironment } from "./quickbooks";
import { deliverZapierEvent } from "./zapier";

/** Leave room inside the route's 300-second platform ceiling to settle a claim. */
export const INTEGRATIONS_CRON_BUDGET_MS = 240_000;
export const INTEGRATION_DELIVERY_MAX_MS = 60_000;
export const INTEGRATION_DELIVERY_SETTLEMENT_RESERVE_MS = 1_000;
const MINIMUM_USEFUL_DELIVERY_SLICE_MS = 1_000;

/**
 * **The outbox drain runs hourly, at `:03`.**
 *
 * A poll on a short interval keeps the serverless Postgres compute awake all
 * month, whether or not a delivery is due. Hourly at `:03` falls inside the
 * five minutes the other hourly passes already keep the database awake, so the
 * drain adds no wake-up of its own. The `:03` offset keeps it off the shared
 * `:00` tick (ADR 20260919-integration-delivery-is-write-driven, amended).
 *
 * A first attempt is dispatched on write, not on this cron. The cron is the
 * retry path: `markIntegrationDeliveryFailed` (`src/db/integration-events.ts`)
 * backs off `min(60, 2 ** (attempt - 1))` minutes, and the hourly pass is the
 * real floor under every rung. The trade-off is that a failed delivery retries
 * at the next hour, or at the next write that drains, so the dead-letter
 * horizon is longer than a shorter poll would give.
 *
 * Mirrors `vercel.json`; `src/lib/cron-schedule.test.ts` fails if the two
 * drift.
 */
export const INTEGRATIONS_CRON_CRONTAB = "3 * * * *";

export type IntegrationDispatchSummary = {
  scanned: number;
  delivered: number;
  retried: number;
  failed: number;
  elapsedMs: number;
  budgetExhausted: boolean;
  skippedByBudget: number;
};

export async function dispatchDueIntegrationDeliveries(
  db: DbExecutor,
  input: {
    limit?: number;
    order?: DueDeliveryOrder;
    fetchImpl?: typeof fetch;
    timeBudgetMs?: number;
    settlementReserveMs?: number;
    monotonicNow?: () => number;
    startedAtMs?: number;
  } = {},
): Promise<IntegrationDispatchSummary> {
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const startedAt = input.startedAtMs ?? monotonicNow();
  const timeBudgetMs = input.timeBudgetMs ?? INTEGRATIONS_CRON_BUDGET_MS;
  const settlementReserveMs =
    input.settlementReserveMs ?? INTEGRATION_DELIVERY_SETTLEMENT_RESERVE_MS;
  const budgetDeadline = startedAt + Math.max(0, timeBudgetMs);
  const providerDeadline = budgetDeadline - Math.max(0, settlementReserveMs);
  // `oldest-first` by default, which is what a backlog pass owes its rows. The
  // write path asks for `newest-first` so the delivery it just enqueued is in
  // the batch however long the queue behind it is -- see `DueDeliveryOrder`.
  const due = await listDueIntegrationDeliveries(db, input.limit ?? 25, input.order);
  const summary: IntegrationDispatchSummary = {
    scanned: due.length,
    delivered: 0,
    retried: 0,
    failed: 0,
    elapsedMs: 0,
    budgetExhausted: false,
    skippedByBudget: 0,
  };
  const fetchImpl = input.fetchImpl ?? fetch;

  for (const [index, candidate] of due.entries()) {
    if (providerDeadline - monotonicNow() < MINIMUM_USEFUL_DELIVERY_SLICE_MS) {
      summary.budgetExhausted = true;
      summary.skippedByBudget = due.length - index;
      break;
    }
    const claimed = await claimIntegrationDelivery(db, candidate.delivery.id);
    if (!claimed) continue;
    const deliveryController = new AbortController();
    const deliveryDeadline = Math.min(
      providerDeadline,
      monotonicNow() + INTEGRATION_DELIVERY_MAX_MS,
    );
    const deliveryTimeout = setTimeout(
      () => deliveryController.abort(),
      Math.max(0, deliveryDeadline - monotonicNow()),
    );
    // The stored payload names the customer by id and nothing else; the name
    // and email are read here, at the moment of sending, so a 400-day-old event
    // row never holds a diver's identity (issue #1016).
    let result: { status: "delivered" } | { status: "failed"; code: string; retryable: boolean };
    try {
      const event = await hydrateIntegrationEventPayload(db, candidate.event);
      if (deliveryController.signal.aborted || monotonicNow() >= deliveryDeadline) {
        deliveryController.abort();
        throw new IntegrationDeliveryDeadlineError();
      }
      if (candidate.integration.provider === "quickbooks") {
        const config = quickBooksConfigFromEnvironment();
        result = config
          ? await deliverQuickBooksEvent(
              db,
              candidate.integration,
              event,
              config,
              fetchImpl,
              deliveryController.signal,
            )
          : { status: "failed", code: "quickbooks_not_configured", retryable: false };
      } else if (candidate.integration.provider === "zapier") {
        result = await deliverZapierEvent(
          candidate.integration,
          event,
          fetchImpl,
          deliveryController.signal,
        );
      } else {
        result = { status: "failed", code: "provider_not_dispatchable", retryable: false };
      }
      if (deliveryController.signal.aborted || monotonicNow() >= deliveryDeadline) {
        deliveryController.abort();
        throw new IntegrationDeliveryDeadlineError();
      }
    } catch (error) {
      if (!(error instanceof IntegrationDeliveryDeadlineError)) {
        clearTimeout(deliveryTimeout);
        throw error;
      }
      result = { status: "failed", code: "integration_delivery_timeout", retryable: true };
    } finally {
      clearTimeout(deliveryTimeout);
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
  summary.elapsedMs = Math.max(0, Math.round(monotonicNow() - startedAt));
  return summary;
}
