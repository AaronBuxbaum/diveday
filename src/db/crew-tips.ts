import { and, asc, eq, gte, inArray, lt, sum } from "drizzle-orm";
import { splitTipsEqually } from "@/lib/crew-sheet";
import type { DbExecutor } from "./client";
import { boats, bookings, tips, tripAssignments, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Tips, seen from the boat** (UX review 2026-10-11, item 18). A diver tips
 * "the crew" and the money goes to the shop, which passes it on; these two
 * reads are how the app shows that promise being kept. Paid tips only,
 * anchored to the departure the tip was left for, on the same basis as the
 * crew sheet (`src/db/crew-sheet.ts`) and Reports' tips figure.
 */

/**
 * **The reader's own share** of the paid tips on the departures they crewed
 * that left inside the window: a crew member's "Your share of tips this
 * week" (issue #2468). Each departure's tips are split equally across its
 * whole crew by `splitTipsEqually`, the rule the crew sheet prints, and the
 * reader's piece of each is added up. Two crew on one boat each read half, so
 * neither mistakes the boat's total for their own. How the shop actually
 * divides tips is the shop's; this is the same estimate the crew sheet makes,
 * and it is not payroll.
 *
 * Only departures the reader crewed are read, and nothing else about money
 * leaves this function (decision H-141: crew see tips on their own boats and
 * no other shop money).
 */
export async function crewTipShare(
  db: DbExecutor,
  shopId: string,
  personId: string,
  window: { from: Date; to: Date },
): Promise<number> {
  const mine = await db
    .select({ tripId: trips.id, total: sum(tips.amountCents) })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(
      tripAssignments,
      and(eq(tripAssignments.tripId, trips.id), eq(tripAssignments.personId, personId)),
    )
    .where(
      and(
        liveTrip(),
        eq(tips.shopId, shopId),
        eq(tips.status, "paid"),
        gte(trips.startsAt, window.from),
        lt(trips.startsAt, window.to),
      ),
    )
    .groupBy(trips.id);
  if (mine.length === 0) return 0;
  const crew = await db
    .select({ tripId: tripAssignments.tripId, personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(
      inArray(
        tripAssignments.tripId,
        mine.map((row) => row.tripId),
      ),
    );
  const crewByTrip = new Map<string, string[]>();
  for (const member of crew) {
    const members = crewByTrip.get(member.tripId);
    if (members) members.push(member.personId);
    else crewByTrip.set(member.tripId, [member.personId]);
  }
  let share = 0;
  for (const row of mine) {
    const split = splitTipsEqually(Number(row.total ?? 0), crewByTrip.get(row.tripId) ?? []);
    share += split.get(personId) ?? 0;
  }
  return share;
}

/** One departure's paid tips, for the evening's takings. */
export type DepartureTips = {
  tripId: string;
  startsAt: Date;
  /** The boat's name when the departure has one, else the departure's title. */
  label: string;
  cents: number;
};

/**
 * Paid tips per departure that left inside the window, in clock order, and
 * only departures that took any: Close-out's per-boat line under "And $140 in
 * tips."
 */
export async function tipsByDeparture(
  db: DbExecutor,
  shopId: string,
  window: { from: Date; to: Date },
): Promise<DepartureTips[]> {
  const rows = await db
    .select({
      tripId: trips.id,
      startsAt: trips.startsAt,
      title: trips.title,
      boatName: boats.name,
      total: sum(tips.amountCents),
    })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .leftJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(
      and(
        liveTrip(),
        eq(tips.shopId, shopId),
        eq(tips.status, "paid"),
        gte(trips.startsAt, window.from),
        lt(trips.startsAt, window.to),
      ),
    )
    .groupBy(trips.id, trips.startsAt, trips.title, boats.name)
    .orderBy(asc(trips.startsAt));
  return rows
    .map((row) => ({
      tripId: row.tripId,
      startsAt: row.startsAt,
      label: row.boatName ?? row.title,
      cents: Number(row.total ?? 0),
    }))
    .filter((row) => row.cents > 0);
}
