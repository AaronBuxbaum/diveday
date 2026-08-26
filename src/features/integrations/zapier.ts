import { readIntegrationCredentials } from "@/db/integrations";
import type { IntegrationEvent, ShopIntegration } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import type { IntegrationEventType } from "./registry";

export const ZAPIER_HOOK_HOST = "hooks.zapier.com";

export type ZapierCredentials = { webhookUrl: string };

export function normalizeZapierWebhookUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const pathname = url.pathname.replace(/\/+$/, "");
    if (
      url.protocol !== "https:" ||
      url.hostname !== ZAPIER_HOOK_HOST ||
      !/^\/hooks\/catch\/[^/]+\/[^/]+$/.test(pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.pathname = pathname;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeZapierEventTypes(values: readonly string[]): IntegrationEventType[] {
  const allowed: IntegrationEventType[] = ["order.created", "order.paid", "order.refunded"];
  return allowed.filter((eventType) => values.includes(eventType));
}

function zapierCredentials(value: unknown): ZapierCredentials | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const webhookUrl = (value as { webhookUrl?: unknown }).webhookUrl;
  return typeof webhookUrl === "string" && normalizeZapierWebhookUrl(webhookUrl)
    ? { webhookUrl }
    : null;
}

export async function deliverZapierEvent(
  integration: ShopIntegration,
  event: IntegrationEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "delivered" } | { status: "failed"; code: string; retryable: boolean }> {
  const stored = await readIntegrationCredentials(integration);
  if (stored.status !== "ok")
    return { status: "failed", code: `zapier_${stored.status}`, retryable: false };
  const credentials = zapierCredentials(stored.credentials);
  if (!credentials) return { status: "failed", code: "zapier_invalid_webhook", retryable: false };
  const response = await fetchImpl(credentials.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-diveday-event": event.eventType,
      "x-diveday-delivery-id": event.id,
    },
    body: JSON.stringify({
      eventId: event.id,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      occurredAt: event.createdAt.toISOString(),
      data: event.payload,
    }),
  }).catch(() => null);
  if (!response) return { status: "failed", code: "zapier_unavailable", retryable: true };
  if (response.ok) return { status: "delivered" };
  return {
    status: "failed",
    code: response.status === 404 ? "zapier_hook_not_found" : "zapier_hook_refused",
    retryable:
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500,
  };
}

export async function sendZapierTest(
  webhookUrl: string,
  shopId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "sent" } | { status: "failed"; code: string }> {
  const normalized = normalizeZapierWebhookUrl(webhookUrl);
  if (!normalized) return { status: "failed", code: "zapier_invalid_webhook" };
  const response = await fetchImpl(normalized, {
    method: "POST",
    headers: { "content-type": "application/json", "x-diveday-event": "integration.test" },
    body: JSON.stringify({
      eventId: `test-${shopId}`,
      eventType: "integration.test",
      entityType: "integration",
      entityId: shopId,
      occurredAt: nowDate().toISOString(),
      data: { code: "integration_test" },
    }),
  }).catch(() => null);
  return response?.ok ? { status: "sent" } : { status: "failed", code: "zapier_test_failed" };
}
