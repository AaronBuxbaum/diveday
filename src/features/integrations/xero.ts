import type { DbExecutor } from "@/db/client";
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

export const XERO_AUTHORIZATION_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API_ORIGIN = "https://api.xero.com/api.xro/2.0";

/**
 * `offline_access` is what buys the refresh token, and without it a connection
 * dies thirty minutes after the shop makes it. The other two are the narrowest
 * pair that can write a receipt: a contact to attach it to, and the transaction
 * itself. No `accounting.settings`, so DiveDay cannot read or edit the chart of
 * accounts — the shop types its two account codes in Settings instead.
 */
export const XERO_SCOPE = "offline_access accounting.transactions accounting.contacts";

/** A per-request ceiling on every outbound call, for the reason quickbooks.ts states. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Xero refuses an `Idempotency-Key` longer than this. */
const IDEMPOTENCY_KEY_MAX = 128;

const TENANT_ID = /^[0-9a-fA-F-]{36}$/;
const TENANT_NAME_MAX = 120;

export type XeroConfig = {
  clientId: string;
  clientSecret: string;
};

export type XeroCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type XeroOrderPayload = {
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

export function xeroConfigFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): XeroConfig | null {
  const clientId = env.XERO_CLIENT_ID?.trim();
  const clientSecret = env.XERO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function xeroAuthorizationUrl(input: {
  config: XeroConfig;
  state: string;
  redirectUri: string;
}): string {
  const url = new URL(XERO_AUTHORIZATION_URL);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", XERO_SCOPE);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

function basicAuth(config: XeroConfig): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

function readTokenPayload(
  payload: Record<string, unknown> | null,
  fallbackRefreshToken?: string,
): XeroCredentials | null {
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : null;
  const refreshToken =
    typeof payload?.refresh_token === "string"
      ? payload.refresh_token
      : (fallbackRefreshToken ?? null);
  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : null;
  if (!accessToken || !refreshToken || !expiresIn) return null;
  return { accessToken, refreshToken, expiresAt: nowMs() + expiresIn * 1000 };
}

export async function exchangeXeroCode(
  input: { config: XeroConfig; code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<
  { status: "connected"; credentials: XeroCredentials } | { status: "failed"; code: string }
> {
  const response = await fetchImpl(XERO_TOKEN_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: "POST",
    headers: {
      authorization: `Basic ${basicAuth(input.config)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  }).catch(() => null);
  if (!response) return { status: "failed", code: "xero_exchange_unavailable" };
  if (!response.ok) return { status: "failed", code: "xero_exchange_refused" };
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const credentials = readTokenPayload(payload);
  if (!credentials) return { status: "failed", code: "xero_exchange_invalid" };
  return { status: "connected", credentials };
}

/**
 * Which Xero organisation the shop just authorized.
 *
 * A Xero token is not addressed to an organisation on its own; every Accounting
 * API call carries an `xero-tenant-id` header, and the only way to learn one is
 * this endpoint. It is read once, at connect time, and stored as the
 * connection's `external_account_id` — the same slot QuickBooks fills with its
 * realm id. That is the whole of what DiveDay reads back from Xero: an address
 * for its own writes, never a fact (ADR 20260827).
 */
export async function fetchXeroTenant(
  credentials: XeroCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<
  { status: "ok"; tenantId: string; tenantName: string } | { status: "failed"; code: string }
> {
  const response = await fetchImpl(XERO_CONNECTIONS_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      accept: "application/json",
    },
  }).catch(() => null);
  if (!response) return { status: "failed", code: "xero_connections_unavailable" };
  if (!response.ok) return { status: "failed", code: "xero_connections_refused" };
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) return { status: "failed", code: "xero_connections_invalid" };
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { tenantId?: unknown; tenantName?: unknown; tenantType?: unknown };
    if (row.tenantType !== undefined && row.tenantType !== "ORGANISATION") continue;
    // The id is checked against its shape here rather than trusted, because it
    // goes on to be a *header* on every write: a value carrying a newline makes
    // `fetch` throw instead of answering, which this module reads as a network
    // failure and retries forever. Xero's own ids are UUIDs.
    if (typeof row.tenantId !== "string" || !TENANT_ID.test(row.tenantId)) continue;
    return {
      status: "ok",
      tenantId: row.tenantId,
      // The organisation's own name, shown on the Settings card. Bounded so a
      // long one cannot run away with the row it is rendered in.
      tenantName:
        typeof row.tenantName === "string" && row.tenantName.trim().length > 0
          ? row.tenantName.trim().slice(0, TENANT_NAME_MAX)
          : row.tenantId,
    };
  }
  return { status: "failed", code: "xero_no_organisation" };
}

export type XeroAccountCodes = { salesAccountCode: string; bankAccountCode: string };

/**
 * The money DiveDay already took, written the way Xero writes cash.
 *
 * Xero has no SalesReceipt entity. Its cash-sale equivalent is a bank
 * transaction — `RECEIVE` for a payment in, `SPEND` for a refund out — which
 * lands the sale on the shop's income account and the cash on its bank account
 * in one call, with nothing left sitting in accounts receivable. An invoice
 * would be the wrong shape: DiveDay only ever reports money that has already
 * moved through Stripe, so a shop's Xero should never show a DiveDay debtor.
 *
 * `LineAmountTypes: "NoTax"` because DiveDay carries no tax breakdown on an
 * order. Inventing one would be a number the shop's accountant did not choose.
 */
export function xeroBankTransaction(
  payload: XeroOrderPayload,
  contactId: string,
  input: XeroAccountCodes & { type: "RECEIVE" | "SPEND" },
) {
  const refundCents = payload.refundCents ?? payload.refundedCents;
  const lineItems =
    input.type === "RECEIVE"
      ? payload.lineItems.map((line) => ({
          Description: line.description,
          Quantity: line.quantity,
          UnitAmount: minorToMajor(line.unitAmountCents, payload.currency),
          AccountCode: input.salesAccountCode,
        }))
      : [
          {
            Description: `Refund for DiveDay order ${payload.orderId}`,
            Quantity: 1,
            UnitAmount: minorToMajor(refundCents, payload.currency),
            AccountCode: input.salesAccountCode,
          },
        ];
  return {
    Type: input.type,
    Contact: { ContactID: contactId },
    Date: payload.createdAt.slice(0, 10),
    Reference:
      input.type === "RECEIVE"
        ? `DiveDay order ${payload.orderId}`
        : `DiveDay refund for order ${payload.orderId}`,
    CurrencyCode: payload.currency.toUpperCase(),
    BankAccount: { Code: input.bankAccountCode },
    LineAmountTypes: "NoTax",
    LineItems: lineItems,
  };
}

function credentialString(credentials: IntegrationCredentials, key: string): string | null {
  const value = credentials[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asXeroCredentials(credentials: IntegrationCredentials): XeroCredentials | null {
  const accessToken = credentialString(credentials, "accessToken");
  const refreshToken = credentialString(credentials, "refreshToken");
  const expiresAt = credentials.expiresAt;
  return accessToken && refreshToken && typeof expiresAt === "number"
    ? { accessToken, refreshToken, expiresAt }
    : null;
}

/**
 * Xero rotates the refresh token on every use, so the answer is persisted
 * before it is returned. Dropping it would leave the stored token spent and the
 * connection dead at the next cron pass rather than at the next hour.
 */
async function refreshXeroCredentials(
  db: DbExecutor,
  integration: ShopIntegration,
  config: XeroConfig,
  credentials: XeroCredentials,
  fetchImpl: typeof fetch,
): Promise<XeroCredentials | null> {
  const response = await fetchImpl(XERO_TOKEN_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: "POST",
    headers: {
      authorization: `Basic ${basicAuth(config)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    }),
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const next = readTokenPayload(payload, credentials.refreshToken);
  if (!next) return null;
  await saveShopIntegration(db, {
    shopId: integration.shopId,
    provider: "xero",
    credentials: next,
    externalAccountId: integration.externalAccountId,
    externalLabel: integration.externalLabel,
    settings: integration.settings,
  });
  return next;
}

async function xeroRequest(
  db: DbExecutor,
  integration: ShopIntegration,
  config: XeroConfig,
  input: { resource: string; idempotencyKey: string; body: Record<string, unknown> },
  fetchImpl: typeof fetch,
): Promise<
  | { status: "ok"; data: Record<string, unknown> }
  | { status: "failed"; code: string; retryable: boolean }
> {
  const tenantId = integration.externalAccountId;
  if (!tenantId) return { status: "failed", code: "xero_missing_tenant", retryable: false };
  const stored = await readIntegrationCredentials(integration);
  if (stored.status !== "ok")
    return { status: "failed", code: `xero_${stored.status}`, retryable: false };
  let credentials = asXeroCredentials(stored.credentials);
  if (!credentials) return { status: "failed", code: "xero_invalid_credentials", retryable: false };
  if (credentials.expiresAt <= nowMs() + 60_000) {
    credentials = await refreshXeroCredentials(db, integration, config, credentials, fetchImpl);
    if (!credentials) return { status: "failed", code: "xero_refresh_failed", retryable: false };
  }

  const request = async (token: string) =>
    fetchImpl(`${XERO_API_ORIGIN}/${input.resource}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "xero-tenant-id": tenantId,
        accept: "application/json",
        "content-type": "application/json",
        "Idempotency-Key": input.idempotencyKey.slice(0, IDEMPOTENCY_KEY_MAX),
      },
      body: JSON.stringify(input.body),
    }).catch(() => null);

  let response = await request(credentials.accessToken);
  if (response?.status === 401) {
    credentials = await refreshXeroCredentials(db, integration, config, credentials, fetchImpl);
    if (!credentials) return { status: "failed", code: "xero_refresh_failed", retryable: false };
    response = await request(credentials.accessToken);
  }
  if (!response) return { status: "failed", code: "xero_api_unavailable", retryable: true };
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    return {
      status: "failed",
      code: response.status >= 500 ? "xero_api_unavailable" : "xero_api_refused",
      retryable: response.status >= 500 || response.status === 429,
    };
  }
  return { status: "ok", data };
}

/** Xero answers every Accounting API write with a one-element array of the entity it wrote. */
function firstEntityId(
  data: Record<string, unknown>,
  collection: string,
  idField: string,
): string | null {
  const entries = data[collection];
  if (!Array.isArray(entries)) return null;
  const first = entries[0];
  if (!first || typeof first !== "object") return null;
  const id = (first as Record<string, unknown>)[idField];
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function ensureXeroContact(
  db: DbExecutor,
  integration: ShopIntegration,
  config: XeroConfig,
  payload: XeroOrderPayload,
  eventId: string,
  fetchImpl: typeof fetch,
): Promise<{ status: "ok"; id: string } | { status: "failed"; code: string; retryable: boolean }> {
  const existing = await getIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "xero_contact",
    sourceId: payload.customer.id,
    operation: "contact",
  });
  if (existing) return { status: "ok", id: existing.externalId };
  // Xero requires a contact name to be unique in the organisation, so the
  // diver's id rides along exactly as it does for QuickBooks' DisplayName.
  const contact: Record<string, unknown> = {
    Name: `${payload.customer.name} (${payload.customer.id.slice(0, 8)})`,
  };
  if (payload.customer.email) contact.EmailAddress = payload.customer.email;
  const result = await xeroRequest(
    db,
    integration,
    config,
    { resource: "Contacts", idempotencyKey: `${eventId}-contact`, body: { Contacts: [contact] } },
    fetchImpl,
  );
  if (result.status !== "ok") return result;
  const id = firstEntityId(result.data, "Contacts", "ContactID");
  if (!id) return { status: "failed", code: "xero_contact_missing_id", retryable: false };
  await upsertIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "xero_contact",
    sourceId: payload.customer.id,
    operation: "contact",
    externalId: id,
  });
  return { status: "ok", id };
}

export async function deliverXeroEvent(
  db: DbExecutor,
  integration: ShopIntegration,
  event: IntegrationEvent,
  config: XeroConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "delivered" } | { status: "failed"; code: string; retryable: boolean }> {
  if (event.eventType !== "order.paid" && event.eventType !== "order.refunded") {
    return { status: "delivered" };
  }
  const salesAccountCode = integration.settings.salesAccountCode?.trim();
  const bankAccountCode = integration.settings.bankAccountCode?.trim();
  if (!salesAccountCode || !bankAccountCode)
    return { status: "failed", code: "xero_account_codes_missing", retryable: false };
  const payload = event.payload as unknown as XeroOrderPayload;
  const contact = await ensureXeroContact(db, integration, config, payload, event.id, fetchImpl);
  if (contact.status !== "ok") return contact;

  const type = event.eventType === "order.paid" ? "RECEIVE" : "SPEND";
  const operation = type === "RECEIVE" ? "receive_transaction" : "spend_transaction";
  /**
   * A receive happens once per order, so the order is its identity. A refund
   * does not: an order can be refunded in slices (issue #699) and each slice
   * carries its own delta, so keying the guard on the order would close every
   * slice after the first as already delivered and quietly lose the money —
   * the exact failure quickbooks.ts records. The event's idempotency key is per
   * refund and stable across retries.
   */
  const syncSourceId = type === "SPEND" ? event.idempotencyKey : event.entityId;
  const existing = await getIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "xero_bank_transaction",
    sourceId: syncSourceId,
    operation,
  });
  if (existing) return { status: "delivered" };

  const result = await xeroRequest(
    db,
    integration,
    config,
    {
      resource: "BankTransactions",
      idempotencyKey: event.id,
      body: {
        BankTransactions: [
          xeroBankTransaction(payload, contact.id, {
            type,
            salesAccountCode,
            bankAccountCode,
          }),
        ],
      },
    },
    fetchImpl,
  );
  if (result.status !== "ok") return result;
  const externalId = firstEntityId(result.data, "BankTransactions", "BankTransactionID");
  if (!externalId)
    return { status: "failed", code: "xero_transaction_missing_id", retryable: false };
  await upsertIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "xero_bank_transaction",
    sourceId: syncSourceId,
    operation,
    externalId,
  });
  await markIntegrationHealthy(db, integration.id);
  return { status: "delivered" };
}
