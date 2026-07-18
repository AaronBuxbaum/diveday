import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { gearAssignmentFailure } from "@/lib/gear";
import type { AppDb } from "./client";
import { bookings, gearAssignments, gearItems, gearServiceEvents, people, trips } from "./schema";

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

/** Only current, unclaimed equipment is offered in packing controls. */
export async function listAvailableGear(db: AppDb, shopId: string) {
  return db
    .select()
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), eq(gearItems.state, "available")))
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

/** Retirement is terminal in v1: a checked-out item cannot be retired out from under a diver. */
export async function retireGear(db: AppDb, shopId: string, gearItemId: string) {
  const [retired] = await db
    .update(gearItems)
    .set({ state: "retired" })
    .where(
      and(
        eq(gearItems.id, gearItemId),
        eq(gearItems.shopId, shopId),
        inArray(gearItems.state, ["available", "service_hold"]),
      ),
    )
    .returning({ id: gearItems.id });
  return Boolean(retired);
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

/**
 * Packing view for one trip. A left join keeps an unassigned diver visible;
 * the UI must never make incomplete gear work disappear from the roster.
 */
export async function listTripGearAssignments(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ booking: bookings, person: people, assignment: gearAssignments, item: gearItems })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(
      gearAssignments,
      and(eq(gearAssignments.bookingId, bookings.id), eq(gearAssignments.status, "assigned")),
    )
    .leftJoin(gearItems, eq(gearItems.id, gearAssignments.gearItemId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(people.fullName), asc(gearItems.type), asc(gearItems.label));
}

export type RecordGearServiceOutcome =
  | { ok: true; serviceEventId: string }
  | { ok: false; reason: "gear_not_found" | "staff_not_found" | "checked_out" | "retired" };

/**
 * An item is briefly claimed with a service hold before its event is written.
 * That makes a service release and a simultaneous front-desk assignment
 * deterministic: one wins, and no checked-out item can be released by a log.
 */
export async function recordGearService(
  db: AppDb,
  input: {
    shopId: string;
    gearItemId: string;
    recordedByPersonId: string;
    note: string;
    serviceCompletedAt?: Date;
    nextServiceDueAt?: Date | null;
  },
): Promise<RecordGearServiceOutcome> {
  return db.transaction(async (tx): Promise<RecordGearServiceOutcome> => {
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, input.recordedByPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

    const [item] = await tx
      .select({ id: gearItems.id, state: gearItems.state })
      .from(gearItems)
      .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
      .limit(1);
    if (!item) return { ok: false, reason: "gear_not_found" };
    if (item.state === "assigned") return { ok: false, reason: "checked_out" };
    if (item.state === "retired") return { ok: false, reason: "retired" };

    const [held] = await tx
      .update(gearItems)
      .set({ state: "service_hold" })
      .where(
        and(
          eq(gearItems.id, item.id),
          eq(gearItems.shopId, input.shopId),
          inArray(gearItems.state, ["available", "service_hold"]),
        ),
      )
      .returning({ id: gearItems.id });
    if (!held) return { ok: false, reason: "checked_out" };

    const [event] = await tx
      .insert(gearServiceEvents)
      .values({
        shopId: input.shopId,
        gearItemId: item.id,
        recordedByPersonId: staff.id,
        note: input.note.trim(),
        serviceCompletedAt: input.serviceCompletedAt ?? new Date(),
        nextServiceDueAt: input.nextServiceDueAt ?? null,
      })
      .returning({ id: gearServiceEvents.id });
    if (!event) throw new Error("recordGearService: insert returned no row");

    await tx
      .update(gearItems)
      .set({ state: "available", serviceDueAt: input.nextServiceDueAt ?? null })
      .where(and(eq(gearItems.id, item.id), eq(gearItems.state, "service_hold")));
    return { ok: true, serviceEventId: event.id };
  });
}

/** Most recent first so a staff member can see the last completed work at a glance. */
export async function listGearServiceEvents(db: AppDb, shopId: string, gearItemId?: string) {
  const scope = [eq(gearServiceEvents.shopId, shopId)];
  if (gearItemId) scope.push(eq(gearServiceEvents.gearItemId, gearItemId));
  return db
    .select({ service: gearServiceEvents, item: gearItems, staff: people })
    .from(gearServiceEvents)
    .innerJoin(gearItems, eq(gearItems.id, gearServiceEvents.gearItemId))
    .innerJoin(people, eq(people.id, gearServiceEvents.recordedByPersonId))
    .where(and(...scope))
    .orderBy(desc(gearServiceEvents.serviceCompletedAt));
}
