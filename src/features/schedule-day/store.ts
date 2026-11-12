import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { boats, bookings, people, tripScheduleDays, trips } from "@/db/schema";
import { boatClashesByTrip, liveTrip, seatNotCancelled, tripCrewByTrip } from "@/db/trips";
import { sellableSeats } from "@/lib/boat-safety";
import { seatName } from "@/lib/held-seat";
import { physicalPeople } from "@/lib/manifest-person-counts";
import { shopDaysBounds } from "@/lib/zoned";
import { crewCollisions } from "./rules";

/** The occupied legs in a shop-local day, including a leg that began yesterday. */
export async function readScheduleDay(db: AppDb, shopId: string, day: string, timeZone: string) {
  const { from, to } = shopDaysBounds(day, day, timeZone);
  const start = sql<Date>`coalesce(${tripScheduleDays.startsAt}, ${trips.startsAt})`.mapWith(
    trips.startsAt,
  );
  const end = sql<Date>`coalesce(${tripScheduleDays.endsAt}, ${trips.endsAt})`.mapWith(
    trips.endsAt,
  );
  const legs = await db
    .select({
      tripId: trips.id,
      title: trips.title,
      boatName: boats.name,
      diveMode: trips.diveMode,
      capacity: trips.capacity,
      boatCapacity: boats.capacity,
      certifiedPassengers: boats.certifiedPassengers,
      certifiedTotalPersons: boats.certifiedTotalPersons,
      startsAt: start,
      endsAt: end,
    })
    .from(trips)
    .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .leftJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        lt(start, to),
        gt(end, from),
      ),
    )
    .orderBy(asc(start), asc(trips.title), asc(trips.id));
  const grouped = new Map<
    string,
    {
      tripId: string;
      title: string;
      boatName: string | null;
      diveMode: (typeof trips.$inferSelect)["diveMode"];
      capacity: number;
      boatCapacity: number | null;
      certifiedPassengers: number | null;
      certifiedTotalPersons: number | null;
      windows: { startsAt: Date; endsAt: Date }[];
    }
  >();
  for (const leg of legs) {
    const row = grouped.get(leg.tripId) ?? {
      tripId: leg.tripId,
      title: leg.title,
      boatName: leg.boatName,
      diveMode: leg.diveMode,
      capacity: leg.capacity,
      boatCapacity: leg.boatCapacity,
      certifiedPassengers: leg.certifiedPassengers,
      certifiedTotalPersons: leg.certifiedTotalPersons,
      windows: [],
    };
    row.windows.push({ startsAt: leg.startsAt, endsAt: leg.endsAt });
    grouped.set(leg.tripId, row);
  }
  const departures = [...grouped.values()];
  const ids = departures.map((row) => row.tripId);
  const [crew, divers, hullClashes, allLegs] = await Promise.all([
    tripCrewByTrip(db, shopId, ids),
    ids.length === 0
      ? []
      : db
          .select({
            tripId: bookings.tripId,
            id: bookings.id,
            personId: people.id,
            name: people.fullName,
            partyLeadBookingId: bookings.partyLeadBookingId,
            status: bookings.status,
            identityUnconfirmedAt: bookings.identityUnconfirmedAt,
            identityBookedAs: bookings.identityBookedAs,
          })
          .from(bookings)
          .innerJoin(people, eq(people.id, bookings.personId))
          .where(
            and(
              eq(bookings.shopId, shopId),
              eq(people.shopId, shopId),
              inArray(bookings.tripId, ids),
              seatNotCancelled,
            ),
          )
          .orderBy(asc(bookings.createdAt), asc(people.fullName), asc(bookings.id)),
    boatClashesByTrip(db, shopId, ids),
    ids.length === 0
      ? []
      : db
          .select({
            tripId: tripScheduleDays.tripId,
            startsAt: tripScheduleDays.startsAt,
            endsAt: tripScheduleDays.endsAt,
          })
          .from(tripScheduleDays)
          .where(inArray(tripScheduleDays.tripId, ids)),
  ]);
  const rows = departures.flatMap((row) => {
    const legs = allLegs.filter((leg) => leg.tripId === row.tripId);
    const allWindows = legs.length ? legs : row.windows;
    const windows = allWindows.filter((leg) => leg.startsAt < to && leg.endsAt > from);
    if (windows.length === 0) return [];
    return [
      {
        ...row,
        windows,
        allWindows,
        crew: crew.get(row.tripId) ?? [],
        divers: divers
          .filter((diver) => diver.tripId === row.tripId)
          .map((diver) => ({
            tripId: diver.tripId,
            id: diver.id,
            personId: diver.identityUnconfirmedAt ? null : diver.personId,
            name: seatName(diver.name, diver),
            identityHeld: Boolean(diver.identityUnconfirmedAt),
            partyLeadBookingId: diver.partyLeadBookingId,
            status: diver.status,
          })),
      },
    ];
  });
  return rows.map((row) => {
    const persons = physicalPeople(
      row.divers
        .filter((seat) => seat.status === "booked")
        .map((seat) => ({
          bookingId: seat.id,
          personId: seat.personId ?? undefined,
          identityWithheld: seat.identityHeld,
        })),
      row.crew,
    );
    const totalPersonNotice =
      row.certifiedTotalPersons !== null && persons > row.certifiedTotalPersons
        ? {
            code: "over_total_persons" as const,
            persons,
            limit: row.certifiedTotalPersons,
            counted: false,
          }
        : null;
    return {
      ...row,
      totalPersonNotice,
      boatClashes: hullClashes.get(row.tripId) ?? [],
      overSellableCapacity:
        row.divers.filter((seat) => seat.status === "booked").length >
        sellableSeats(row.capacity, row.certifiedPassengers, row.boatCapacity, row.crew.length),
      collisions: rows
        .filter((other) => other.tripId !== row.tripId)
        .flatMap((other) =>
          crewCollisions(
            {
              ...row,
              status: "scheduled",
              crewIds: [
                ...row.crew.map((member) => member.id),
                ...row.divers.flatMap((seat) =>
                  seat.status === "booked" && seat.personId ? [seat.personId] : [],
                ),
              ],
            },
            {
              ...other,
              status: "scheduled",
              crewIds: [
                ...other.crew.map((member) => member.id),
                ...other.divers.flatMap((seat) =>
                  seat.status === "booked" && seat.personId ? [seat.personId] : [],
                ),
              ],
            },
          ).map((personId) => ({ personId, otherTripId: other.tripId, otherTitle: other.title })),
        ),
    };
  });
}
