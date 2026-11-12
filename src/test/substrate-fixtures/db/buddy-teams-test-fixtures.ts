import { and, eq } from "drizzle-orm";
import { listTripBuddyTeamEvents, listTripBuddyTeams } from "../../../db/buddy-teams";
import { tripAssignments } from "../../../db/schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "../../../db/trips";
import type { fileScopedShopContext } from "../../db";

/**
 * The Benwood reef trip: three booked divers and — unlike today's Molasses
 * boat — no seeded buddy teams, so every test starts from an unteamed roster
 * with an odd count (odd counts are normal, never an error).
 */
export async function loadBuddyContext(ctx: ReturnType<typeof fileScopedShopContext>) {
  const { db, shop } = ctx;
  const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = tripRows.find((row) => row.title.startsWith("Two-Tank Reef — Benwood"));
  if (!trip) throw new Error("demo Benwood trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  const [a, b, c] = roster;
  if (!a || !b || !c) throw new Error("expected three Benwood bookings");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, trip, a, b, c, staff: staff.person };
}

/** Put a named fixture staff member on the same trip's crew list. */
export async function assignCrew(
  db: Awaited<ReturnType<typeof loadBuddyContext>>["db"],
  tripId: string,
  personId: string,
) {
  const existing = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, personId)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(tripAssignments).values({ tripId, personId });
  }
}

export async function buddyStateOf(
  db: Awaited<ReturnType<typeof loadBuddyContext>>["db"],
  shopId: string,
  tripId: string,
) {
  return {
    teams: await listTripBuddyTeams(db, shopId, tripId),
    trail: await listTripBuddyTeamEvents(db, shopId, tripId),
  };
}
