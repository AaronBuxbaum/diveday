import Stripe from "stripe";

/**
 * **The one way this app talks to Stripe**: the official SDK (ADR
 * 20261102-stripe-sdk-adapters), configured here once with the app's own
 * policies, which the SDK's defaults do not share.
 *
 * - **Ten seconds, then give up.** The SDK waits 80. A bare wait is not only a
 *   slow page: `createTipCheckout` (`src/db/tips.ts`) calls Stripe while it
 *   holds the booking row `FOR UPDATE`, so a hung request held the seat, and
 *   every insert naming it, until the platform killed the function (fourth
 *   review, row 17). A caller may ask for longer per request.
 * - **No silent retries.** `maxNetworkRetries: 0`, and the one retry the SDK
 *   makes anyway — a reset or broken connection, `ECONNRESET`/`EPIPE`, which
 *   it retries once even at zero — is refused in {@link wireFetch}: such a
 *   connection can close after Stripe acted, and a caller deciding between
 *   `failed` and `unanswered` has to see the request it sent, once.
 * - **A non-2xx is never a success.** The SDK reads any JSON without an
 *   `error` field as an answer, whatever the status; {@link wireFetch} gives
 *   every non-2xx an error envelope, so it always throws with its
 *   `statusCode` ({@link stripeAnsweredStatus}).
 * - **The account's own API version.** The SDK names its release's version on
 *   every request; this app sends none, so Stripe answers at the platform
 *   account's default, the version the fixtures under `__fixtures__/stripe`
 *   were captured at (`stripe-api-version.test.ts`). {@link wireFetch} removes
 *   it, and the SDK's typed resources (which describe its release's version)
 *   are therefore not used: every call is a `rawRequest` whose answer the
 *   adapter validates with its own schema.
 * - **No telemetry, no host details.** `telemetry: false` stops the timings of
 *   earlier requests; the SDK still describes its runtime (Node and SDK
 *   versions, and an AI-agent tag when it detects one) in
 *   `X-Stripe-Client-User-Agent` and `User-Agent`, so {@link wireFetch} drops
 *   the first and sends a plain `User-Agent` of its own.
 *
 * Every adapter hands in the `fetch` it was given, so a test's fake sees the
 * same request production sends, and `stripe-client.test.ts` fails on a file
 * that reaches Stripe some other way.
 */
export const STRIPE_REQUEST_TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

/** The header the SDK pins its own release's API version with; never sent (see above). */
const SDK_VERSION_HEADER = "Stripe-Version";

/** The SDK's description of its runtime; never sent (see above). */
const SDK_CLIENT_DESCRIPTION_HEADER = "X-Stripe-Client-User-Agent";
const USER_AGENT = "DiveDay";

/** What the SDK retries once even with retries off. */
const CONNECTION_CLOSED_CODES = new Set(["ECONNRESET", "EPIPE"]);

/** The `error.type` a non-2xx without Stripe's own error body is given. */
export const NO_ERROR_BODY = "diveday_no_error_body";

function plainHeaders(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}

/** The same error, without the code that would earn it the SDK's one retry. */
function notRetried(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || !CONNECTION_CLOSED_CODES.has(code)) return error;
  const closed = new Error("The connection to Stripe closed before an answer", { cause: error });
  closed.name = error instanceof Error ? error.name : "Error";
  return closed;
}

/** A non-2xx response the SDK cannot mistake for an answer. */
async function asError(response: Response): Promise<Response> {
  const init = { status: response.status, headers: response.headers };
  try {
    const text = await response.text();
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null && "error" in body)
      return new Response(text, init);
  } catch {
    // Not JSON, or the body never arrived: the status is still Stripe's answer.
  }
  return new Response(JSON.stringify({ error: { type: NO_ERROR_BODY } }), init);
}

/** The `fetch` the SDK calls: the adapter's own, under the policies above. */
export function wireFetch(fetchImpl: Fetch): Fetch {
  return async (input, init) => {
    const headers = plainHeaders(init?.headers);
    delete headers[SDK_VERSION_HEADER];
    delete headers[SDK_CLIENT_DESCRIPTION_HEADER];
    headers["User-Agent"] = USER_AGENT;
    let response: Response;
    try {
      response = await fetchImpl(input, { ...init, headers });
    } catch (error) {
      throw notRetried(error);
    }
    return response.ok ? response : asError(response);
  };
}

/** A client for one secret key. Built per call: the key is chosen per call. */
export function stripeClient(secretKey: string, fetchImpl: Fetch): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(wireFetch(fetchImpl)),
    maxNetworkRetries: 0,
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    telemetry: false,
  });
}

export type StripeRequest = {
  method: "GET" | "POST" | "DELETE";
  /** From the API root, query included for a GET: `/v1/invoices/in_1`. */
  path: string;
  /** A POST's form fields, bracketed keys as Stripe documents them. */
  params?: URLSearchParams | Record<string, string>;
  /** The connected account the request acts on; absent for the platform's own. */
  stripeAccount?: string;
  idempotencyKey?: string;
  /** Longer than {@link STRIPE_REQUEST_TIMEOUT_MS}, for the one call that needs it. */
  timeoutMs?: number;
  /** `connect.stripe.com`, for the OAuth endpoints. */
  connectHost?: boolean;
};

/**
 * One request; the parsed body, for the caller's schema to judge. Throws the
 * SDK's errors: {@link stripeAnsweredStatus} tells an answer from silence.
 */
export async function stripeRequest(
  secretKey: string,
  fetchImpl: Fetch,
  request: StripeRequest,
): Promise<unknown> {
  const params =
    request.params instanceof URLSearchParams ? Object.fromEntries(request.params) : request.params;
  return stripeClient(secretKey, fetchImpl).rawRequest(
    request.method,
    request.path,
    request.method === "POST" ? (params ?? {}) : undefined,
    {
      ...(request.stripeAccount ? { stripeAccount: request.stripeAccount } : {}),
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
      ...(request.connectHost ? { apiBase: "connect" as const } : {}),
    },
  );
}

/**
 * The HTTP status Stripe answered with, or null when no answer arrived (a
 * timeout, a closed connection, a body that was not JSON). After a mutation
 * was sent, null is `unanswered`: Stripe may have acted on it.
 */
export function stripeAnsweredStatus(error: unknown): number | null {
  return error instanceof Stripe.errors.StripeError && typeof error.statusCode === "number"
    ? error.statusCode
    : null;
}

/** Stripe's own error envelope off an answered error: `code` and `type`, never `message`. */
export function stripeErrorTokens(error: unknown): { code?: string; type?: string } {
  if (!(error instanceof Stripe.errors.StripeError)) return {};
  const rawType: string | undefined = error.rawType;
  const type = rawType === NO_ERROR_BODY ? undefined : rawType;
  return { code: error.code, type };
}

/**
 * Stripe decided and did not act: a 4xx carrying Stripe's own error envelope.
 * Not a 409, which says another request with the same idempotency key is still
 * running; not a 5xx, after which Stripe may have acted; not a gateway's
 * status without Stripe's envelope. After a mutation went out, only this is
 * `failed` — anything else is `unanswered`.
 */
export function stripeRefused(error: unknown): boolean {
  const status = stripeAnsweredStatus(error);
  if (status === null || status < 400 || status >= 500 || status === 409) return false;
  return stripeErrorTokens(error).type !== undefined;
}
