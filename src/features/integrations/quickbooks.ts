import type { DbExecutor } from "@/db/client";
import { orderHasIntegrationEvent } from "@/db/integration-events";
import {
  getIntegrationSyncRecord,
  markIntegrationHealthy,
  readIntegrationCredentials,
  saveShopIntegration,
  upsertIntegrationSyncRecord,
} from "@/db/integrations";
import type { IntegrationCredentials, IntegrationEvent, ShopIntegration } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { minorToMajor } from "@/lib/money";
import {
  combineDeliverySignals,
  IntegrationDeliveryDeadlineError,
  responseJsonWithinDeadline,
  untilAborted,
} from "./delivery-deadline";
import {
  refundLineDescription,
  refundReference,
  type SaleSource,
  saleReference,
} from "./sale-reference";

export const QUICKBOOKS_AUTHORIZATION_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QUICKBOOKS_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

/**
 * A per-request ceiling on every outbound call.
 *
 * The dispatcher drains up to 50 deliveries in one sequential pass inside a
 * 300-second cron, and `fetch` has no default timeout: one endpoint that
 * accepts a connection and never answers holds the whole outbox until the
 * function is killed, and every delivery behind it stays due. A hung request
 * is a failure that retries, not a queue that stops.
 */
const REQUEST_TIMEOUT_MS = 15_000;
export const QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting";

class QuickBooksRefreshTimeoutError extends Error {}

export type QuickBooksEnvironment = "sandbox" | "production";

export type QuickBooksConfig = {
  clientId: string;
  clientSecret: string;
  environment: QuickBooksEnvironment;
};

export type QuickBooksCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type QuickBooksOrderPayload = {
  source?: SaleSource;
  orderId: string;
  customer: { id: string; name: string; email: string | null };
  currency: string;
  totalCents: number;
  refundedCents: number;
  refundCents?: number;
  createdAt: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmountCents: number;
  }>;
};

export function quickBooksConfigFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): QuickBooksConfig | null {
  const clientId = env.QUICKBOOKS_CLIENT_ID?.trim();
  const clientSecret = env.QUICKBOOKS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const environment = env.QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase();
  return {
    clientId,
    clientSecret,
    environment: environment === "sandbox" ? "sandbox" : "production",
  };
}

export function quickBooksAuthorizationUrl(input: {
  config: QuickBooksConfig;
  state: string;
  redirectUri: string;
}): string {
  const url = new URL(QUICKBOOKS_AUTHORIZATION_URL);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QUICKBOOKS_SCOPE);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeQuickBooksCode(
  input: { config: QuickBooksConfig; code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<
  { status: "connected"; credentials: QuickBooksCredentials } | { status: "failed"; code: string }
> {
  const basic = Buffer.from(`${input.config.clientId}:${input.config.clientSecret}`).toString(
    "base64",
  );
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await fetchImpl(QUICKBOOKS_TOKEN_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  }).catch(() => null);
  if (!response) return { status: "failed", code: "quickbooks_exchange_unavailable" };
  if (!response.ok) return { status: "failed", code: "quickbooks_exchange_refused" };
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : null;
  const refreshToken = typeof payload?.refresh_token === "string" ? payload.refresh_token : null;
  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : null;
  if (!accessToken || !refreshToken || !expiresIn) {
    return { status: "failed", code: "quickbooks_exchange_invalid" };
  }
  return {
    status: "connected",
    credentials: {
      accessToken,
      refreshToken,
      expiresAt: nowMs() + expiresIn * 1000,
    },
  };
}

export function quickBooksSalesReceipt(
  payload: QuickBooksOrderPayload,
  customerId: string,
  itemId: string,
) {
  return {
    CustomerRef: { value: customerId },
    TxnDate: payload.createdAt.slice(0, 10),
    PrivateNote: saleReference(payload),
    Line: payload.lineItems.map((line) => ({
      Amount: minorToMajor(line.quantity * line.unitAmountCents, payload.currency),
      DetailType: "SalesItemLineDetail",
      Description: line.description,
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: line.quantity,
        UnitPrice: minorToMajor(line.unitAmountCents, payload.currency),
      },
    })),
  };
}

