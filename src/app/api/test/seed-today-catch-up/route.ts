import { and, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { recordDeskEvent } from "@/db/desk-events";
import { bookings, people, personRoles, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { initializeTodayCatchUp } from "@/db/today-catch-up";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { shopDayBounds } from "@/lib/zoned";

/**
 * A private-shop fixture for Today’s real acknowledgement action. It establishes
 * the reader’s first-view mark, then records one same-day seat event by another
 * staff member so the page can exercise the actual Got it action and reload.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const slug = new URL(request.url).searchParams.get("shop");
  if (!slug || slug === DEMO_SHOP_SLUG || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const db = await getDb();
  const shop = await getShopBySlug(db, slug);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

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
        isNull(trips.deletedAt),
        isNull(people.deletedAt),
        ne(bookings.status, "cancelled"),
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
  await recordDeskEvent(db, {
    shopId: shop.id,
    tripId: seat.tripId,
    kind: "seat_taken",
    bookingId: seat.bookingId,
    subjectPersonId: seat.personId,
    actorPersonId: actor.personId,
    occurredAt: now,
  });

  return NextResponse.json({ personName: seat.personName, tripTitle: seat.tripTitle });
}
