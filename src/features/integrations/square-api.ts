import { z } from "zod";
import { nowMs } from "@/lib/clock";

/** Read-only receipt evidence. No payment, refund, customer or catalog write scope. */
export const SQUARE_SCOPES = ["PAYMENTS_READ", "MERCHANT_PROFILE_READ"] as const;
export const SQUARE_API_VERSION = "2026-09-16";
const REQUEST_TIMEOUT_MS = 15_000;
export type SquareEnvironment = "sandbox" | "production";
export type SquareConfig = {
  clientId: string;
  clientSecret: string;
  environment: SquareEnvironment;
};
export type SquareCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  merchantId: string;
};
export const squareId = z
  .string()
  .min(1)
  .max(192)
  .regex(/^[A-Za-z0-9_-]+$/);
const money = z.object({
  amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const paymentSchema = z.object({
  id: squareId,
  location_id: squareId,
  status: z.enum(["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED"]),
  total_money: money,
  tip_money: money.optional(),
  refunded_money: money.optional(),
  receipt_number: z.string().max(32).optional(),
});
export type SquareReceipt = {
  paymentId: string;
  locationId: string;
  status: string;
  totalCents: number;
  tipCents: number;
  refundedCents: number;
  currency: string;
  receiptNumber: string | null;
};
export type SquareLocation = { id: string; name: string; currency: string; merchantId: string };
const locationSchema = z.object({
  id: squareId,
  name: z.string().max(255),
  currency: z.string().regex(/^[A-Z]{3}$/),
  merchant_id: squareId,
  status: z.string(),
});

export function squareConfigFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SquareConfig | null {
  const clientId = env.SQUARE_CLIENT_ID?.trim();
  const clientSecret = env.SQUARE_CLIENT_SECRET?.trim();
  const environment = env.SQUARE_ENVIRONMENT?.trim();
  // Explicit, rather than silently sending sandbox credentials to production.
  if (!clientId || !clientSecret || (environment !== "sandbox" && environment !== "production"))
    return null;
  return { clientId, clientSecret, environment };
}

export function squareApiOrigin(environment: SquareEnvironment) {
  return environment === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

export function squareAuthorizationUrl(input: {
  config: SquareConfig;
  state: string;
  redirectUri: string;
}): string {
  const url = new URL("/oauth2/authorize", squareApiOrigin(input.config.environment));
  url.search = new URLSearchParams({
    client_id: input.config.clientId,
    scope: SQUARE_SCOPES.join(" "),
    state: input.state,
    redirect_uri: input.redirectUri,
    session: "false",
  }).toString();
  return url.toString();
}

async function requestJson(
  config: SquareConfig,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  try {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(new URL(path, squareApiOrigin(config.environment)), {
      ...init,
      cache: "no-store",
      signal,
      headers: {
        "Square-Version": SQUARE_API_VERSION,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) return null;
    // The same signal bounds fetching and reading the response body.
    return await response.json();
  } catch {
    return null;
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
  merchant_id: squareId,
});
async function tokenRequest(
  config: SquareConfig,
  grant: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<SquareCredentials | null> {
  const parsed = tokenSchema.safeParse(
    await requestJson(
      config,
      "/oauth2/token",
      {
        method: "POST",
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          ...grant,
        }),
      },
      fetchImpl,
    ),
  );
  if (!parsed.success) return null;
  const expiresAt = Date.parse(parsed.data.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs()) return null;
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt,
    merchantId: parsed.data.merchant_id,
  };
}

export function exchangeSquareCode(
  input: { config: SquareConfig; code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    input.config,
    { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri },
    fetchImpl,
  );
}

export function refreshSquareToken(
  config: SquareConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    config,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl,
  );
}

export async function listSquareLocations(
  config: SquareConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SquareLocation[] | null> {
  const parsed = z
    .object({ locations: z.array(locationSchema).default([]) })
    .safeParse(
      await requestJson(
        config,
        "/v2/locations",
        { headers: { authorization: `Bearer ${accessToken}` } },
        fetchImpl,
      ),
    );
  if (!parsed.success) return null;
  return parsed.data.locations
    .filter((location) => location.status === "ACTIVE")
    .map((location) => ({
      id: location.id,
      name: location.name,
      currency: location.currency.toLowerCase(),
      merchantId: location.merchant_id,
    }));
}

/** Deliberately discard card details, contacts, device data, URLs and provider errors. */
export async function readSquareReceipt(
  config: SquareConfig,
  accessToken: string,
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SquareReceipt | null> {
  if (!squareId.safeParse(paymentId).success) return null;
  const parsed = z
    .object({ payment: paymentSchema })
    .safeParse(
      await requestJson(
        config,
        `/v2/payments/${encodeURIComponent(paymentId)}`,
        { headers: { authorization: `Bearer ${accessToken}` } },
        fetchImpl,
      ),
    );
  if (!parsed.success || parsed.data.payment.id !== paymentId) return null;
  const payment = parsed.data.payment;
  const currency = payment.total_money.currency;
  if (
    [payment.tip_money, payment.refunded_money].some(
      (value) => value && value.currency !== currency,
    )
  )
    return null;
  if (
    (payment.tip_money?.amount ?? 0) > payment.total_money.amount ||
    (payment.refunded_money?.amount ?? 0) > payment.total_money.amount
  )
    return null;
  return {
    paymentId,
    locationId: payment.location_id,
    status: payment.status,
    currency: currency.toLowerCase(),
    totalCents: payment.total_money.amount,
    tipCents: payment.tip_money?.amount ?? 0,
    refundedCents: payment.refunded_money?.amount ?? 0,
    receiptNumber: payment.receipt_number ?? null,
  };
}