export function quickBooksRefundReceipt(
  payload: QuickBooksOrderPayload,
  customerId: string,
  itemId: string,
) {
  const refundCents = payload.refundCents ?? payload.refundedCents;
  return {
    CustomerRef: { value: customerId },
    TxnDate: payload.createdAt.slice(0, 10),
    PrivateNote: refundReference(payload),
    Line: [
      {
        Amount: minorToMajor(refundCents, payload.currency),
        DetailType: "SalesItemLineDetail",
        Description: refundLineDescription(payload),
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          Qty: 1,
          UnitPrice: minorToMajor(refundCents, payload.currency),
        },
      },
    ],
  };
}

function credentialString(credentials: IntegrationCredentials, key: string): string | null {
  const value = credentials[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asQuickBooksCredentials(
  credentials: IntegrationCredentials,
): QuickBooksCredentials | null {
  const accessToken = credentialString(credentials, "accessToken");
  const refreshToken = credentialString(credentials, "refreshToken");
  const expiresAt = credentials.expiresAt;
  return accessToken && refreshToken && typeof expiresAt === "number"
    ? { accessToken, refreshToken, expiresAt }
    : null;
}

async function refreshQuickBooksCredentials(
  db: DbExecutor,
  integration: ShopIntegration,
  config: QuickBooksConfig,
  credentials: QuickBooksCredentials,
  fetchImpl: typeof fetch,
  deliverySignal?: AbortSignal,
): Promise<QuickBooksCredentials | null> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const signal = combineDeliverySignals(deliverySignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
  const response = await untilAborted(
    () =>
      fetchImpl(QUICKBOOKS_TOKEN_URL, {
        signal,
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
        }),
      }),
    signal,
  ).catch((error: unknown) => {
    if (error instanceof IntegrationDeliveryDeadlineError) {
      if (deliverySignal?.aborted) throw error;
      throw new QuickBooksRefreshTimeoutError();
    }
    return null;
  });
  if (!response?.ok) return null;
  const payload = (await responseJsonWithinDeadline<Record<string, unknown>>(
    response,
    signal,
  ).catch((error: unknown) => {
    if (error instanceof IntegrationDeliveryDeadlineError) {
      if (deliverySignal?.aborted) throw error;
      throw new QuickBooksRefreshTimeoutError();
    }
    return null;
  })) as Record<string, unknown> | null;
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : null;
  const refreshToken =
    typeof payload?.refresh_token === "string" ? payload.refresh_token : credentials.refreshToken;
  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : null;
  if (!accessToken || !refreshToken || !expiresIn) return null;
  const next = { accessToken, refreshToken, expiresAt: nowMs() + expiresIn * 1000 };
  await saveShopIntegration(db, {
    shopId: integration.shopId,
    provider: "quickbooks",
    credentials: next,
    externalAccountId: integration.externalAccountId,
    externalLabel: integration.externalLabel,
    settings: integration.settings,
  });
  return next;
}

