import { z } from "zod";
import { log } from "@/lib/log";
import { type StripeKeySource, StripeKeyUnavailableError, secretKeyForCall } from "./stripe-keys";
import { logStripeRequestThrew } from "./stripe-request-log";

/**
 * **Which DiveDay object a Stripe PaymentIntent paid for**, asked of Stripe.
 *
 * A refund or a dispute made outside DiveDay reaches the webhook naming only a
 * charge and its PaymentIntent (ADR 20261009-stripe-reversals-reach-diveday).
 * DiveDay records that PaymentIntent on the order or checkout as it settles,
 * so the ordinary answer is a local lookup and this module is never called.
 * It is the fallback for a settlement whose event did not carry the intent —
 * an invoice whose `payments` list Stripe left out of the event body — and it
 * asks the two list endpoints that can answer by PaymentIntent:
 *
 * - `GET /v1/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=…`
 * - `GET /v1/checkout/sessions?payment_intent=…`
 *
 * Read-only: nothing here moves money or carries an idempotency key.
 *
 * `failed` is distinct from `none` on purpose. `none` is Stripe saying this
 * charge is nothing DiveDay raised (the shop's own till on the same account),
 * which is settled and needs no retry; `failed` is Stripe being unreachable,
 * and the webhook answers non-2xx so Stripe delivers the event again.
 *
 * Only an answer that could differ next time is `failed`: the network, a 429,
 * a 5xx. A 4xx is Stripe refusing the question itself (a revoked connection, a
 * PaymentIntent the platform key cannot see), which no retry changes, so it is
 * logged and read as `none` — a retry loop would only run out Stripe's
 * redeliveries and hold the event's claim the whole time.
 */
export type PaymentSource =
  | { status: "invoice"; stripeInvoiceId: string }
  | { status: "checkout_session"; stripeSessionId: string }
  | { status: "none" }
  | { status: "not_configured" }
  | { status: "failed" };

export interface PaymentSourceLookup {
  findSource(stripeAccountId: string, paymentIntentId: string): Promise<PaymentSource>;
}

type Fetch = typeof fetch;

const invoicePaymentListSchema = z.object({
  data: z.array(
    z.object({
      invoice: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
    }),
  ),
});

const sessionListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })),
});

/** `true` for a live key, `false` for a test key, null when the prefix says neither. */
export function keyLivemode(secretKey: string): boolean | null {
  if (/^(sk|rk)_live_/.test(secretKey)) return true;
  if (/^(sk|rk)_test_/.test(secretKey)) return false;
  return null;
}

/**
 * The lookup over a key source, for an event of the given mode. Each question
 * is asked with the key chosen for the event's own account
 * (`stripeSecretKeyFor`, ADR 20261009-demo-test-mode-payments), so the demo's
 * account is asked with its test-mode key on a live deployment (issue #2296).
 * A key of the other mode than the event's would only earn a 4xx, so it answers
 * `not_configured` without a call; so does an account that may have no key.
 */
export function stripePaymentSourceLookup(
  keys: StripeKeySource,
  fetchImpl: Fetch,
  event: { livemode?: boolean } = {},
): PaymentSourceLookup {
  const get = (secretKey: string, stripeAccountId: string, path: string) =>
    fetchImpl(`https://api.stripe.com/v1${path}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Stripe-Account": stripeAccountId,
      },
    });

  /** `none` for a refusal no retry changes; `failed` for one that might pass. */
  const unanswered = (response: Response, step: string): PaymentSource => {
    if (response.status === 429 || response.status >= 500) return { status: "failed" };
    log("stripe_payment_source.refused", "warn", { step, httpStatus: response.status });
    return { status: "none" };
  };

  return {
    async findSource(stripeAccountId, paymentIntentId) {
      let secretKey: string;
      try {
        secretKey = await secretKeyForCall(keys, stripeAccountId);
      } catch (error) {
        if (error instanceof StripeKeyUnavailableError) return { status: "not_configured" };
        throw error;
      }
      const mode = keyLivemode(secretKey);
      if (event.livemode !== undefined && mode !== null && mode !== event.livemode) {
        return { status: "not_configured" };
      }
      try {
        const invoiceQuery = new URLSearchParams({
          "payment[type]": "payment_intent",
          "payment[payment_intent]": paymentIntentId,
          limit: "1",
        });
        const invoiceResponse = await get(
          secretKey,
          stripeAccountId,
          `/invoice_payments?${invoiceQuery.toString()}`,
        );
        if (!invoiceResponse.ok) return unanswered(invoiceResponse, "invoice_payments");
        const invoices = invoicePaymentListSchema.safeParse(await invoiceResponse.json());
        if (!invoices.success) return { status: "failed" };
        const invoice = invoices.data.data[0]?.invoice;
        if (invoice) {
          return {
            status: "invoice",
            stripeInvoiceId: typeof invoice === "string" ? invoice : invoice.id,
          };
        }

        const sessionQuery = new URLSearchParams({ payment_intent: paymentIntentId, limit: "1" });
        const sessionResponse = await get(
          secretKey,
          stripeAccountId,
          `/checkout/sessions?${sessionQuery.toString()}`,
        );
        if (!sessionResponse.ok) return unanswered(sessionResponse, "checkout_sessions");
        const sessions = sessionListSchema.safeParse(await sessionResponse.json());
        if (!sessions.success) return { status: "failed" };
        const session = sessions.data.data[0];
        return session
          ? { status: "checkout_session", stripeSessionId: session.id }
          : { status: "none" };
      } catch (error) {
        logStripeRequestThrew("find_payment_source", error);
        return { status: "failed" };
      }
    },
  };
}

const disabledPaymentSourceLookup: PaymentSourceLookup = {
  async findSource() {
    return { status: "not_configured" };
  },
};

/**
 * The lookup for a key source, or one that answers `not_configured` when there
 * is none. The environment's key source reads who holds each account from the
 * database, so it is built in `src/db/stripe-providers.ts`
 * (`paymentSourceLookupFromEnvironment`).
 */
export function paymentSourceLookupFor(
  keys: StripeKeySource | null,
  fetchImpl: Fetch = fetch,
  event: { livemode?: boolean } = {},
): PaymentSourceLookup {
  return keys ? stripePaymentSourceLookup(keys, fetchImpl, event) : disabledPaymentSourceLookup;
}
