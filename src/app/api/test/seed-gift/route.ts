import { NextResponse } from "next/server";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { createGiftBooking } from "@/db/bookings";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { giftForBooking } from "@/db/gifts";
import { getShopBySlug } from "@/db/shops";
import { upcomingTripsWithCounts } from "@/db/trips";
import { claimLinkPath } from "@/lib/booking-capabilities";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { signGiftToken, verifyGiftToken } from "@/lib/gift-links";
import { giftLinkPath } from "@/lib/public-routes";

/**
 * The line the seeded giver wrote. Fixture text rather than product copy — the
 * visual baselines and `gift.spec.ts` both read it back, so it is pinned here
 * rather than translated: it stands in for words a real giver typed, which no
 * bundle has or should have.
 */
// i18n-exempt: fixture text standing in for a giver's own words (see above).
const GIFT_LINE = "From Hannah, for your birthday";

/**
 * **A seat given as a gift, and the two links it produces** (ADR
 * 20260908-one-hand, decision 6, lever W).
 *
 * A test route rather than a line in the seed, for the reason AGENTS.md gives
 * for the trouble states: a demo shop where a third of every boat is somebody's
 * birthday present is a worse demo, and the visual baselines need exactly one
 * gift on one departure. It books through `createGiftBooking`, so the seat this
 * photographs is one the product itself could have sold — capacity, the trip
 * window and the person dedup all decided by the same transaction.
 *
 * **With a `giftToken` it mints nothing new and books nothing**: it verifies
 * that token and hands back a claim link for the seat it names. That is the one
 * thing a spec cannot do for itself — in the product the receiver's link
 * arrives in the giver's inbox and the giver forwards it, and the giver's own
 * page deliberately does not re-mint it (see `src/app/gift/[token]/page.tsx`).
 * The same shape `seed-booking-handoff` uses for the same reason.
 *
 * Mutating the shared fixture is safe: each Playwright worker owns its database
 * and `/api/test/reset` restores the schedule before every test.
 *
 * Gated identically to /api/test/reset, so it can never be reachable in a real
 * deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_demo" }, { status: 404 });

  // A gift that already exists, named by its giver token: hand back the link
  // the giver would have forwarded, and touch nothing else.
  const body = (await request.json().catch(() => null)) as { giftToken?: unknown } | null;
  if (typeof body?.giftToken === "string") {
    const bookingId = verifyGiftToken(body.giftToken);
    if (!bookingId) return NextResponse.json({ error: "bad_token" }, { status: 400 });
    const gift = await giftForBooking(db, shop.id, bookingId);
    if (!gift) return NextResponse.json({ error: "not_a_gift" }, { status: 404 });
    const existing = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "claim",
    });
    if (!existing) return NextResponse.json({ error: "no_claim" }, { status: 409 });
    return NextResponse.json({ ok: true, claimPath: claimLinkPath(existing.token) });
  }

  // The soonest departure that still has a seat — the same thing a giver
  // browsing the storefront would land on.
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => candidate.booked < candidate.capacity,
  );
  if (!trip) return NextResponse.json({ error: "no_open_trip" }, { status: 409 });

  const outcome = await createGiftBooking(
    db,
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Ben Carter" },
    {
      giverName: "Hannah Liu",
      giverEmail: "hannah.liu@example.com",
      receiverName: "Ben Carter",
      message: GIFT_LINE,
    },
  );
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 409 });

  const claim = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: outcome.bookingId,
    purpose: "claim",
  });
  if (!claim) return NextResponse.json({ error: "no_claim" }, { status: 409 });

  return NextResponse.json({
    ok: true,
    tripId: trip.id,
    claimPath: claimLinkPath(claim.token),
    giftPath: giftLinkPath(signGiftToken(outcome.bookingId)),
  });
}