function quickBooksApiOrigin(environment: QuickBooksEnvironment): string {
  return environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

async function quickBooksRequest(
  db: DbExecutor,
  integration: ShopIntegration,
  config: QuickBooksConfig,
  input: {
    method: "GET" | "POST";
    resource: string;
    /** Extra query, ahead of the version and request id (`operation=void`). */
    query?: string;
    requestId: string;
    body?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch,
  deliverySignal?: AbortSignal,
): Promise<
  | { status: "ok"; data: Record<string, unknown> }
  | { status: "failed"; code: string; retryable: boolean }
> {
  if (!integration.externalAccountId)
    return { status: "failed", code: "quickbooks_missing_realm", retryable: false };
  const stored = await readIntegrationCredentials(integration);
  if (stored.status !== "ok")
    return { status: "failed", code: `quickbooks_${stored.status}`, retryable: false };
  let credentials = asQuickBooksCredentials(stored.credentials);
  if (!credentials)
    return { status: "failed", code: "quickbooks_invalid_credentials", retryable: false };
  if (credentials.expiresAt <= nowMs() + 60_000) {
    try {
      credentials = await refreshQuickBooksCredentials(
        db,
        integration,
        config,
        credentials,
        fetchImpl,
        deliverySignal,
      );
    } catch (error) {
      if (error instanceof QuickBooksRefreshTimeoutError) {
        return { status: "failed", code: "quickbooks_refresh_timeout", retryable: true };
      }
      throw error;
    }
    if (!credentials)
      return { status: "failed", code: "quickbooks_refresh_failed", retryable: false };
  }

  let responseSignal: AbortSignal | undefined;
  const request = async (token: string) => {
    const signal = combineDeliverySignals(deliverySignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    responseSignal = signal;
    return untilAborted(
      () =>
        fetchImpl(
          `${quickBooksApiOrigin(config.environment)}/v3/company/${encodeURIComponent(integration.externalAccountId as string)}/${input.resource}?${input.query ? `${input.query}&` : ""}minorversion=75&requestid=${encodeURIComponent(input.requestId)}`,
          {
            signal,
            method: input.method,
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/json",
              "content-type": "application/json",
            },
            body: input.body ? JSON.stringify(input.body) : undefined,
          },
        ),
      signal,
    ).catch((error: unknown) => {
      if (error instanceof IntegrationDeliveryDeadlineError && deliverySignal?.aborted) throw error;
      return null;
    });
  };

  let response = await request(credentials.accessToken);
  if (response?.status === 401) {
    try {
      credentials = await refreshQuickBooksCredentials(
        db,
        integration,
        config,
        credentials,
        fetchImpl,
        deliverySignal,
      );
    } catch (error) {
      if (error instanceof QuickBooksRefreshTimeoutError) {
        return { status: "failed", code: "quickbooks_refresh_timeout", retryable: true };
      }
      throw error;
    }
    if (!credentials)
      return { status: "failed", code: "quickbooks_refresh_failed", retryable: false };
    response = await request(credentials.accessToken);
  }
  if (!response) return { status: "failed", code: "quickbooks_api_unavailable", retryable: true };
  let data: Record<string, unknown> | null;
  try {
    data = await responseJsonWithinDeadline<Record<string, unknown>>(
      response,
      responseSignal as AbortSignal,
    );
  } catch (error) {
    if (error instanceof IntegrationDeliveryDeadlineError) {
      if (deliverySignal?.aborted) throw error;
      return { status: "failed", code: "quickbooks_api_unavailable", retryable: true };
    }
    data = null;
  }
  if (!response.ok || !data) {
    return {
      status: "failed",
      code: response.status >= 500 ? "quickbooks_api_unavailable" : "quickbooks_api_refused",
      retryable: response.status >= 500 || response.status === 429,
    };
  }
  return { status: "ok", data };
}

function responseId(data: Record<string, unknown>, entity: string): string | null {
  const entityValue = data[entity];
  if (!entityValue || typeof entityValue !== "object") return null;
  const id = (entityValue as { Id?: unknown }).Id;
  return typeof id === "string" ? id : null;
}

async function ensureQuickBooksCustomer(
  db: DbExecutor,
  integration: ShopIntegration,
  config: QuickBooksConfig,
  payload: QuickBooksOrderPayload,
  eventId: string,
  fetchImpl: typeof fetch,
  deliverySignal?: AbortSignal,
): Promise<{ status: "ok"; id: string } | { status: "failed"; code: string; retryable: boolean }> {
  const existing = await getIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "quickbooks_customer",
    sourceId: payload.customer.id,
    operation: "customer",
  });
  if (existing) return { status: "ok", id: existing.externalId };
  const body: Record<string, unknown> = {
    DisplayName: `${payload.customer.name} (${payload.customer.id.slice(0, 8)})`,
  };
  if (payload.customer.email) body.PrimaryEmailAddr = { Address: payload.customer.email };
  const result = await quickBooksRequest(
    db,
    integration,
    config,
    { method: "POST", resource: "customer", requestId: `${eventId}-customer`, body },
    fetchImpl,
    deliverySignal,
  );
  if (result.status !== "ok") return result;
  const id = responseId(result.data, "Customer");
  if (!id) return { status: "failed", code: "quickbooks_customer_missing_id", retryable: false };
  await upsertIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "quickbooks_customer",
    sourceId: payload.customer.id,
    operation: "customer",
    externalId: id,
  });
  return { status: "ok", id };
}

