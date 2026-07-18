import { z } from "zod";

/**
 * The payment seam: create a hosted checkout for a booking. Like the other
 * provider seams, the provider sits behind one entry point so the booking and
 * roster flows stay testable without live payment credentials
 * (ADR 20260718-payment-readiness). Confirming a completed payment (webhook)
 * is deferred; today staff mark payment state, and this creates a pay link.
 */
export type CheckoutSession =
  | { status: "created"; url: string }
  | { status: "not_configured" }
  | { status: "failed" };

export type CheckoutRequest = {
  amountCents: number;
  currency: string;
  description: string;
  bookingId: string;
  successUrl: string;
  cancelUrl: string;
};

export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
}

type Fetch = typeof fetch;
type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

const configSchema = z.object({ secretKey: z.string().trim().min(1) });
const stripeResponseSchema = z.object({ url: z.string().url() });

/** Stripe Checkout via its form-encoded API — no SDK dependency. */
export function stripePaymentProvider(
  config: { secretKey: string },
  fetchImpl: Fetch,
): PaymentProvider {
  return {
    async createCheckout(request) {
      const form = new URLSearchParams({
        mode: "payment",
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        client_reference_id: request.bookingId,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": request.currency,
        "line_items[0][price_data][unit_amount]": String(request.amountCents),
        "line_items[0][price_data][product_data][name]": request.description,
      });
      try {
        const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
        if (!response.ok) return { status: "failed" };
        const body = stripeResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed" };
        return { status: "created", url: body.data.url };
      } catch {
        return { status: "failed" };
      }
    },
  };
}

const disabledPaymentProvider: PaymentProvider = {
  async createCheckout() {
    return { status: "not_configured" };
  },
};

export function paymentProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): PaymentProvider {
  const config = configSchema.safeParse({ secretKey: env.STRIPE_SECRET_KEY });
  return config.success ? stripePaymentProvider(config.data, fetchImpl) : disabledPaymentProvider;
}

export function createCheckout(
  request: CheckoutRequest,
  provider: PaymentProvider = paymentProviderFromEnvironment(),
): Promise<CheckoutSession> {
  return provider.createCheckout(request);
}
