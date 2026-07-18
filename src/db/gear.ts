import { and, asc, eq, ne } from "drizzle-orm";
import { gearAssignmentFailure } from "@/lib/gear";
import type { AppDb } from "./client";
import { bookings, gearAssignments, gearItems, people, trips } from "./schema";

export type NewGearItem = {
  shopId: string;
  label: string;
  type: "bcd" | "regulator" | "wetsuit" | "mask_fins" | "weights" | "tank";
  size?: string;
  serviceDueAt?: Date;
  notes?: string;
};

export async function createGearItem(db: AppDb, input: NewGearItem) {
  const [item] = await db
    .insert(gearItems)
    .values({
      ...input,
      label: input.label.trim(),
      size: input.size?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .returning();
  return item ?? null;
}

export async function listGearInventory(db: AppDb, shopId: string) {
  return db
    .select()
    .from(gearItems)
    .where(eq(gearItems.shopId, shopId))
    .orderBy(asc(gearItems.type), asc(gearItems.label));
}

export type AssignGearOutcome =
  | { ok: true; assignmentId: string }
  | {
      ok: false;
      reason:
        | "booking_unavailable"
        | "gear_not_found"
        | "not_available"
        | "service_hold"
        | "retired";
    };

/**
 * Update the item only when it is available, so two front-desk actions cannot
 * both claim it. A service hold never has an override path here.
 */
export async function assignGear(
  db: AppDb,
  input: { shopId: string; bookingId: string; gearItemId: string },
): Promise<AssignGearOutcome> {
  return db.transaction(async (tx): Promise<AssignGearOutcome> => {
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (!booking) return { ok: false, reason: "booking_unavailable" };
    const [item] = await tx
      .select()
      .from(gearItems)
      .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
      .limit(1);
    if (!item) return { ok: false, reason: "gear_not_found" };
    const failure = gearAssignmentFailure(item);
    if (failure) return { ok: false, reason: failure };

    const [claimed] = await tx
      .update(gearItems)
      .set({ state: "assigned" })
      .where(and(eq(gearItems.id, item.id), eq(gearItems.state, "available")))
      .returning({ id: gearItems.id });
    if (!claimed) return { ok: false, reason: "not_available" };
    const [assignment] = await tx
      .insert(gearAssignments)
      .values({ shopId: input.shopId, bookingId: booking.id, gearItemId: item.id })
      .returning({ id: gearAssignments.id });
    if (!assignment) throw new Error("assignGear: insert returned no row");
    return { ok: true, assignmentId: assignment.id };
  });
}

export async function returnGear(db: AppDb, shopId: string, assignmentId: string) {
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(gearAssignments)
      .where(
        and(
          eq(gearAssignments.id, assignmentId),
          eq(gearAssignments.shopId, shopId),
          eq(gearAssignments.status, "assigned"),
        ),
      )
      .limit(1);
    if (!assignment) return false;
    await tx
      .update(gearAssignments)
      .set({ status: "returned", returnedAt: new Date() })
      .where(eq(gearAssignments.id, assignment.id));
    await tx
      .update(gearItems)
      .set({ state: "available" })
      .where(and(eq(gearItems.id, assignment.gearItemId), eq(gearItems.state, "assigned")));
    return true;
  });
}

export async function setGearServiceHold(
  db: AppDb,
  shopId: string,
  gearItemId: string,
  held: boolean,
) {
  const [item] = await db
    .select({ state: gearItems.state })
    .from(gearItems)
    .where(and(eq(gearItems.id, gearItemId), eq(gearItems.shopId, shopId)))
    .limit(1);
  if (!item || item.state === "assigned") return false;
  const target = held ? "service_hold" : "available";
  const [updated] = await db
    .update(gearItems)
    .set({ state: target })
    .where(and(eq(gearItems.id, gearItemId), eq(gearItems.shopId, shopId)))
    .returning({ id: gearItems.id });
  return Boolean(updated);
}

/** Packing/return view: all equipment still physically checked out. */
export async function listCurrentGearAssignments(db: AppDb, shopId: string) {
  return db
    .select({ assignment: gearAssignments, item: gearItems, person: people, trip: trips })
    .from(gearAssignments)
    .innerJoin(gearItems, eq(gearItems.id, gearAssignments.gearItemId))
    .innerJoin(bookings, eq(bookings.id, gearAssignments.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(gearAssignments.shopId, shopId), eq(gearAssignments.status, "assigned")))
    .orderBy(asc(trips.startsAt), asc(people.fullName));
}
