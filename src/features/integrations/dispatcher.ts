import type { DbExecutor } from "@/db/client";
import {
  claimIntegrationDelivery,
  listDueIntegrationDeliveries,
  markIntegrationDeliveryDelivered,
  markIntegrationDeliveryFailed,
} from "@/db/integration-events";
import { markIntegrationError, markIntegrationHealthy } from "@/db/integrations";
import { deliverQuickBooksEvent, quickBooksConfigFromEnvironment } from "./quickbooks";
import { deliverZapierEvent } from "./zapier";

export type IntegrationDispatchSummary = {
  scanned: number;
  delivered: number;
  retried: number;
  failed: number;
};

export async function dispatchDueIntegrationDeliveries(
  db: DbExecutor,
  input: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<IntegrationDispatchSummary> {
  const due = await listDueIntegrationDeliveries(db, input.limit ?? 25);
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
    let result: { status: "delivered" } | { status: "failed"; code: string; retryable: boolean };
    if (candidate.integration.provider === "quickbooks") {
      const config = quickBooksConfigFromEnvironment();
      result = config
        ? await deliverQuickBooksEvent(
            db,
            candidate.integration,
            candidate.event,
            config,
            fetchImpl,
          )
        : { status: "failed", code: "quickbooks_not_configured", retryable: false };
    } else if (candidate.integration.provider === "zapier") {
      result = await deliverZapierEvent(candidate.integration, candidate.event, fetchImpl);
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
