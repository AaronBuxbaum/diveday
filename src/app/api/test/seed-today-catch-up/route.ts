import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { recordSeatChange } from "@/db/operations";
import { bookings, people, personRoles, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { initializeTodayCatchUp } from "@/db/today-catch-up";
import { liveTrip } from "@/db/trips-live";
import { seatNotCancelled } from "@/db/trips-queries";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized, requireDemoTenant, testRouteRefused } from "@/lib/e2e-test-routes";
import { shopDayBounds } from "@/lib/zoned";

/**
 * A private-shop fixture for Today’s real acknowledgement action. It establishes
 * the reader’s first-view mark, then records one same-day seat event by another
 * staff member so the page can exercise the actual Got it action and reload.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();

  const slug = new URL(request.url).searchParams.get("shop");
  if (!slug || slug === DEMO_SHOP_SLUG || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return testRouteRefused();
  }

  const db = await getDb();
  const tenant = await requireDemoTenant(request, () => getShopBySlug(db, slug));
  if (!tenant.ok) return tenant.response;
  const { shop } = tenant;

  const staff = await db
    .select({ personId: people.id, role: personRoles.role })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(
      and(
        eq(people.shopId, shop.id),
        isNull(people.deletedAt),
        inArray(personRoles.role, ["owner", "instructor", "captain", "divemaster"]),
      ),
    );
  const reader = staff.find((row) => row.role === "owner");
  const actor = staff.find((row) => row.personId !== reader?.personId);
  if (!reader || !actor) {
    return NextResponse.json({ error: "fixture_not_ready" }, { status: 409 });
  }

  const now = nowDate();
  const day = shopDayBounds(now, shop.timezone);
  const [seat] = await db
    .select({
      tripId: trips.id,
      tripTitle: trips.title,
      bookingId: bookings.id,
      personId: people.id,
      personName: people.fullName,
    })
    .from(trips)
    .innerJoin(bookings, eq(bookings.tripId, trips.id))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(trips.shopId, shop.id),
        eq(bookings.shopId, shop.id),
        eq(people.shopId, shop.id),
        eq(trips.status, "scheduled"),
        liveTrip(),
        isNull(people.deletedAt),
        seatNotCancelled,
        gte(trips.startsAt, day.from),
        lt(trips.startsAt, day.to),
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(1);
  if (!seat) return NextResponse.json({ error: "fixture_not_ready" }, { status: 409 });

  await initializeTodayCatchUp(db, {
    shopId: shop.id,
    personId: reader.personId,
    timeZone: shop.timezone,
    now,
    eventIds: [],
  });
  // The line seating writes, which the catch-up reads as "took a seat".
  await recordSeatChange(db, {
    shopId: shop.id,
    tripId: seat.tripId,
    actorPersonId: actor.personId,
    bookingId: seat.bookingId,
    code: "seat_added",
  });

  return NextResponse.json({ personName: seat.personName, tripTitle: seat.tripTitle });
}
