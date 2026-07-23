import { z } from "zod";

/**
 * Hosted Stripe Checkout for pay-at-booking on a shop's connected account.
 * Every call carries a `Stripe-Account` header so the shop, not the platform,
 * is the merchant of record — fetch-based, no SDK, same pattern as
 * ./invoicing.ts (docs ADR 20260721-checkout-at-booking). Payment truth only
 * ever comes from Stripe's own responses/webhooks, never from a return URL.
 */

export type CreateCheckoutSessionRequest = {
  stripeAccountId: string;
  currency: string;
  /** One priced line: the per-diver amount, quantity = party size. */
  description: string;
  unitAmountCents: number;
  quantity: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Deterministic per-attempt key (`idempotencyKeyFor`,
   * src/db/payment-operations.ts) so a retry after a lost response converges
   * on the one Checkout session Stripe already created instead of minting a
   * second one (CR-005).
   */
  idempotencyKey: string;
};

export type CheckoutSessionSnapshot = {
  stripeSessionId: string;
  /** Stripe's session lifecycle: open (payable), complete, or expired. */
  stripeStatus: string;
  /** Stripe's payment state: paid, unpaid, or no_payment_required. */
  paymentStatus: string;
  checkoutUrl: string | null;
  amountTotalCents: number;
  expiresAt: Date | null;
};

export type CreateCheckoutSessionResult =
  | ({ status: "created" } & CheckoutSessionSnapshot)
  | { status: "not_configured" }
  | { status: "failed" };

export type CheckoutSessionLookupResult =
  | { status: "ok"; session: CheckoutSessionSnapshot }
  | { status: "not_configured" }
  | { status: "failed" };

export type RefundCheckoutResult = {
  status: "refunded" | "not_configured" | "not_refundable" | "failed";
  refundId?: string;
};

export interface CheckoutProvider {
  createCheckoutSession(
    request: CreateCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResult>;
  retrieveCheckoutSession(
    stripeAccountId: string,
    stripeSessionId: string,
  ): Promise<CheckoutSessionLookupResult>;
  /**
   * Refund a completed checkout on the shop's connected account. `amountCents`
   * refunds that much (a partial refund); omitted refunds the full charge.
   * `not_refundable` means the session never captured a payment intent — there
   * is nothing to reverse, so staff owe the diver nothing through Stripe.
   */
  refundCheckoutSession(
    stripeAccountId: string,
    stripeSessionId: string,
    amountCents?: number,
  ): Promise<RefundCheckoutResult>;
}

type Fetch = typeof fetch;
type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

const configSchema = z.object({ secretKey: z.string().trim().min(1) });

const sessionResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  payment_status: z.string(),
  url: z.string().url().nullable().optional(),
  amount_total: z.number().int().nullable(),
  expires_at: z.number().int().optional(),
  payment_intent: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullable()
    .optional(),
});

const refundResponseSchema = z.object({ id: z.string().min(1) });

function paymentIntentIdOf(body: z.infer<typeof sessionResponseSchema>): string | null {
  const paymentIntent = body.payment_intent;
  if (!paymentIntent) return null;
  return typeof paymentIntent === "string" ? paymentIntent : paymentIntent.id;
}

function toSnapshot(body: z.infer<typeof sessionResponseSchema>): CheckoutSessionSnapshot {
  return {
    stripeSessionId: body.id,
    stripeStatus: body.status,
    paymentStatus: body.payment_status,
    checkoutUrl: body.url ?? null,
    amountTotalCents: body.amount_total ?? 0,
    expiresAt: body.expires_at ? new Date(body.expires_at * 1000) : null,
  };
}

function headersFor(secretKey: string, stripeAccountId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Account": stripeAccountId,
  };
}

export function stripeCheckoutProvider(
  config: { secretKey: string },
  fetchImpl: Fetch,
): CheckoutProvider {
  return {
    async createCheckoutSession(request) {
      try {
        const form = new URLSearchParams({
          mode: "payment",
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          customer_email: request.customerEmail,
          "line_items[0][price_data][currency]": request.currency,
          "line_items[0][price_data][product_data][name]": request.description,
          "line_items[0][price_data][unit_amount]": String(request.unitAmountCents),
          "line_items[0][quantity]": String(request.quantity),
        });
        const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            ...headersFor(config.secretKey, request.stripeAccountId),
            "Idempotency-Key": request.idempotencyKey,
          },
          body: form.toString(),
        });
        if (!response.ok) return { status: "failed" };
        const body = sessionResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return { status: "created", ...toSnapshot(body.data) };
      } catch {
        return { status: "failed" };
      }
    },

    async retrieveCheckoutSession(stripeAccountId, stripeSessionId) {
      try {
        const response = await fetchImpl(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(stripeSessionId)}`,
          { headers: headersFor(config.secretKey, stripeAccountId) },
        );
        if (!response.ok) return { status: "failed" };
        const body = sessionResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return { status: "ok", session: toSnapshot(body.data) };
      } catch {
        return { status: "failed" };
      }
    },

    async refundCheckoutSession(stripeAccountId, stripeSessionId, amountCents) {
      try {
        // The session id alone can't be refunded — the money lives on its
        // payment intent, so expand it, then reverse that. Same shape as
        // invoicing.ts refundInvoice.
        const sessionResponse = await fetchImpl(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
            stripeSessionId,
          )}?expand[]=payment_intent`,
          { headers: headersFor(config.secretKey, stripeAccountId) },
        );
        if (!sessionResponse.ok) return { status: "failed" };
        const body = sessionResponseSchema.safeParse(await sessionResponse.json());
        if (!body.success) return { status: "failed" };
        const paymentIntentId = paymentIntentIdOf(body.data);
        if (!paymentIntentId) return { status: "not_refundable" };

        const form = new URLSearchParams({ payment_intent: paymentIntentId });
        if (amountCents !== undefined) form.set("amount", String(amountCents));
        // Deterministic key so a retry after a lost response — or a later manual
        // re-issue through this same path — collapses to one Stripe refund
        // rather than paying the diver twice.
        const response = await fetchImpl("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            ...headersFor(config.secretKey, stripeAccountId),
            "Idempotency-Key": `refund:${paymentIntentId}:${amountCents ?? "full"}`,
          },
          body: form.toString(),
        });
        if (!response.ok) return { status: "failed" };
        const refund = refundResponseSchema.safeParse(await response.json());
        return refund.success
          ? { status: "refunded", refundId: refund.data.id }
          : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

const disabledCheckoutProvider: CheckoutProvider = {
  async createCheckoutSession() {
    return { status: "not_configured" };
  },
  async retrieveCheckoutSession() {
    return { status: "not_configured" };
  },
  async refundCheckoutSession() {
    return { status: "not_configured" };
  },
};

export function checkoutProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): CheckoutProvider {
  const config = configSchema.safeParse({ secretKey: env.STRIPE_SECRET_KEY });
  return config.success ? stripeCheckoutProvider(config.data, fetchImpl) : disabledCheckoutProvider;
}
