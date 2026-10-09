import { z } from "zod";
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

export function stripePaymentSourceLookup(
  config: { secretKey: string },
  fetchImpl: Fetch,
): PaymentSourceLookup {
  const get = (stripeAccountId: string, path: string) =>
    fetchImpl(`https://api.stripe.com/v1${path}`, {
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Account": stripeAccountId,
      },
    });

  return {
    async findSource(stripeAccountId, paymentIntentId) {
      try {
        const invoiceQuery = new URLSearchParams({
          "payment[type]": "payment_intent",
          "payment[payment_intent]": paymentIntentId,
          limit: "1",
        });
        const invoiceResponse = await get(
          stripeAccountId,
          `/invoice_payments?${invoiceQuery.toString()}`,
        );
        if (!invoiceResponse.ok) return { status: "failed" };
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
          stripeAccountId,
          `/checkout/sessions?${sessionQuery.toString()}`,
        );
        if (!sessionResponse.ok) return { status: "failed" };
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

export function paymentSourceLookupFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: Fetch = fetch,
): PaymentSourceLookup {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  return secretKey
    ? stripePaymentSourceLookup({ secretKey }, fetchImpl)
    : disabledPaymentSourceLookup;
}
