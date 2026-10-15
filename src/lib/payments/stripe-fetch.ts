/**
 * **Every request to Stripe gives up after ten seconds.**
 *
 * A bare `fetch` has no deadline of its own, so a Stripe call that never
 * answers lives as long as the serverless function does. That is not only a
 * slow page: `createTipCheckout` (`src/db/tips.ts`) calls Stripe while it holds
 * the booking row `FOR UPDATE`, so a hung request held the seat, and every
 * insert naming it (a roll-call tap), until the platform killed the function
 * (fourth review, row 17). Ten seconds matches the WhatsApp Graph bound
 * (`GRAPH_REQUEST_TIMEOUT_MS`) and is far above a healthy Stripe answer.
 *
 * Every Stripe adapter wraps the `fetch` it was handed in this, so a test's
 * fake sees the same signal production does, and `stripe-fetch.test.ts` fails
 * on an adapter that calls `api.stripe.com` without it. A timeout throws
 * `TimeoutError`, which each adapter logs through `logStripeRequestThrew`. A
 * read turns it into `{ status: "failed" }`; a refund or an invoice whose POST
 * had already gone out turns it into `{ status: "unanswered" }`, because Stripe
 * may have acted on it, and the caller leaves its intent `started` for a human
 * rather than letting a retry mint a fresh idempotency key.
 */
export const STRIPE_REQUEST_TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

export function boundedStripeFetch(
  fetchImpl: Fetch,
  timeoutMs: number = STRIPE_REQUEST_TIMEOUT_MS,
): Fetch {
  return (input, init) =>
    fetchImpl(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
}
