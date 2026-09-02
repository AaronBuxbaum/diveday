import { and, eq, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { upsertExecutedDive } from "@/db/executed-dives";
import { bookings, diveSites, tripDives } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Records the demo recap's first dive at a **different site than the plan
 * named**, so the "planned versus lived" comparison has something to render
 * (issue #1191).
 *
 * A test route rather than a line in the seed, for the reason AGENTS.md gives
 * for the trouble states: a demo shop whose every recap says the boat went
 * somewhere else is a worse demo, and the branch worth photographing is the
 * rare one. The calm variant is already photographed — `recap` captures the
 * same page with no `executed_dives` row at all, which is what the vast
 * majority of days look like.
 *
 * It writes through `upsertExecutedDive` rather than inserting directly, so the
 * row it leaves is one the product itself could have written: the dive number
 * is checked against `trips.planned_dives`, the recorder against the shop's own
 * people, and the site against the shop's own catalog. A route that bypassed
 * those could photograph a state no divemaster can reach.
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

  const [booking] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, DEMO_RECAP_BOOKING_ID))
    .limit(1);
  if (!booking) return NextResponse.json({ error: "no_booking" }, { status: 404 });

  const [planned] = await db
    .select({ diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(and(eq(tripDives.tripId, booking.tripId), eq(tripDives.diveNumber, 1)))
    .limit(1);

  // Any site of the shop's that is not the one dive one was planned to. The
  // comparison only fires on a *named* plan meeting a *named* record, so a trip
  // whose first leg was left blank cannot produce the variant.
  const [elsewhere] = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(
      and(
        eq(diveSites.shopId, shop.id),
        isNull(diveSites.deletedAt),
        planned?.diveSiteId ? ne(diveSites.id, planned.diveSiteId) : undefined,
      ),
    )
    .orderBy(diveSites.name)
    .limit(1);
  if (!planned?.diveSiteId || !elsewhere) {
    return NextResponse.json({ error: "no_other_site" }, { status: 409 });
  }

  const [staff] = await listStaff(db, shop.id);
  if (!staff) return NextResponse.json({ error: "no_staff" }, { status: 404 });

  const result = await upsertExecutedDive(db, {
    shopId: shop.id,
    tripId: booking.tripId,
    diveNumber: 1,
    actualSiteId: elsewhere.id,
    recordedByPersonId: staff.person.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json({ ok: true, actualSite: elsewhere.name });
}
