import { describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { setShopCurrency } from "./shops";
import {
  canAcceptPayments,
  disconnectShopStripeAccount,
  getShopCurrency,
  getShopStripeAccount,
  getShopStripeAccountByAccountId,
  refreshShopStripeAccountStatus,
  setShopStripeAccountStatus,
  stripeCurrencyMismatch,
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
