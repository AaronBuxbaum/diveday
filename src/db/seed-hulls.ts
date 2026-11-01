import { and, asc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boats, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Every demo boat day sails on a hull** (market sheet 2026-10-22, item 2).
 * Reports' "By boat" counts only departures that named a boat, so with most
 * of the demo's departures on none it summed to $1,310 of an $8,686 month.
 * A shop's boat days go out on one of its boats; the seed scenarios that
 * wrote them simply never said which.
 *
 * Updates-only and late, after every scenario that creates a departure: each
 * boat-mode departure with no hull takes the first of the fleet, by name, that
 * nothing else has out in its hours, in the order the departures sail. A
 * departure no hull is free for keeps none rather than putting one boat on
 * two departures at once (H-20260916-may-one-hull-carry, `src/db/trips-clashes.ts`).
 */
export async function seedHulls(db: DbExecutor, shopId: string): Promise<void> {
  const fleet = await liveFleet(db, shopId);
  if (fleet.length === 0) return;
  const board = await db
    .select({
      id: trips.id,
      boatId: trips.boatId,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
    })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.diveMode, "boat"),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  const outOn = new Map<string, { startsAt: Date; endsAt: Date }[]>(
    fleet.map((hull) => [hull.id, []]),
  );
  for (const trip of board) {
    if (trip.boatId) outOn.get(trip.boatId)?.push(trip);
  }
  const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
    a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
  for (const trip of board) {
    if (trip.boatId) continue;
    const hull = fleet.find(
      (boat) => !(outOn.get(boat.id) ?? []).some((other) => overlaps(trip, other)),
    );
    if (!hull) continue;
    outOn.get(hull.id)?.push(trip);
    await db
      .update(trips)
      .set({ boatId: hull.id })
      // diveday:allow-deleted-trips: the seed's own departure, read live above.
      .where(and(eq(trips.id, trip.id), isNull(trips.boatId)));
  }
}

/** The shop's boats still in its fleet, by name: the order every seed hands them out in. */
function liveFleet(db: DbExecutor, shopId: string) {
  return db
    .select({ id: boats.id })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), isNull(boats.deletedAt)))
    .orderBy(asc(boats.name));
}

/**
 * For a scenario writing one departure of its own: the first hull, by name,
 * that no other live, uncancelled departure has out in those hours, or none
 * when the whole fleet is out (the same rule `seedHulls` applies to the
 * board).
 */
export async function freeHull(
  db: DbExecutor,
  shopId: string,
  window: { startsAt: Date; endsAt: Date },
): Promise<string | null> {
  for (const hull of await liveFleet(db, shopId)) {
    const [clash] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shopId),
          eq(trips.boatId, hull.id),
          ne(trips.status, "cancelled"),
          liveTrip(),
          lt(trips.startsAt, window.endsAt),
          gt(trips.endsAt, window.startsAt),
        ),
      )
      .limit(1);
    if (!clash) return hull.id;
  }
  return null;
}
