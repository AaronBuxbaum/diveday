import { and, count, eq, isNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { boats, trips } from "./schema";

export type Boat = typeof boats.$inferSelect;

/** The shop's fleet: the hulls it has, never the ones it deleted. */
export async function listBoats(db: AppDb, shopId: string): Promise<Boat[]> {
  return db
    .select()
    .from(boats)
    .where(and(eq(boats.shopId, shopId), isNull(boats.deletedAt)))
    .orderBy(boats.name);
}

/**
 * One live hull — for the checks that ask what the shop currently runs, like a
 * departure's capacity against the vessel it sails on.
 */
export async function getBoatById(db: AppDb, shopId: string, boatId: string): Promise<Boat | null> {
  const [boat] = await db
    .select()
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
    .limit(1);
  return boat ?? null;
}

/**
 * Every hull the shop has ever had, deleted ones included — for resolving the
 * *name* a past departure sailed under. See `getBoatForHistory` below for why
 * this is a separate read from `listBoats`.
 */
export async function listBoatsForHistory(db: AppDb, shopId: string): Promise<Boat[]> {
  return db.select().from(boats).where(eq(boats.shopId, shopId)).orderBy(boats.name);
}

/**
 * One hull **whatever its state** — for the surfaces that name the vessel a
 * departure sailed on.
 *
 * This is the deliberate opposite of `getBoatById` above, and the whole point of
 * soft-deleting a boat: a manifest, a departure log or a close-out record from
 * two seasons ago must still say which vessel, long after the shop sold it. A
 * read that hid a deleted hull here would leave exactly the blank the hard
 * delete used to leave.
 */
export async function getBoatForHistory(
  db: AppDb,
  shopId: string,
  boatId: string,
): Promise<Boat | null> {
  const [boat] = await db
    .select()
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
    .limit(1);
  return boat ?? null;
}

/**
 * How many departures this hull is on, for the confirm to say so before a shop
 * taps Delete.
 *
 * Counted rather than refused: retiring a sold boat is an ordinary thing a shop
 * does, a refusal would leave the fleet list permanently cluttered, and with a
 * soft delete nothing is lost either way. A hull that never sailed goes quietly.
 */
export async function countBoatDepartures(
  db: AppDb,
  shopId: string,
  boatId: string,
): Promise<number> {
  const [row] = await db
    .select({ departures: count(trips.id) })
    .from(trips)
    // diveday:allow-deleted-trips: a hull's history is the point — a departure
    // the shop took off the board still sailed on this boat, and the confirm is
    // telling the shop how much history the delete touches.
    .where(and(eq(trips.shopId, shopId), eq(trips.boatId, boatId), ne(trips.status, "cancelled")));
  return row?.departures ?? 0;
}

export async function createBoat(
  db: AppDb,
  shopId: string,
  name: string,
  capacity: number,
  description: string | null = null,
): Promise<Boat> {
  const [boat] = await db
    .insert(boats)
    .values({
      shopId,
      name,
      capacity,
      description,
    })
    .returning();
  if (!boat) {
    throw new Error("createBoat: failed to insert boat");
  }
  return boat;
}

export async function updateBoat(
  db: AppDb,
  shopId: string,
  boatId: string,
  name: string,
  capacity: number,
  description: string | null = null,
): Promise<Boat | null> {
  const [boat] = await db
    .update(boats)
    .set({ name, capacity, description })
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
    .returning();
  return boat ?? null;
}

/**
 * **Stamps, never removes** (ADR 20260820-every-delete-is-soft).
 *
 * A real `delete` here did not fail loudly the way a foreign key normally
 * would: `trips.boat_id` is `onDelete: "set null"`, so it quietly rewrote every
 * past departure that used the hull to say no vessel was ever recorded. That is
 * the fact an insurer or a coast-guard inquiry asks for first, and nothing
 * warned, counted or undid it.
 *
 * Already-deleted rows are left alone rather than re-stamped, so the date keeps
 * saying when the shop actually retired the boat.
 */
export async function deleteBoat(db: AppDb, shopId: string, boatId: string): Promise<boolean> {
  const result = await db
    .update(boats)
    .set({ deletedAt: nowDate() })
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
    .returning({ id: boats.id });
  return result.length > 0;
}
