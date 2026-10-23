import { createHash } from "node:crypto";
import { z } from "zod";
import { boundedStripeFetch } from "../payments/stripe-fetch";
import { isTodaysPrice, type PlanTerms } from "./pricing-plans";

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
  /**
   * Today's flat monthly price (`price_…`). Its product is also what every
   * other monthly fee is sold on (ADR 20261022-pricing-ab-test).
   */
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
  if (!parsed.success) return null;
  // The Connect key pasted into the billing slot would bill shops from the
  // platform account Connect acts through, and blur which key touches which
  // money. Treated as not configured rather than half-working.
  if (parsed.data.secretKey === env.STRIPE_SECRET_KEY?.trim()) return null;
  return parsed.data;
}

/**
 * The percent plan's Stripe side (ADR 20261022-pricing-ab-test): a metered
 * price on a Stripe Billing Meter at $0.01 a unit, and the meter's event
 * name. DiveDay computes each month's fee itself and reports it in cents as
 * that meter's value, so changing the rate never needs a Stripe change. Both
 * or neither: without them the percent plan's Billing page says billing for
 * the plan is not on, and offers no button.
 */
export type PercentBillingConfig = { priceId: string; meterEventName: string };

const percentBillingSchema = z.object({
  priceId: z
    .string()
    .trim()
    .regex(/^price_\S+$/),
  meterEventName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,100}$/),
});

export function percentBillingFromEnvironment(
  env: BillingEnvironment = process.env,
): PercentBillingConfig | null {
  const parsed = percentBillingSchema.safeParse({
    priceId: env.BILLING_STRIPE_PERCENT_PRICE_ID,
    meterEventName: env.BILLING_STRIPE_PERCENT_METER_EVENT,
  });
  return parsed.success ? parsed.data : null;
}

/** One Checkout line: a price Stripe already holds, or a monthly amount on the plan's product. */
export type CheckoutLine =
  | { kind: "price"; priceId: string; metered: boolean }
  | { kind: "monthly_amount"; unitAmountCents: number };

/**
 * What Checkout sells for a plan's numbers, or null when the plan cannot be
 * sold yet (the percent plan without its metered price configured).
 *
 * Today's flat price is the existing `BILLING_STRIPE_PRICE_ID`, unchanged. Any
 * other monthly fee is `price_data` on that price's product, recurring
 * monthly, so a new number in the environment needs no new Stripe price. The
 * percent plan adds its metered price; a base fee of zero sells the metered
 * line alone.
 */
export function checkoutLines(
  terms: PlanTerms,
  config: BillingConfig,
  percent: PercentBillingConfig | null,
): CheckoutLine[] | null {
  if (terms.plan === "flat_monthly") {
    return isTodaysPrice(terms)
      ? [{ kind: "price", priceId: config.priceId, metered: false }]
      : [{ kind: "monthly_amount", unitAmountCents: terms.monthlyCents }];
  }
  if (!percent) return null;
  const metered: CheckoutLine = { kind: "price", priceId: percent.priceId, metered: true };
  return terms.monthlyCents > 0
    ? [{ kind: "monthly_amount", unitAmountCents: terms.monthlyCents }, metered]
    : [metered];
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
  /** What to sell, from `checkoutLines`. */
  lines: readonly CheckoutLine[];
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  /** When the first charge should land; null charges at once. */
  firstChargeAt: Date | null;
  now: Date;
  /**
   * The session the shop's row held, which the caller just settled, or null.
   * Part of the idempotency key: each "Add a card" press after a settled
   * session is a new request, while a retry of the same press (a lost answer,
   * a second tab that read the same row) is the same one.
   */
  replaces: string | null;
};

export type BillingCallResult<T> = { status: "ok"; value: T } | { status: "failed" };

