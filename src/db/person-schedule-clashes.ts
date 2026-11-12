import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people, tripAssignments, tripScheduleDays, trips } from "./schema";
import { legWindow, windowsOverlap } from "./trips-clashes";
import { liveTrip } from "./trips-live";
import { seatHeld } from "./trips-queries";

export type PersonScheduleClash = {
  personId: string;
  personName: string;
  otherTripId: string;
  otherTitle: string;
};

/** Read after the schedule write, under the shop schedule fence. */
export async function personScheduleClashes(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<PersonScheduleClash[]> {
  const [trip] = await tx
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.id, tripId),
        liveTrip(),
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  if (!trip) return [];
  const days = await tx
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, tripId));
  const windows = days.length ? days : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];
  const crew = await tx
    .select({ id: people.id, name: people.fullName })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(
      and(eq(tripAssignments.tripId, tripId), eq(people.shopId, shopId), isNull(people.deletedAt)),
    );
  const divers = await tx
    .select({ id: people.id, name: people.fullName })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        seatHeld,
        isNull(bookings.identityUnconfirmedAt),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
      ),
    );
  const names = new Map([...crew, ...divers].map((person) => [person.id, person.name]));
  const ids = [...names.keys()];
  if (!ids.length) return [];
  const overlap = or(
    ...windows.map((window) => windowsOverlap(legWindow(tripScheduleDays, trips), window)),
  );
  const otherCrew = await tx
    .select({
      personId: tripAssignments.personId,
      otherTripId: trips.id,
      otherTitle: trips.title,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .where(
      and(
        inArray(tripAssignments.personId, ids),
        eq(trips.shopId, shopId),
        ne(trips.id, tripId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        overlap,
      ),
    );
  const otherDivers = await tx
    .select({ personId: bookings.personId, otherTripId: trips.id, otherTitle: trips.title })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.personId, ids),
        seatHeld,
        isNull(bookings.identityUnconfirmedAt),
        eq(trips.shopId, shopId),
        ne(trips.id, tripId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        overlap,
      ),
    );
  const clashes = new Map<string, PersonScheduleClash>();
  for (const row of [...otherCrew, ...otherDivers]) {
    const personName = names.get(row.personId);
    if (personName) clashes.set(`${row.personId}:${row.otherTripId}`, { ...row, personName });
  }
  return [...clashes.values()].sort(
    (a, b) => a.personName.localeCompare(b.personName) || a.otherTitle.localeCompare(b.otherTitle),
  );
}