async function ensureQuickBooksItem(
  db: DbExecutor,
  integration: ShopIntegration,
  config: QuickBooksConfig,
  incomeAccountId: string,
  eventId: string,
  fetchImpl: typeof fetch,
  deliverySignal?: AbortSignal,
): Promise<{ status: "ok"; id: string } | { status: "failed"; code: string; retryable: boolean }> {
  const existing = await getIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "quickbooks_item",
    sourceId: "diveday-sales",
    operation: "item",
  });
  if (existing) return { status: "ok", id: existing.externalId };
  const result = await quickBooksRequest(
    db,
    integration,
    config,
    {
      method: "POST",
      resource: "item",
      requestId: `${eventId}-item`,
      body: {
        Name: "DiveDay sales",
        Type: "Service",
        IncomeAccountRef: { value: incomeAccountId },
      },
    },
    fetchImpl,
    deliverySignal,
  );
  if (result.status !== "ok") return result;
  const id = responseId(result.data, "Item");
  if (!id) return { status: "failed", code: "quickbooks_item_missing_id", retryable: false };
  await upsertIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "quickbooks_item",
    sourceId: "diveday-sales",
    operation: "item",
    externalId: id,
  });
  return { status: "ok", id };
}

export async function deliverQuickBooksEvent(
  db: DbExecutor,
  integration: ShopIntegration,
  event: IntegrationEvent,
  config: QuickBooksConfig,
  fetchImpl: typeof fetch = fetch,
  deliverySignal?: AbortSignal,
): Promise<{ status: "delivered" } | { status: "failed"; code: string; retryable: boolean }> {
  if (event.eventType === "order.voided") {
    return voidQuickBooksSalesReceipt(db, integration, event, config, fetchImpl, deliverySignal);
  }
  if (event.eventType !== "order.paid" && event.eventType !== "order.refunded") {
    return { status: "delivered" };
  }
  if (
    event.eventType === "order.paid" &&
    (await orderHasIntegrationEvent(db, {
      shopId: integration.shopId,
      orderId: event.entityId,
      eventType: "order.voided",
    }))
  ) {
    // The void went first and found nothing to undo; booking the sale now would leave it standing.
    return { status: "delivered" };
  }
  const incomeAccountId = integration.settings.incomeAccountId?.trim();
  if (!incomeAccountId)
    return { status: "failed", code: "quickbooks_income_account_missing", retryable: false };
  const payload = event.payload as unknown as QuickBooksOrderPayload;
  const customer = await ensureQuickBooksCustomer(
    db,
    integration,
    config,
    payload,
    event.id,
    fetchImpl,
    deliverySignal,
  );
  if (customer.status !== "ok") return customer;
  const item = await ensureQuickBooksItem(
    db,
    integration,
    config,
    incomeAccountId,
    event.id,
    fetchImpl,
    deliverySignal,
  );
  if (item.status !== "ok") return item;
  const operation = event.eventType === "order.paid" ? "sales_receipt" : "refund_receipt";
  /**
   * A sales receipt happens once per order, so the order is its identity. A
   * refund receipt does not: `partly_refunded -> partly_refunded` is a
   * supported transition (issue #699), `refundOrder` emits one event per slice
   * carrying that slice's delta, and `quickBooksRefundReceipt` posts the delta.
   * Keying the guard on the order made the *second* slice look already
   * delivered, so it was closed as successful with no API call and no error --
   * the shop's books kept the first refund and silently lost every one after
   * it. The event's idempotency key is per refund and stable across retries.
   */
  const syncSourceId = operation === "refund_receipt" ? event.idempotencyKey : event.entityId;
  const existing = await getIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "quickbooks_order",
    sourceId: syncSourceId,
    operation,
  });
  if (existing) return { status: "delivered" };
  const body =
    event.eventType === "order.paid"
      ? quickBooksSalesReceipt(payload, customer.id, item.id)
      : quickBooksRefundReceipt(payload, customer.id, item.id);
  const result = await quickBooksRequest(
    db,
    integration,
    config,
    {
      method: "POST",
      resource: event.eventType === "order.paid" ? "salesreceipt" : "refundreceipt",
      requestId: event.id,
      body,
    },
    fetchImpl,
    deliverySignal,
  );
  if (result.status !== "ok") return result;
  const entity = event.eventType === "order.paid" ? "SalesReceipt" : "RefundReceipt";
  const externalId = responseId(result.data, entity);
  if (!externalId)
    return { status: "failed", code: "quickbooks_receipt_missing_id", retryable: false };
  await upsertIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "quickbooks_order",
    sourceId: syncSourceId,
    operation,
    externalId,
  });
  await markIntegrationHealthy(db, integration.id);
  return { status: "delivered" };
}

