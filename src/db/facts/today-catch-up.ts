import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { recordDeskEvent } from "@/db/desk-events";
import { bookings, people, personRoles, trips } from "@/db/schema";
import { initializeTodayCatchUp } from "@/db/today-catch-up";
import { liveTrip } from "@/db/trips-live";
import { seatNotCancelled } from "@/db/trips-queries";
import { shopDayBounds } from "@/lib/zoned";
import { FactRefused } from "./refusal";

/**
 * **Something happened on Today since the owner last looked** (`todayCatchUp`):
 * the owner's first-view mark, then one same-day seat taken by another staff
 * member, so the page can exercise the real "Got it" action and reload. A
 * private shop's fact: it writes a read mark for the shop's owner.
 */
export async function takeASeatSinceTheOwnerLooked(
  db: AppDb,
  shop: { id: string; timezone: string },
  now: Date,
) {
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
  if (!reader || !actor) throw new FactRefused("fixture_not_ready");

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
  if (!seat) throw new FactRefused("fixture_not_ready");

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
  return { personName: seat.personName, tripTitle: seat.tripTitle };
}