const idResponse = z.object({ id: z.string().min(1) });
/**
 * The actions redirect the owner's browser to this URL, so only an https one
 * is followed: Stripe's hosted pages are never plain http, and a
 * `javascript:` or `data:` value is never a page Stripe made. The host is
 * deliberately not pinned to `*.stripe.com`: Checkout and the Portal can be
 * served from a custom domain configured in Stripe (ADR
 * 20261007-subscription-billing), and the URL comes back over TLS from
 * Stripe's own API under DiveDay's key.
 */
const checkoutResponse = z.object({ id: z.string().min(1) });
const checkoutStatusResponse = z.object({ status: z.enum(["open", "complete", "expired"]) });
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
  /** A Checkout session: its id, kept on the shop's row, and the URL to send the owner to. */
  createCheckoutSession(
    input: CheckoutRequest,
  ): Promise<BillingCallResult<{ id: string; url: string }>>;
  /**
   * Make sure the Checkout session "Add a card" opened last can no longer
   * start a subscription: expire it if still open. `completed` means it
   * already did — a subscription is on its way by webhook, and a second
   * Checkout must not open.
   */
  settleCheckoutSession(sessionId: string): Promise<BillingCallResult<"cleared" | "completed">>;
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
  /**
   * One month's percent fee, reported to the meter (ADR
   * 20261022-pricing-ab-test). `identifier` makes it once-only at Stripe as
   * well as in DiveDay's statement row; `already_reported` is Stripe saying it
   * holds an event with that identifier.
   */
  reportMeterEvent(input: {
    eventName: string;
    customerId: string;
    valueCents: number;
    identifier: string;
    timestamp: Date;
  }): Promise<BillingCallResult<"reported" | "already_reported">>;
  /**
   * What the meter behind the metered `priceId` holds for one customer over a
   * window, in cents: how the monthly close learns whether a report whose
   * answer was lost reached Stripe, once Stripe's 24-hour identifier window
   * can no longer dedupe a re-send.
   */
  meterValueReported(input: {
    priceId: string;
    customerId: string;
    from: Date;
    to: Date;
  }): Promise<BillingCallResult<number>>;
  /**
   * A final month's percent fee, for a shop whose subscription ended before
   * its month closed: no subscription item is left to bill a meter event, so
   * it is an invoice item tagged with the statement's identifier, on an
   * invoice Stripe emails. Once-only by that tag: an item already invoiced is
   * `already_invoiced`, and a pending one is invoiced without a second item.
   */
  invoiceFinalMonth(input: {
    customerId: string;
    amountCents: number;
    identifier: string;
    /** `yyyy-mm`, for the line's description. */
    month: string;
  }): Promise<BillingCallResult<"invoiced" | "already_invoiced">>;
}

const priceProductResponse = z.object({
  product: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
});
const priceMeterResponse = z.object({ recurring: z.object({ meter: z.string().min(1) }) });
const meterSummariesResponse = z.object({
  data: z.array(z.object({ aggregated_value: z.number().finite() })),
});
const invoiceItemsResponse = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      invoice: z.union([z.string(), z.object({ id: z.string() })]).nullable(),
      metadata: z.record(z.string(), z.string()).nullable().optional(),
    }),
  ),
});
/** The statement tag on a final month's invoice item: its meter identifier. */
const FINAL_MONTH_TAG = "diveday_statement";
const stripeErrorResponse = z.object({
  error: z.object({ code: z.string().optional() }).optional(),
});

/** Each configured price's product, read once per process: it never changes under a price id. */
const productOfPrice = new Map<string, string>();