/**
 * Void the sales receipt this order booked (issue #2309). QuickBooks voids in
 * place, zeroing the receipt and keeping it for the audit trail; it wants the
 * receipt's current `SyncToken`, so it is read first. An order whose sale was
 * never booked here (no `sales_receipt` record) has nothing to undo, and a
 * `sales_receipt_void` record makes a redelivery a no-op. The void's own
 * request id is the event's, so a retry after a lost answer is not a second
 * void either.
 */
async function voidQuickBooksSalesReceipt(
  db: DbExecutor,
  integration: ShopIntegration,
  event: IntegrationEvent,
  config: QuickBooksConfig,
  fetchImpl: typeof fetch,
  deliverySignal?: AbortSignal,
): Promise<{ status: "delivered" } | { status: "failed"; code: string; retryable: boolean }> {
  const lookup = {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "quickbooks_order",
    sourceId: event.entityId,
  };
  const booked = await getIntegrationSyncRecord(db, { ...lookup, operation: "sales_receipt" });
  if (!booked) return { status: "delivered" };
  if (await getIntegrationSyncRecord(db, { ...lookup, operation: "sales_receipt_void" })) {
    return { status: "delivered" };
  }
  const read = await quickBooksRequest(
    db,
    integration,
    config,
    {
      method: "GET",
      resource: `salesreceipt/${encodeURIComponent(booked.externalId)}`,
      requestId: `${event.id}:read`,
    },
    fetchImpl,
    deliverySignal,
  );
  if (read.status !== "ok") return read;
  const receipt = read.data.SalesReceipt as { SyncToken?: unknown } | undefined;
  if (typeof receipt?.SyncToken !== "string")
    return { status: "failed", code: "quickbooks_receipt_missing_sync_token", retryable: false };
  const voided = await quickBooksRequest(
    db,
    integration,
    config,
    {
      method: "POST",
      resource: "salesreceipt",
      query: "operation=void",
      requestId: event.id,
      body: { Id: booked.externalId, SyncToken: receipt.SyncToken, sparse: true },
    },
    fetchImpl,
    deliverySignal,
  );
  if (voided.status !== "ok") return voided;
  await upsertIntegrationSyncRecord(db, {
    ...lookup,
    operation: "sales_receipt_void",
    externalId: booked.externalId,
  });
  await markIntegrationHealthy(db, integration.id);
  return { status: "delivered" };
}
