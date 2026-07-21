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

export interface CheckoutProvider {
  createCheckoutSession(
    request: CreateCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResult>;
  retrieveCheckoutSession(
    stripeAccountId: string,
    stripeSessionId: string,
  ): Promise<CheckoutSessionLookupResult>;
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
});

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
          headers: headersFor(config.secretKey, request.stripeAccountId),
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
  };
}

const disabledCheckoutProvider: CheckoutProvider = {
  async createCheckoutSession() {
    return { status: "not_configured" };
  },
  async retrieveCheckoutSession() {
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