export function stripeBillingProvider(
  config: BillingConfig,
  unboundedFetch: Fetch,
): BillingProvider {
  const fetchImpl = boundedStripeFetch(unboundedFetch);
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<unknown | null> {
    try {
      const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(body ? { body: body.toString() } : {}),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
  const post = (path: string, body: URLSearchParams, idempotencyKey?: string) =>
    call("POST", path, body, idempotencyKey);

  /** The product behind the configured flat price: what a `price_data` line sells. */
  async function productOf(priceId: string): Promise<string | null> {
    const known = productOfPrice.get(priceId);
    if (known) return known;
    const parsed = priceProductResponse.safeParse(
      await call("GET", `prices/${encodeURIComponent(priceId)}`),
    );
    if (!parsed.success) return null;
    const product =
      typeof parsed.data.product === "string" ? parsed.data.product : parsed.data.product.id;
    productOfPrice.set(priceId, product);
    return product;
  }

  return {
    async createCustomer({ shopId, shopName, email }) {
      const body = new URLSearchParams({ name: shopName, "metadata[shop_id]": shopId });
      if (email) body.set("email", email);
      // Keyed by the shop *and* what is sent: a double tap is one Customer,
      // while a renamed shop or a changed owner email within Stripe's 24-hour
      // key window is a new request rather than a 400 for a reused key.
      const parameters = createHash("sha256").update(body.toString()).digest("hex").slice(0, 16);
      const parsed = idResponse.safeParse(
        await post("customers", body, `diveday-billing-customer-${shopId}-${parameters}`),
      );
      return parsed.success ? { status: "ok", value: parsed.data.id } : { status: "failed" };
    },

    async createCheckoutSession({
      shopId,
      lines,
      customerId,
      successUrl,
      cancelUrl,
      firstChargeAt,
      now,
      replaces,
    }) {
      const body = new URLSearchParams({
        mode: "subscription",
        customer: customerId,
        client_reference_id: shopId,
        "subscription_data[metadata][shop_id]": shopId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (lines.length === 0) return { status: "failed" };
      for (const [index, line] of lines.entries()) {
        const at = `line_items[${index}]`;
        if (line.kind === "price") {
          body.set(`${at}[price]`, line.priceId);
          // A metered price takes no quantity: Stripe counts it from the meter.
          if (!line.metered) body.set(`${at}[quantity]`, "1");
          continue;
        }
        const product = await productOf(config.priceId);
        if (!product) return { status: "failed" };
        body.set(`${at}[price_data][currency]`, "usd");
        body.set(`${at}[price_data][product]`, product);
        body.set(`${at}[price_data][unit_amount]`, String(line.unitAmountCents));
        body.set(`${at}[price_data][recurring][interval]`, "month");
        body.set(`${at}[quantity]`, "1");
      }
      const trialEnd = checkoutTrialEnd(firstChargeAt, now);
      if (trialEnd !== null) body.set("subscription_data[trial_end]", String(trialEnd));
      // Keyed by the shop, what is sent (its customer and trial end among it)
      // and the session it replaces. A request that timed out and is pressed
      // again gets Stripe's first session back rather than a second open one;
      // two tabs racing get one session, which `recordShopCheckoutSession`
      // accepts from both. The replaced id is what keeps a fresh press after
      // a settled session from replaying the session that press just expired.
      const parameters = createHash("sha256")
        .update(`${replaces ?? "none"}\n${body.toString()}`)
        .digest("hex")
        .slice(0, 16);
      const answer = await post(
        "checkout/sessions",
        body,
        `diveday-billing-checkout-${shopId}-${parameters}`,
      );
      const id = checkoutResponse.safeParse(answer);
      const url = urlResponse.safeParse(answer);
      return id.success && url.success
        ? { status: "ok", value: { id: id.data.id, url: url.data.url } }
        : { status: "failed" };
    },

    async settleCheckoutSession(sessionId) {
      const path = `checkout/sessions/${encodeURIComponent(sessionId)}`;
      const current = checkoutStatusResponse.safeParse(await call("GET", path));
      if (!current.success) return { status: "failed" };
      if (current.data.status === "complete") return { status: "ok", value: "completed" };
      if (current.data.status === "expired") return { status: "ok", value: "cleared" };
      const expired = checkoutStatusResponse.safeParse(
        await post(`${path}/expire`, new URLSearchParams()),
      );
      if (expired.success && expired.data.status === "expired") {
        return { status: "ok", value: "cleared" };
      }
      // The expire lost a race with the owner finishing payment in the other tab.
      const settled = checkoutStatusResponse.safeParse(await call("GET", path));
      return settled.success && settled.data.status === "complete"
        ? { status: "ok", value: "completed" }
        : { status: "failed" };
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

    async reportMeterEvent({ eventName, customerId, valueCents, identifier, timestamp }) {
      if (!Number.isSafeInteger(valueCents) || valueCents < 0) return { status: "failed" };
      const body = new URLSearchParams({
        event_name: eventName,
        "payload[stripe_customer_id]": customerId,
        "payload[value]": String(valueCents),
        identifier,
        timestamp: String(Math.floor(timestamp.getTime() / 1000)),
      });
      try {
        const response = await fetchImpl("https://api.stripe.com/v1/billing/meter_events", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": identifier,
          },
          body: body.toString(),
        });
        if (response.ok) return { status: "ok", value: "reported" };
        const answer = stripeErrorResponse.safeParse(await response.json().catch(() => null));
        // Stripe already holds an event with this identifier: an earlier run
        // reported it and lost the answer before stamping the statement.
        // `duplicate_meter_event` is the one duplicate code Stripe documents
        // (its v2 meter-events API). This v1 endpoint validates
        // asynchronously and documents none, so the close does not rely on
        // it: past the identifier's 24 hours it asks the meter first
        // (`meterValueReported`).
        return answer.success && answer.data.error?.code === "duplicate_meter_event"
          ? { status: "ok", value: "already_reported" }
          : { status: "failed" };
      } catch {
        return { status: "failed" };
      }
    },

    async meterValueReported({ priceId, customerId, from, to }) {
      const price = priceMeterResponse.safeParse(
        await call("GET", `prices/${encodeURIComponent(priceId)}`),
      );
      if (!price.success) return { status: "failed" };
      const query = new URLSearchParams({
        customer: customerId,
        start_time: String(Math.floor(from.getTime() / 1000)),
        end_time: String(Math.floor(to.getTime() / 1000)),
      });
      const summaries = meterSummariesResponse.safeParse(
        await call(
          "GET",
          `billing/meters/${encodeURIComponent(price.data.recurring.meter)}/event_summaries?${query}`,
        ),
      );
      if (!summaries.success) return { status: "failed" };
      const total = summaries.data.data.reduce((sum, row) => sum + row.aggregated_value, 0);
      return { status: "ok", value: total };
    },

    async invoiceFinalMonth({ customerId, amountCents, identifier, month }) {
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { status: "failed" };
      const listed = invoiceItemsResponse.safeParse(
        await call(
          "GET",
          `invoiceitems?${new URLSearchParams({ customer: customerId, limit: "100" })}`,
        ),
      );
      if (!listed.success) return { status: "failed" };
      const tagged = listed.data.data.find(
        (item) => item.metadata?.[FINAL_MONTH_TAG] === identifier,
      );
      if (tagged?.invoice) return { status: "ok", value: "already_invoiced" };
      if (!tagged) {
        const item = idResponse.safeParse(
          await post(
            "invoiceitems",
            new URLSearchParams({
              customer: customerId,
              amount: String(amountCents),
              currency: "usd",
              description: `DiveDay fee, ${month}`,
              [`metadata[${FINAL_MONTH_TAG}]`]: identifier,
            }),
            `${identifier}-item`,
          ),
        );
        if (!item.success) return { status: "failed" };
      }
      const invoice = idResponse.safeParse(
        await post(
          "invoices",
          new URLSearchParams({
            customer: customerId,
            collection_method: "send_invoice",
            days_until_due: "14",
            pending_invoice_items_behavior: "include",
            auto_advance: "true",
            [`metadata[${FINAL_MONTH_TAG}]`]: identifier,
          }),
          `${identifier}-invoice`,
        ),
      );
      return invoice.success ? { status: "ok", value: "invoiced" } : { status: "failed" };
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
