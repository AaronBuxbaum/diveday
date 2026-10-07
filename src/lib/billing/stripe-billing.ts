import { z } from "zod";

/**
 * DiveDay's own subscription on DiveDay's own Stripe account — the money a
 * *shop* pays *DiveDay* (ADR 20261007-subscription-billing).
 *
 * Deliberately a different seam from `src/lib/payments/`, which moves a
 * diver's money to a shop's own connected account. The two never share a key:
 * this one reads `BILLING_STRIPE_*`, Connect reads `STRIPE_*`, so a key
 * rotated, restricted or revoked on one side cannot reach the other, and a
 * reader can tell from the variable name which money a line of code touches.
 * Fetch-based like the Connect seam, no SDK.
 *
 * Every call answers a result code rather than throwing, so a page that asks
 * Stripe something on a bad network day says so beside the button instead of
 * rendering an error boundary.
 */

/**
 * The prefix a billing event's id carries in the shared Stripe delivery ledger.
 *
 * The ledger (`stripe_webhook_events`) is reused rather than duplicated — one
 * table, one retention window, one claim-and-release protocol — but the two
 * endpoints must never be able to swallow each other's deliveries. Should a
 * misconfigured Stripe account ever send the same event to both, the
 * unprefixed Connect claim and this prefixed one are different rows, and each
 * endpoint handles its own copy (ADR 20261007-subscription-billing).
 */
export const BILLING_LEDGER_PREFIX = "billing:";

type Fetch = typeof fetch;
type BillingEnvironment = Readonly<Record<string, string | undefined>>;

export type BillingConfig = {
  secretKey: string;
  webhookSecret: string;
  /** The one recurring price every shop subscribes to (`price_…`). */
  priceId: string;
};

const billingConfigSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .regex(/^(sk|rk)_(live|test)_\S+$/),
  webhookSecret: z
    .string()
    .trim()
    .regex(/^whsec_\S+$/),
  priceId: z
    .string()
    .trim()
    .regex(/^price_\S+$/),
});

/**
 * The three values together, or null — "billing is not turned on yet".
 *
 * All three or nothing: a key without the webhook secret would open Checkout
 * for a subscription whose state could never reach this database, and a key
 * without a price has nothing to sell. A malformed value counts as absent for
 * the same reason, and is the only place that can fail quietly, so the shape
 * is checked rather than merely the presence.
 */
export function billingConfigFromEnvironment(
  env: BillingEnvironment = process.env,
): BillingConfig | null {
  const parsed = billingConfigSchema.safeParse({
    secretKey: env.BILLING_STRIPE_SECRET_KEY,
    webhookSecret: env.BILLING_STRIPE_WEBHOOK_SECRET,
    priceId: env.BILLING_STRIPE_PRICE_ID,
  });
  return parsed.success ? parsed.data : null;
}

/** Which Stripe mode the configured key acts in — what a verified event's `livemode` must match. */
export function billingKeyIsLive(config: BillingConfig): boolean {
  return /^(sk|rk)_live_/.test(config.secretKey);
}

/**
 * The earliest first charge Stripe Checkout accepts on a deferred subscription:
 * `subscription_data.trial_end` must sit at least 48 hours out. A shop adding
 * its card with a day of free time left gets two days instead of a charge
 * today; the other choice — charging at once — takes money for days the shop
 * was told were free.
 */
export const CHECKOUT_MIN_TRIAL_MS = 48 * 60 * 60 * 1000 + 5 * 60 * 1000;

export type CheckoutRequest = {
  shopId: string;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  /** When the first charge should land; null charges at once. */
  firstChargeAt: Date | null;
  now: Date;
};

export type BillingCallResult<T> = { status: "ok"; value: T } | { status: "failed" };

const idResponse = z.object({ id: z.string().min(1) });
/**
 * The actions redirect the owner's browser to this URL, so only an https one
 * is followed: Stripe's hosted pages (or a shop-branded custom domain Stripe
 * serves) are never plain http, and a `javascript:` or `data:` value is never
 * a page Stripe made.
 */
const urlResponse = z.object({
  url: z
    .string()
    .url()
    .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:"),
});

/** The trial end Checkout should carry, in unix seconds, or null for none. */
export function checkoutTrialEnd(firstChargeAt: Date | null, now: Date): number | null {
  if (!firstChargeAt || firstChargeAt.getTime() <= now.getTime()) return null;
  const earliest = now.getTime() + CHECKOUT_MIN_TRIAL_MS;
  return Math.ceil(Math.max(firstChargeAt.getTime(), earliest) / 1000);
}

export interface BillingProvider {
  /**
   * One Stripe Customer per shop, minted before Checkout so every later event
   * names a customer id this database already holds — the webhook resolves a
   * shop by that id and nothing else. The idempotency key makes a double tap
   * of "Add a card" one Customer, not two.
   */
  createCustomer(input: {
    shopId: string;
    shopName: string;
    email: string | null;
  }): Promise<BillingCallResult<string>>;
  createCheckoutSession(input: CheckoutRequest): Promise<BillingCallResult<string>>;
  /**
   * A Customer Portal session. With `cancelSubscriptionId` the portal opens
   * straight on its cancel confirmation for that subscription — one tap to
   * cancel, as the price page promises.
   */
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
    cancelSubscriptionId?: string;
  }): Promise<BillingCallResult<string>>;
}

export function stripeBillingProvider(config: BillingConfig, fetchImpl: Fetch): BillingProvider {
  async function post(
    path: string,
    body: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<unknown | null> {
    try {
      const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body.toString(),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  return {
    async createCustomer({ shopId, shopName, email }) {
      const body = new URLSearchParams({ name: shopName, "metadata[shop_id]": shopId });
      if (email) body.set("email", email);
      const parsed = idResponse.safeParse(
        await post("customers", body, `diveday-billing-customer-${shopId}`),
      );
      return parsed.success ? { status: "ok", value: parsed.data.id } : { status: "failed" };
    },

    async createCheckoutSession({ shopId, customerId, successUrl, cancelUrl, firstChargeAt, now }) {
      const body = new URLSearchParams({
        mode: "subscription",
        customer: customerId,
        client_reference_id: shopId,
        "line_items[0][price]": config.priceId,
        "line_items[0][quantity]": "1",
        "subscription_data[metadata][shop_id]": shopId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      const trialEnd = checkoutTrialEnd(firstChargeAt, now);
      if (trialEnd !== null) body.set("subscription_data[trial_end]", String(trialEnd));
      const parsed = urlResponse.safeParse(await post("checkout/sessions", body));
      return parsed.success ? { status: "ok", value: parsed.data.url } : { status: "failed" };
    },

    async createPortalSession({ customerId, returnUrl, cancelSubscriptionId }) {
      const body = new URLSearchParams({ customer: customerId, return_url: returnUrl });
      if (cancelSubscriptionId) {
        body.set("flow_data[type]", "subscription_cancel");
        body.set("flow_data[subscription_cancel][subscription]", cancelSubscriptionId);
        body.set("flow_data[after_completion][type]", "redirect");
        body.set("flow_data[after_completion][redirect][return_url]", returnUrl);
      }
      const parsed = urlResponse.safeParse(await post("billing_portal/sessions", body));
      return parsed.success ? { status: "ok", value: parsed.data.url } : { status: "failed" };
    },
  };
}

/** The configured provider, or null when billing is not turned on. */
export function billingProviderFromEnvironment(
  env: BillingEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): BillingProvider | null {
  const config = billingConfigFromEnvironment(env);
  return config ? stripeBillingProvider(config, fetchImpl) : null;
}
