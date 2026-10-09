import { describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { setShopCurrency } from "./shops";
import {
  canAcceptPayments,
  checkoutMode,
  disconnectShopStripeAccount,
  getShopCurrency,
  getShopStripeAccount,
  getShopStripeAccountByAccountId,
  refreshShopStripeAccountStatus,
  setShopStripeAccountStatus,
  stripeAccountHolder,
  stripeCurrencyMismatch,
  stripeKeySourceFromEnvironment,
  syncDemoStripeAccount,
  upsertShopStripeAccount,
} from "./stripe-accounts";

async function shopContext() {
  return seededShopContext();
}

describe("shop stripe accounts", () => {
  it("is absent, then not payment-ready until charges are enabled", async () => {
    const { db, shop } = await shopContext();
    expect(await getShopStripeAccount(db, shop.id)).toBeNull();
    expect(canAcceptPayments(null)).toBe(false);

    const account = await upsertShopStripeAccount(db, shop.id, "acct_123");
    expect(account.stripeAccountId).toBe("acct_123");
    expect(canAcceptPayments(account)).toBe(false);

    const updated = await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    expect(canAcceptPayments(updated)).toBe(true);
    expect(await getShopStripeAccountByAccountId(db, "acct_123")).toMatchObject({
      shopId: shop.id,
      chargesEnabled: true,
    });
  });

  // PAY-M1: the Stripe webhook route now releases its event claim when a
  // handler throws, so a redelivery of `account.application.deauthorized`
  // genuinely re-reaches this function. A second run must be a true no-op —
  // an unconditional `disconnectedAt: now()` would walk the timestamp forward
  // on every retry and re-disconnect a shop that has since reconnected.
  it("is idempotent: a re-run never moves the recorded disconnect time", async () => {
    const { db, shop } = await shopContext();
    await upsertShopStripeAccount(db, shop.id, "acct_dedup");
    await setShopStripeAccountStatus(db, "acct_dedup", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const first = await disconnectShopStripeAccount(db, "acct_dedup");
    expect(first?.disconnectedAt).not.toBeNull();

    // The unit-test clock is frozen (src/test/frozen-clock.ts), so a re-run at
    // the same instant would pass whatever this function does. Advance it a day
    // to make a moved timestamp actually visible.
    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-22T13:30:00.000Z");
    const again = await disconnectShopStripeAccount(db, "acct_dedup");
    vi.unstubAllEnvs();
    // Still returns the row, so callers can't tell a first disconnect from a
    // repeat — but the evidence of *when* the shop was cut off is untouched.
    expect(again?.disconnectedAt?.getTime()).toBe(first?.disconnectedAt?.getTime());
    expect(canAcceptPayments(again)).toBe(false);
  });

  it("reports no row for an account it has never seen", async () => {
    const { db } = await shopContext();
    expect(await disconnectShopStripeAccount(db, "acct_unknown")).toBeNull();
  });

  // The `disconnected_at is null` guard above does NOT protect a reconnect —
  // `upsertShopStripeAccount` sets that column back to null, which is exactly
  // the state the guard permits. Stripe retries a deauthorization for ~3 days
  // and the webhook route gives its claim back on a failed handle, so a stale
  // redelivery landing after the owner has reconnected the same account would
  // cut a live shop off from payments. Ordering against the event's own Stripe
  // `created` time is what actually closes it.
  it("refuses a deauthorization older than the connection it names", async () => {
    const { db, shop } = await shopContext();
    const deauthorizedAt = new Date("2026-07-20T09:00:00.000Z");

    // The owner reconnects *after* the deauthorization Stripe is still retrying.
    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-20T10:00:00.000Z");
    await upsertShopStripeAccount(db, shop.id, "acct_reconnected");
    await setShopStripeAccountStatus(db, "acct_reconnected", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const after = await disconnectShopStripeAccount(db, "acct_reconnected", { deauthorizedAt });
    vi.unstubAllEnvs();

    // Untouched: still connected, still able to take payments.
    expect(after?.disconnectedAt).toBeNull();
    expect(canAcceptPayments(after)).toBe(true);
  });

  it("still applies a deauthorization newer than the connection it names", async () => {
    const { db, shop } = await shopContext();
    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-20T09:00:00.000Z");
    await upsertShopStripeAccount(db, shop.id, "acct_live");
    await setShopStripeAccountStatus(db, "acct_live", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    vi.unstubAllEnvs();

    const disconnected = await disconnectShopStripeAccount(db, "acct_live", {
      deauthorizedAt: new Date("2026-07-20T10:00:00.000Z"),
    });
    expect(disconnected?.disconnectedAt).not.toBeNull();
    expect(canAcceptPayments(disconnected)).toBe(false);
  });

  it("reconnecting replaces the stored account id and clears disconnected state", async () => {
    const { db, shop } = await shopContext();
    await upsertShopStripeAccount(db, shop.id, "acct_old");
    await setShopStripeAccountStatus(db, "acct_old", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const disconnected = await disconnectShopStripeAccount(db, "acct_old");
    expect(disconnected?.disconnectedAt).not.toBeNull();
    expect(canAcceptPayments(disconnected)).toBe(false);

    const reconnected = await upsertShopStripeAccount(db, shop.id, "acct_new");
    expect(reconnected.stripeAccountId).toBe("acct_new");
    expect(reconnected.disconnectedAt).toBeNull();
    expect(reconnected.chargesEnabled).toBe(false);
  });

  it("refreshes status from a live lookup and leaves the row untouched on failure", async () => {
    const { db, shop } = await shopContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");

    const refreshed = await refreshShopStripeAccountStatus(db, "acct_123", {
      status: "ok",
      account: {
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
        defaultCurrency: "eur",
      },
    });
    expect(refreshed).toMatchObject({ chargesEnabled: true, payoutsEnabled: false });
    expect(refreshed?.defaultCurrency).toBe("eur"); // task 60 — flows through, not hardcoded

    const afterFailedLookup = await refreshShopStripeAccountStatus(db, "acct_123", {
      status: "failed",
    });
    expect(afterFailedLookup).toMatchObject({ chargesEnabled: true, payoutsEnabled: false });
  });
});

describe("getShopCurrency", () => {
  it("reads the shop's own setting and narrows anything unsupported", async () => {
    const { db, shop } = await shopContext();
    expect(await getShopCurrency(db, shop.id)).toBe("usd"); // the column default

    await setShopCurrency(db, shop.id, "jpy");
    expect(await getShopCurrency(db, shop.id)).toBe("jpy");

    // A shop that isn't there reads as the default rather than throwing —
    // every caller has already resolved the tenant by this point.
    expect(await getShopCurrency(db, "00000000-0000-0000-0000-000000000000")).toBe("usd");
  });
});

describe("stripeCurrencyMismatch", () => {
  it("reports both codes when the shop setting and Stripe's account disagree", async () => {
    const { db, shop } = await shopContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      defaultCurrency: "usd",
    });
    const account = await getShopStripeAccount(db, shop.id);

    // Agreement is silence.
    expect(stripeCurrencyMismatch("usd", account)).toBeNull();
    // Case and spacing are Stripe's problem, not the shop's.
    expect(stripeCurrencyMismatch("USD", account)).toBeNull();
    // Disagreement returns codes, never a sentence — the settings page picks
    // the words (docs ADR 20260731-domain-layer-copy-leaks).
    expect(stripeCurrencyMismatch("eur", account)).toEqual({
      shopCurrency: "eur",
      accountCurrency: "usd",
    });
  });

  it("stays quiet with no connected account, after a disconnect, or with no reported currency", async () => {
    const { db, shop } = await shopContext();
    expect(stripeCurrencyMismatch("eur", null)).toBeNull();

    await upsertShopStripeAccount(db, shop.id, "acct_123");
    const fresh = await getShopStripeAccount(db, shop.id);
    if (!fresh) throw new Error("account row missing");
    // Stripe has not reported a currency for a brand-new account yet.
    expect(stripeCurrencyMismatch("eur", { ...fresh, defaultCurrency: "" })).toBeNull();

    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      defaultCurrency: "usd",
    });
    await disconnectShopStripeAccount(db, "acct_123");
    expect(stripeCurrencyMismatch("eur", await getShopStripeAccount(db, shop.id))).toBeNull();
  });
});

/**
 * The canonical demo takes a card at booking in Stripe test mode when the
 * deployment names its test-mode account (ADR 20261009-demo-test-mode-payments).
 * The connection is configuration: it lands only on the canonical demo, goes
 * when the configuration does, and never takes an account from another shop.
 */
describe("syncDemoStripeAccount", () => {
  const config = { accountId: "acct_demoTestMode1", secretKey: "sk_test_demoKey12345" };

  it("connects the canonical demo with charges on, so its public pages take payment", async () => {
    const { db, shop } = await shopContext();
    expect(await syncDemoStripeAccount(db, shop.id, config)).toBe("connected");
    const account = await getShopStripeAccount(db, shop.id);
    expect(account?.stripeAccountId).toBe(config.accountId);
    expect(canAcceptPayments(account)).toBe(true);
    // Idempotent.
    expect(await syncDemoStripeAccount(db, shop.id, config)).toBe("connected");
  });

  it("takes the connection away when the deployment no longer names one", async () => {
    const { db, shop } = await shopContext();
    await syncDemoStripeAccount(db, shop.id, config);
    expect(await syncDemoStripeAccount(db, shop.id, null)).toBe("cleared");
    expect(await getShopStripeAccount(db, shop.id)).toBeNull();
  });

  it("never touches a shop that is not the canonical demo", async () => {
    const { db, shop } = await shopContext();
    const { shops } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    // The same shop, no longer a demo: a real tenant.
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    await upsertShopStripeAccount(db, shop.id, "acct_realShop123");
    expect(await syncDemoStripeAccount(db, shop.id, config)).toBe("skipped");
    expect(await syncDemoStripeAccount(db, shop.id, null)).toBe("skipped");
    expect((await getShopStripeAccount(db, shop.id))?.stripeAccountId).toBe("acct_realShop123");
  });

  it("never takes the account from a shop that already holds it", async () => {
    const { db, shop } = await shopContext();
    const { shops } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    const [other] = await db
      .insert(shops)
      .values({ name: "Other", slug: "other-shop-holding-acct", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("insert failed");
    await upsertShopStripeAccount(db, other.id, config.accountId);
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const errored = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await syncDemoStripeAccount(db, shop.id, config)).toBe("skipped");
    logged.mockRestore();
    errored.mockRestore();
    expect(await getShopStripeAccount(db, shop.id)).toBeNull();
    expect((await getShopStripeAccount(db, other.id))?.stripeAccountId).toBe(config.accountId);
    expect(await db.select().from(shops).where(eq(shops.id, other.id))).toHaveLength(1);
  });
});

describe("checkoutMode", () => {
  it("is test mode only for the configured demo account, and plain Stripe for every other", async () => {
    const { db, shop } = await shopContext();
    await upsertShopStripeAccount(db, shop.id, "acct_demoTestMode1");
    const account = await getShopStripeAccount(db, shop.id);
    vi.stubEnv("STRIPE_DEMO_ACCOUNT_ID", "acct_demoTestMode1");
    vi.stubEnv("STRIPE_DEMO_SECRET_KEY", "sk_test_demoKey12345");
    expect(checkoutMode(account)).toBe("test-mode");
    // Half a pair, or a live key in the demo's slot, is no test mode at all.
    vi.stubEnv("STRIPE_DEMO_SECRET_KEY", "sk_live_notATestKey123");
    expect(checkoutMode(account)).toBe(true);
    vi.stubEnv("STRIPE_DEMO_SECRET_KEY", "sk_test_demoKey12345");
    vi.stubEnv("STRIPE_DEMO_ACCOUNT_ID", "acct_someoneElse1");
    expect(checkoutMode(account)).toBe(true);
    expect(checkoutMode(null)).toBe(true);
    vi.unstubAllEnvs();
  });
});

/**
 * **A demo shop never reaches the live key** (security review of ADR
 * 20261009-demo-test-mode-payments): who holds an account decides its key, and
 * a demo shop whose account could only be called with the live key offers no
 * payment at all.
 */
describe("the demo and the live platform key", () => {
  const LIVE_PLATFORM = "sk_live_platformKey123";
  const DEMO_ACCOUNT = "acct_demoTestMode1";
  const DEMO_KEY = "sk_test_demoKey12345";

  function liveDeploymentWithDemo() {
    vi.stubEnv("STRIPE_SECRET_KEY", LIVE_PLATFORM);
    vi.stubEnv("STRIPE_DEMO_ACCOUNT_ID", DEMO_ACCOUNT);
    vi.stubEnv("STRIPE_DEMO_SECRET_KEY", DEMO_KEY);
  }

  async function connected(
    db: Awaited<ReturnType<typeof shopContext>>["db"],
    shopId: string,
    id: string,
  ) {
    await upsertShopStripeAccount(db, shopId, id);
    await setShopStripeAccountStatus(db, id, {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
  }

  it("offers no payment on a demo shop holding any account but the demo's", async () => {
    const { db, shop } = await shopContext();
    liveDeploymentWithDemo();
    await connected(db, shop.id, "acct_e2e_test");
    expect(await getShopStripeAccount(db, shop.id)).toBeNull();
    expect(await getShopStripeAccountByAccountId(db, "acct_e2e_test")).toBeNull();
    expect(
      await stripeKeySourceFromEnvironment({ db: async () => db })?.secretKeyFor("acct_e2e_test"),
    ).toBeNull();
    vi.unstubAllEnvs();
  });

  it("offers payment on the canonical demo with the demo's account, on the test key", async () => {
    const { db, shop } = await shopContext();
    liveDeploymentWithDemo();
    await connected(db, shop.id, DEMO_ACCOUNT);
    expect(canAcceptPayments(await getShopStripeAccount(db, shop.id))).toBe(true);
    expect(await stripeAccountHolder(db, DEMO_ACCOUNT)).toEqual({
      isDemo: true,
      isCanonicalDemo: true,
    });
    expect(
      await stripeKeySourceFromEnvironment({ db: async () => db })?.secretKeyFor(DEMO_ACCOUNT),
    ).toBe(DEMO_KEY);
    vi.unstubAllEnvs();
  });

  it("gives the demo's account no key when a real shop holds it", async () => {
    const { db, shop } = await shopContext();
    const { shops } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    liveDeploymentWithDemo();
    await connected(db, shop.id, DEMO_ACCOUNT);
    expect(await stripeAccountHolder(db, DEMO_ACCOUNT)).toEqual({
      isDemo: false,
      isCanonicalDemo: false,
    });
    expect(
      await stripeKeySourceFromEnvironment({ db: async () => db })?.secretKeyFor(DEMO_ACCOUNT),
    ).toBeNull();
    expect(
      await stripeKeySourceFromEnvironment({ db: async () => db })?.secretKeyFor(
        "acct_someRealShop1",
      ),
    ).toBe(LIVE_PLATFORM);
    vi.unstubAllEnvs();
  });
});
