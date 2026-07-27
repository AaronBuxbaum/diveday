import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { getShopBySlug } from "@/db/shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";

/**
 * Marks the seeded demo shop as connected + charges-enabled, without ever
 * calling Stripe. `canAcceptPayments` (and everything gated on it — pay at
 * booking, tips) is a pure DB-level check on `shop_stripe_accounts`,
 * independent of whether `STRIPE_SECRET_KEY` is set; this route exists so an
 * e2e/Argos capture can reach the "pay" and "tip your crew" surfaces without
 * a real Stripe account, the same reason /api/test/seed-account-token exists
 * for token-gated pages. The actual checkout button still resolves through
 * `checkoutProviderFromEnvironment()`, which stays `disabledCheckoutProvider`
 * in this fleet (no `STRIPE_SECRET_KEY`) — this only unlocks the surface's
 * visibility for a screenshot, never a real charge.
 *
 * Gated identically to /api/test/reset, so it can never be reachable in a
 * real deployment.
 */
export async function POST() {
  const hasRealDatabase = Boolean(process.env.DATABASE_URL);
  const productionRuntime = process.env.NODE_ENV === "production";
  const e2eHarness = process.env.DIVEDAY_E2E === "1";
  if (hasRealDatabase || (productionRuntime && !e2eHarness)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  const account = await upsertShopStripeAccount(db, shop.id, "acct_e2e_test");
  await setShopStripeAccountStatus(db, account.stripeAccountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return NextResponse.json({ ok: true });
}
