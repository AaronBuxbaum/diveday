import { z } from "zod";

/**
 * Hosted Stripe Checkout for pay-at-booking on a shop's connected account.
 * Every call carries a `Stripe-Account` header so the shop, not the platform,
 * is the merchant of record — fetch-based, no SDK, same pattern as
 * ./invoicing.ts (docs ADR 20260721-checkout-at-booking). Payment truth only
 * ever comes from Stripe's own responses/webhooks, never from a return URL.
 */

/**
 * Stripe's `product_data[name]` limit. A description over it fails the whole
 * session creation, which on this path means a diver can't pay at all — so the
 * caller's composed label (a message-bundle string plus a shop-authored trip or
 * course title) is clamped rather than gambled on.
 */
export const MAX_LINE_DESCRIPTION_LENGTH = 250;

/** A caller-composed line label, trimmed and clamped to what Stripe will accept. */
export function stripeLineDescription(value: string): string {
  return value.trim().slice(0, MAX_LINE_DESCRIPTION_LENGTH);
}

/** One priced line on the hosted page — the trip fee (quantity = party size) or one diver's gear. */
export type CheckoutLineItem = {
  description: string;
  unitAmountCents: number;
  quantity: number;
};

export type CreateCheckoutSessionRequest = {
  stripeAccountId: string;
  currency: string;
  /**
   * One or more priced lines: the trip-fee line always comes first (unit
   * amount = the per-diver charge, quantity = party size), followed by zero
   * or more single-quantity gear lines for divers who priced rental gear at
   * checkout (docs ADR 20260801-checkout-upsells-rental-gear). Never empty —
   * a checkout with nothing to charge simply doesn't run.
   */
  lineItems: CheckoutLineItem[];
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
  /**
   * A Stripe `PromotionCode` id (`promo_...`), already validated by the
   * caller against the specific trip it was issued for (docs ADR
   * 20260727-last-minute-fill-promos) — never a raw diver-typed code string.
   * Mutually exclusive with `allow_promotion_codes`, which this provider never
   * sets, precisely so a code can't be applied to an unrelated checkout.
   */
  promotionCode?: string;
  /** Opt-in Stripe Tax. When enabled, every line is tax-exclusive. */
  taxEnabled?: boolean;
};

export type CheckoutSessionSnapshot = {
  stripeSessionId: string;
  /** Stripe's session lifecycle: open (payable), complete, or expired. */
  stripeStatus: string;
  /** Stripe's payment state: paid, unpaid, or no_payment_required. */
  paymentStatus: string;
  checkoutUrl: string | null;
  /**
   * Stripe's own `amount_total` — what the session actually settled for, after
   * any discount it applied. Null when Stripe reports no total at all (an
   * unfinished session, an unusual payload): "no figure", never "zero money",
   * so a caller can fall back to the amounts it asked for instead of recording
   * a settlement that didn't happen.
   */
  amountTotalCents: number | null;
  /** Stripe's calculated tax total, or null before Stripe has enough evidence. */
  taxAmountCents: number | null;
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
   *
   * `idempotencyKey` — see CreateCheckoutSessionRequest; a retry of the *same*
   * refund attempt converges on one Stripe refund. It is the caller's, not
   * derived here from the payment intent: one payment intent covers a whole
   * party, so two party members each cancelling for the same amount are two
   * distinct refunds that a derived key would silently collapse into one,
   * paying only the first diver back (PAY-C1).
   */
  refundCheckoutSession(
    stripeAccountId: string,
    stripeSessionId: string,
    idempotencyKey: string,
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
  total_details: z
    .object({ amount_tax: z.number().int().nonnegative().nullable().optional() })
    .nullable()
    .optional(),
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
    amountTotalCents: body.amount_total ?? null,
    taxAmountCents: body.total_details?.amount_tax ?? null,
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
      if (request.lineItems.length === 0) return { status: "failed" };
      try {
        const form = new URLSearchParams({
          mode: "payment",
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          customer_email: request.customerEmail,
        });
        if (request.taxEnabled) form.set("automatic_tax[enabled]", "true");
        request.lineItems.forEach((line, index) => {
          form.set(`line_items[${index}][price_data][currency]`, request.currency);
          form.set(`line_items[${index}][price_data][product_data][name]`, line.description);
          form.set(`line_items[${index}][price_data][unit_amount]`, String(line.unitAmountCents));
          if (request.taxEnabled) {
            form.set(`line_items[${index}][price_data][tax_behavior]`, "exclusive");
          }
          form.set(`line_items[${index}][quantity]`, String(line.quantity));
        });
        if (request.promotionCode) {
          form.set("discounts[0][promotion_code]", request.promotionCode);
        }
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

    async refundCheckoutSession(stripeAccountId, stripeSessionId, idempotencyKey, amountCents) {
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
        // The caller's per-attempt key, passed through untouched: a retry of
        // one attempt converges on the refund Stripe already issued, while two
        // *different* refunds against the same payment intent (a party where
        // two divers each cancel for the same amount) stay two refunds. A key
        // derived here from the payment intent and amount could not tell those
        // apart — Stripe would replay the first refund and both local rows
        // would claim money that moved once (PAY-C1).
        const response = await fetchImpl("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            ...headersFor(config.secretKey, stripeAccountId),
            "Idempotency-Key": idempotencyKey,
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
