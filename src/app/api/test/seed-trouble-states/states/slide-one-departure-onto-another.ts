import { and, eq, gte, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { tripAssignments, trips } from "@/db/schema";
import { moveTrip } from "@/db/trips";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";

/**
 * **One divemaster on two hulls at the same hours** (issue #1695) — the state
 * `setTripCrew` and `changeTripCrew` both refuse to write, and the one a shop
 * reaches anyway.
 *
 * The only door into it is `moveTrip`: it slides a departure's window and never
 * looks at crew, so a boat landed on top of another leaves both crews as they
 * were. Reached here the same way, through the real mutation, rather than by
 * inserting the overlap by hand — an assignment row the roster would have
 * refused is not the state this photographs.
 *
 * Not seeded into blue-mantis for the reason the whole route exists: a demo
 * shop permanently warning that its divemaster cannot be where the schedule
 * says she is, is a worse demo.
 *
 * Returns the boat that moved, because both captures address it — the trip
 * page by id, the staffing week by the shop-local day it landed on (`?week=`
 * snaps any date to its Monday, `resolveWeekStart`).
 *
 * `hostSailedAt` first slides the host itself back to that instant, through
 * the same `moveTrip`, so both boats are out on the water when the queue is
 * read — the state Today's sailed row (issue #1814) is photographed in.
 */
export async function slideOneDepartureOntoAnother(
  db: AppDb,
  shopId: string,
  now: Date,
  timezone: string,
  options: { hostSailedAt?: Date } = {},
): Promise<{ tripId: string; otherTitle: string; date: string } | null> {
  // Upcoming, crewed, scheduled departures, earliest first — one row per crew
  // member. An hour of slack ahead of the frozen clock keeps a boat that is
  // already out of it: `moveTrip` refuses one the crew has counted heads on.
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      personId: tripAssignments.personId,
    })
    .from(trips)
    .innerJoin(tripAssignments, eq(tripAssignments.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, new Date(now.getTime() + HOUR_MS)),
      ),
    )
    .orderBy(trips.startsAt);

  type Departure = { id: string; title: string; startsAt: Date; endsAt: Date; crew: Set<string> };
  const byTrip = new Map<string, Departure>();
  for (const row of rows) {
    const entry = byTrip.get(row.id) ?? { ...row, crew: new Set<string>() };
    entry.crew.add(row.personId);
    byTrip.set(row.id, entry);
  }
  const departures = [...byTrip.values()];
  const [host] = departures;
  if (!host) return null;
  // The first later departure sharing somebody with the host and **not already
  // overlapping it** — landing one on top of the other is what makes the clash,
  // and a pair that already overlaps would mean the move changed nothing.
  const mover = departures.find(
    (departure) =>
      departure.id !== host.id &&
      [...departure.crew].some((personId) => host.crew.has(personId)) &&
      (departure.startsAt >= host.endsAt || departure.endsAt <= host.startsAt),
  );
  if (!mover) return null;
  const landing = options.hostSailedAt ?? host.startsAt;
  if (options.hostSailedAt && !(await moveTrip(db, shopId, host.id, landing)).ok) return null;
  if (!(await moveTrip(db, shopId, mover.id, landing)).ok) return null;
  return {
    tripId: mover.id,
    otherTitle: host.title,
    date: calendarDateInTimezone(landing, timezone),
  };
}
