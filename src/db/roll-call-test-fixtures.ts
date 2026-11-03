import { and, eq } from "drizzle-orm";
import { nowMs } from "@/lib/clock";
import type { fileScopedShopContext } from "@/test/db";
import {
  bookings as bookingsTable,
  people,
  rollCallEvents as rollCallEventsTable,
  trips as tripsTable,
} from "./schema";
import { listStaff } from "./trips";
import { livePerson } from "./trips-live";

/**
 * The unclosed-roll-call suites' fixtures (DOM-H3): a boat that already tied
 * up and the boarding log it left. Shared by the manifest's and departure
 * counts' suites here and by Today's roll-call row suites
 * (`src/features/today/today-roll-call-test-fixtures.ts` adds the row finders).
 */
export const HOUR = 60 * 60 * 1000;

/**
 * A departure that already tied up, with `divers` bookings on it. Inserted
 * directly rather than through `createBooking`: the booking path (rightly)
 * refuses to sell a seat on a boat that has already sailed, and this fixture
 * is about what the log looks like afterwards.
 *
 * `endedHoursAgo` may be negative, which puts the boat still out on the water.
 */
export async function returnedTrip(
  db: ReturnType<typeof fileScopedShopContext>["db"],
  shopId: string,
  options: { endedHoursAgo: number; divers: number; plannedDives?: number; title?: string },
) {
  // The unit-test clock is frozen (vitest.config.ts's DIVEDAY_CLOCK) and the
  // demo seed is anchored to it, so every fixture instant is measured from
  // `nowMs()` — a real `nowMs()` here would land days away from the seed.
  const endsAt = new Date(nowMs() - options.endedHoursAgo * HOUR);
  const [trip] = await db
    .insert(tripsTable)
    .values({
      shopId,
      title: options.title ?? "Returned Two-Tank — Molasses",
      startsAt: new Date(endsAt.getTime() - 4 * HOUR),
      endsAt,
      capacity: 12,
      plannedDives: options.plannedDives ?? 1,
      priceCents: 13000,
    })
    .returning();
  if (!trip) throw new Error("fixture trip insert returned no row");
  const divers = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), livePerson()))
    .limit(options.divers);
  if (divers.length < options.divers) throw new Error("seed has too few people for this fixture");
  const rows = await db
    .insert(bookingsTable)
    .values(
      divers.map((diver) => ({
        bookedAs: "diver" as const,
        shopId,
        tripId: trip.id,
        personId: diver.id,
        status: "checked_in" as const,
      })),
    )
    .returning();
  const [staff] = await listStaff(db, shopId);
  if (!staff) throw new Error("seed staff missing");
  return { trip, bookingIds: rows.map((row) => row.id), staffId: staff.person.id };
}

/**
 * Board every diver at the dock, by direct insert.
 *
 * Not `recordRollCall`: that (rightly) refuses to board anyone whose
 * readiness isn't clear, and this fixture's trip has no requirements row, so
 * every diver on it reads blocked. What is being set up here is the *log* a
 * boat leaves behind, and the log this suite cares about is "these people
 * were on the boat" — the precondition for an after-dive count existing at
 * all.
 */
export async function boardAtDeparture(
  db: ReturnType<typeof fileScopedShopContext>["db"],
  input: { shopId: string; tripId: string; staffId: string; bookingIds: readonly string[] },
  occurredAt = new Date(nowMs() - 5 * HOUR),
) {
  await db.insert(rollCallEventsTable).values(
    input.bookingIds.map((bookingId) => ({
      shopId: input.shopId,
      tripId: input.tripId,
      bookingId,
      recordedByPersonId: input.staffId,
      status: "boarded" as const,
      checkpoint: "departure",
      source: "live" as const,
      occurredAt,
    })),
  );
}
