import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { getShopBySlug } from "@/db/shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Marks a seeded demo shop as connected + charges-enabled, without ever
 * calling Stripe. `canAcceptPayments` (and everything gated on it — pay at
 * booking, tips) is a pure DB-level check on `shop_stripe_accounts`,
 * independent of whether `STRIPE_SECRET_KEY` is set; this route exists so an
 * e2e visual-regression capture can reach the "pay" and "tip your crew" surfaces without
 * a real Stripe account, the same reason /api/test/seed-account-token exists
 * for token-gated pages. The actual checkout button still resolves through
 * `checkoutProviderFromEnvironment()`, which stays `disabledCheckoutProvider`
 * in this fleet (no `STRIPE_SECRET_KEY`) — this only unlocks the surface's
 * visibility for a screenshot, never a real charge.
 *
 * **`?slug=` names which minted shop to connect**, defaulting to the shared
 * blue-mantis fixture. A spec that writes shop-wide settings takes a shop of
 * its own (`privateShop`, ADR 20260815-per-test-private-shops), and until this
 * accepted a slug none of those shops could reach a payments surface at all —
 * so the tax opt-in, whose whole consequence is on checkout and invoicing, had
 * no honest end-to-end path. The `isDemo` gate below is what keeps that safe:
 * a minted shop is an `isDemo` tenant exactly like blue-mantis, and a real
 * shop is refused whatever slug is passed. Held to the same slug shape
 * /api/test/seed-private-shop enforces, refused rather than sanitised.
 *
 * Gated identically to /api/test/reset, so it can never be reachable in a
 * real deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const requested = new URL(request.url).searchParams.get("slug");
  if (requested !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requested)) {
    return NextResponse.json({ error: "bad_slug" }, { status: 400 });
  }
  const slug = requested ?? DEMO_SHOP_SLUG;
  const shop = await getShopBySlug(db, slug);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  // `shop_stripe_accounts_stripe_account_unique` makes a connected account id
  // globally unique, so a minted shop cannot be handed the demo fixture's —
  // the second one would raise 23505 rather than connect. blue-mantis keeps
  // the literal it has always had, which /api/test/seed-trouble-states also
  // writes for the same shop; everyone else derives one from their own id.
  const stripeAccountId = slug === DEMO_SHOP_SLUG ? "acct_e2e_test" : `acct_e2e_${shop.id}`;
  const account = await upsertShopStripeAccount(db, shop.id, stripeAccountId);
  await setShopStripeAccountStatus(db, account.stripeAccountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return NextResponse.json({ ok: true });
}
