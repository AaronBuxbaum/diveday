import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { issueShopCertification } from "@/db/readiness";
import { bookings, courses, trips } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Makes the demo recap's day **a course session that certified its diver**,
 * so the dive record's "Certified" line has something to render (fourth
 * review, item 55).
 *
 * A test route rather than a line in the seed, the call `seed-observed-species`
 * makes beside it: the demo's recap is an ordinary reef day, and that calm
 * variant is already photographed as `recap`. The card itself goes through
 * `issueShopCertification`, the roster's own Certify door, so the line is one
 * the product could have produced. The one step no writer takes is turning
 * the pinned reef boat into an Advanced Open Water session: a course session
 * is created as one on the schedule board, and building a second sailed
 * departure here would photograph a different day.
 *
 * Mutating the shared fixture is safe: each Playwright worker owns its database
 * and `/api/test/reset` restores the schedule before every test. Gated
 * identically to `/api/test/reset`, so it can never be reachable in a real
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
    .select({ tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.id, DEMO_RECAP_BOOKING_ID), eq(bookings.shopId, shop.id)))
    .limit(1);
  if (!booking) return NextResponse.json({ error: "no_booking" }, { status: 404 });

  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Advanced Open Water Diver")))
    .limit(1);
  if (!course) return NextResponse.json({ error: "no_course" }, { status: 404 });
  await db
    .update(trips)
    .set({ courseId: course.id })
    .where(and(eq(trips.id, booking.tripId), eq(trips.shopId, shop.id)));

  const [staff] = await listStaff(db, shop.id);
  if (!staff) return NextResponse.json({ error: "no_staff" }, { status: 404 });
  const card = await issueShopCertification(db, {
    shopId: shop.id,
    personId: booking.personId,
    tripId: booking.tripId,
    level: "advanced_open_water",
    issuedByPersonId: staff.person.id,
  });
  if (!card) return NextResponse.json({ error: "not_issued" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
