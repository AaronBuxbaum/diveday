import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { bookings, trips } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { e2eTestRouteAuthorized, requireDemoTenant, testRouteRefused } from "@/lib/e2e-test-routes";

/**
 * Returns the one demo recap fixture's trip id so the browser fleet can reach
 * its staff page without navigating through a diver directory. This is a
 * read-only lookup, scoped to the verified demo shop on both rows, and returns
 * no booking or diver details.
 *
 * Gated like every `/api/test/*` route and refuses if the canonical fixture is
 * not still a demo shop.
 */
export async function GET(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  const db = await getDb();
  const tenant = await requireDemoTenant(request, () => getShopBySlug(db, DEMO_SHOP_SLUG));
  if (!tenant.ok) return tenant.response;
  const { shop } = tenant;

  const [booking] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, DEMO_RECAP_BOOKING_ID),
        eq(bookings.shopId, shop.id),
        eq(trips.shopId, shop.id),
      ),
    )
    .limit(1);
  if (!booking) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });

  return NextResponse.json({ tripId: booking.tripId });
}
