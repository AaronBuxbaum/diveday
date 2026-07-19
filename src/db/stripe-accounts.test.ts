// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { getShopBySlug } from "./queries";
import { seedDemo } from "./seed";
import {
  canAcceptPayments,
  disconnectShopStripeAccount,
  getShopStripeAccount,
  getShopStripeAccountByAccountId,
  refreshShopStripeAccountStatus,
  setShopStripeAccountStatus,
  upsertShopStripeAccount,
} from "./stripe-accounts";

async function shopContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  return { db, shop };
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
      account: { chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true },
    });
    expect(refreshed).toMatchObject({ chargesEnabled: true, payoutsEnabled: false });

    const afterFailedLookup = await refreshShopStripeAccountStatus(db, "acct_123", {
      status: "failed",
    });
    expect(afterFailedLookup).toMatchObject({ chargesEnabled: true, payoutsEnabled: false });
  });
});
