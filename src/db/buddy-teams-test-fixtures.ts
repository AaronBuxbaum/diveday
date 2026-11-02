import type { fileScopedShopContext } from "@/test/db";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

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
