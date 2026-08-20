import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  GEAR_KIND_ORDER,
  type GearItemKind,
  type GearItemStatus,
  type GearServiceClock,
  type GearServiceKind,
  type GearServiceState,
  gearServiceState,
  pickDisplayReservation,
} from "@/lib/gear";
import {
  type AppDb,
  type DbExecutor,
  violatesExclusionConstraint,
  violatesUniqueIndex,
} from "./client";
import { offsetPage } from "./paging";
import {
  bookings,
  type GearItem,
  type GearReservation,
  gearItemKind,
  gearItems,
  gearReservations,
  gearServiceEvents,
  people,
  trips,
} from "./schema";

// The lib unions and the pg enums must never drift: both directions are
// compile errors here — a value added to one side without the other fails
// the build, not a migration at 2am.
gearItemKind.enumValues satisfies readonly GearItemKind[];
GEAR_KIND_ORDER satisfies readonly (typeof gearItemKind.enumValues)[number][];

function optional(value: string | undefined) {
  return value?.trim() || null;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type GearItemInput = {
  shopId: string;
  kind: GearItemKind;
  label: string;
  size?: string;
  serialNumber?: string;
  brandModel?: string;
  purchasedOn?: string;
};

export type CreateGearItemOutcome =
  | { ok: true; item: GearItem }
  | { ok: false; reason: "empty_label" | "duplicate_label" | "invalid_date" };

/**
 * Add one unit to the register. The label is the shop's own tag and must be
 * unique per shop — the database's unique index is the truth, and losing that
 * race reads back as the same worded refusal a plain duplicate gets.
 */
export async function createGearItem(
  db: AppDb,
  input: GearItemInput,
): Promise<CreateGearItemOutcome> {
  const label = input.label.trim();
  if (!label) return { ok: false, reason: "empty_label" };
  const purchasedOn = optional(input.purchasedOn);
  if (purchasedOn && !isValidCalendarDate(purchasedOn))
    return { ok: false, reason: "invalid_date" };
  try {
    const [item] = await db
      .insert(gearItems)
      .values({
        shopId: input.shopId,
        kind: input.kind,
        label,
        size: optional(input.size),
        serialNumber: optional(input.serialNumber),
        brandModel: optional(input.brandModel),
        purchasedOn,
      })
      .returning();
    if (!item) return { ok: false, reason: "duplicate_label" };
    return { ok: true, item };
  } catch (error) {
    if (violatesUniqueIndex(error, "gear_items_shop_label_unique")) {
      return { ok: false, reason: "duplicate_label" };
    }
    throw error;
  }
}

export type UpdateGearItemOutcome =
  | { ok: true; item: GearItem }
  | { ok: false; reason: "not_found" | "empty_label" | "duplicate_label" | "invalid_date" };

export async function updateGearItem(
  db: AppDb,
  input: GearItemInput & { gearItemId: string },
): Promise<UpdateGearItemOutcome> {
  const label = input.label.trim();
  if (!label) return { ok: false, reason: "empty_label" };
  const purchasedOn = optional(input.purchasedOn);
  if (purchasedOn && !isValidCalendarDate(purchasedOn))
    return { ok: false, reason: "invalid_date" };
  try {
    const [item] = await db
      .update(gearItems)
      .set({
        kind: input.kind,
        label,
        size: optional(input.size),
        serialNumber: optional(input.serialNumber),
        brandModel: optional(input.brandModel),
        purchasedOn,
        updatedAt: nowDate(),
      })
      .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
      .returning();
    return item ? { ok: true, item } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (violatesUniqueIndex(error, "gear_items_shop_label_unique")) {
      return { ok: false, reason: "duplicate_label" };
    }
    throw error;
  }
}

export type SetGearItemStatusOutcome =
  | { ok: true; item: GearItem }
  | { ok: false; reason: "not_found" };

/**
 * Move a unit between in service / needs service / retired. The service note
 * travels with `needs_service` ("inflator sticks") and is cleared on the way
 * back in — a stale complaint on a fixed unit reads as an open one.
 */
export async function setGearItemStatus(
  db: AppDb,
  input: { shopId: string; gearItemId: string; status: GearItemStatus; serviceNote?: string },
): Promise<SetGearItemStatusOutcome> {
  const [item] = await db
    .update(gearItems)
    .set({
      status: input.status,
      serviceNote: input.status === "in_service" ? null : optional(input.serviceNote),
      updatedAt: nowDate(),
    })
    .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
    .returning();
  return item ? { ok: true, item } : { ok: false, reason: "not_found" };
}

export type DeleteGearItemOutcome =
  | { ok: true; deleted: GearItem }
  | { ok: false; reason: "not_found" };

/**
 * Remove a unit outright — for the mistyped row, not the worn-out rig.
 * Service and rental history cascade away with it, which is exactly why
 * `retired` exists for a unit that actually lived: retiring preserves the
 * history, deleting is for rows that never should have existed.
 */
export async function deleteGearItem(
  db: AppDb,
  input: { shopId: string; gearItemId: string },
): Promise<DeleteGearItemOutcome> {
  const [deleted] = await db
    .delete(gearItems)
    .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
    .returning();
  return deleted ? { ok: true, deleted } : { ok: false, reason: "not_found" };
}

/** Units physically out the door right now — checked out and not yet home. */
export async function countCheckedOutGear(db: AppDb, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        isNotNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    );
  return row?.value ?? 0;
}

/** Presence is the register's on-switch: zero rows means no gear UI anywhere. */
export async function countGearItems(db: AppDb, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(gearItems)
    .where(eq(gearItems.shopId, shopId));
  return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Service events
// ---------------------------------------------------------------------------

export type RecordGearServiceOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "invalid_date" | "due_not_after_service" };

/**
 * Append one care event to a unit's history. When the bench work is what the
 * unit was pulled for, `returnToService` flips it back into the assignable
 * pool in the same transaction — recording the fix and still showing the
 * unit as broken is the half-updated state this option exists to prevent.
 */
export async function recordGearService(
  db: AppDb,
  input: {
    shopId: string;
    gearItemId: string;
    kind: GearServiceKind;
    servicedOn: string;
    nextDueOn?: string;
    note?: string;
    recordedByPersonId?: string;
    returnToService?: boolean;
  },
): Promise<RecordGearServiceOutcome> {
  const servicedOn = input.servicedOn.trim();
  const nextDueOn = optional(input.nextDueOn);
  if (!isValidCalendarDate(servicedOn) || (nextDueOn && !isValidCalendarDate(nextDueOn))) {
    return { ok: false, reason: "invalid_date" };
  }
  if (nextDueOn && nextDueOn <= servicedOn) return { ok: false, reason: "due_not_after_service" };

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: gearItems.id, status: gearItems.status })
      .from(gearItems)
      .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
      .limit(1);
    if (!item) return { ok: false, reason: "not_found" } as const;

    await tx.insert(gearServiceEvents).values({
      shopId: input.shopId,
      gearItemId: input.gearItemId,
      kind: input.kind,
      servicedOn,
      nextDueOn,
      note: optional(input.note),
      recordedByPersonId: input.recordedByPersonId ?? null,
    });

    if (input.returnToService && item.status === "needs_service") {
      await tx
        .update(gearItems)
        .set({ status: "in_service", serviceNote: null, updatedAt: nowDate() })
        .where(eq(gearItems.id, input.gearItemId));
    }
    return { ok: true } as const;
  });
}

/**
 * Each clock's latest reading per unit — the rows `gearServiceState` derives
 * from. The newest event of a kind *is* that clock, including one with no
 * `next_due_on` (which turns the clock off), so this reduces over the full
 * non-note history rather than filtering to dated rows and resurrecting a
 * superseded deadline.
 */
export async function latestServiceClocks(
  db: AppDb,
  shopId: string,
  gearItemIds?: readonly string[],
): Promise<Map<string, GearServiceClock[]>> {
  if (gearItemIds && gearItemIds.length === 0) return new Map();
  const rows = await db
    .select({
      gearItemId: gearServiceEvents.gearItemId,
      kind: gearServiceEvents.kind,
      servicedOn: gearServiceEvents.servicedOn,
      nextDueOn: gearServiceEvents.nextDueOn,
      createdAt: gearServiceEvents.createdAt,
    })
    .from(gearServiceEvents)
    .where(
      and(
        eq(gearServiceEvents.shopId, shopId),
        ne(gearServiceEvents.kind, "note"),
        gearItemIds ? inArray(gearServiceEvents.gearItemId, [...gearItemIds]) : undefined,
      ),
    )
    .orderBy(asc(gearServiceEvents.servicedOn), asc(gearServiceEvents.createdAt));

  const latest = new Map<string, Map<GearServiceKind, GearServiceClock>>();
  for (const row of rows) {
    const clocks = latest.get(row.gearItemId) ?? new Map<GearServiceKind, GearServiceClock>();
    // Rows arrive oldest-first, so the last write per kind is the newest event.
    clocks.set(row.kind, { kind: row.kind, servicedOn: row.servicedOn, nextDueOn: row.nextDueOn });
    latest.set(row.gearItemId, clocks);
  }
  return new Map([...latest].map(([itemId, clocks]) => [itemId, [...clocks.values()]]));
}

export type GearServiceEventRow = {
  id: string;
  kind: GearServiceKind;
  servicedOn: CalendarDate;
  nextDueOn: CalendarDate | null;
  note: string | null;
  recordedByName: string | null;
};

export async function listGearServiceEvents(
  db: AppDb,
  shopId: string,
  gearItemId: string,
): Promise<GearServiceEventRow[]> {
  const rows = await db
    .select({
      id: gearServiceEvents.id,
      kind: gearServiceEvents.kind,
      servicedOn: gearServiceEvents.servicedOn,
      nextDueOn: gearServiceEvents.nextDueOn,
      note: gearServiceEvents.note,
      recordedByName: people.fullName,
    })
    .from(gearServiceEvents)
    .leftJoin(
      people,
      and(eq(people.id, gearServiceEvents.recordedByPersonId), eq(people.shopId, shopId)),
    )
    .where(and(eq(gearServiceEvents.shopId, shopId), eq(gearServiceEvents.gearItemId, gearItemId)))
    .orderBy(desc(gearServiceEvents.servicedOn), desc(gearServiceEvents.createdAt));
  return rows;
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export type ReserveGearUnitOutcome =
  | { ok: true; reservation: GearReservation }
  | {
      ok: false;
      reason:
        | "not_found"
        | "booking_not_found"
        | "invalid_window"
        | "unit_out_of_service"
        | "unit_unavailable";
    };

/**
 * Assign one unit to one booking for an inclusive date window. The
 * double-booking refusal is the database's own: the `gear_reservations_no_overlap`
 * exclusion constraint decides, so two staff racing each other get one
 * reservation and one worded refusal — never two winners
 * (ADR 20260815-minimal-gear-register).
 *
 * `tripId`, when given, pins the booking to that departure: the prep action
 * derives the window from the trip, so a stale tab pairing one trip's dates
 * with another trip's booking must read as no booking at all rather than a
 * reservation on the wrong days (security review, 2026-08-20).
 */
export async function reserveGearUnit(
  db: AppDb,
  input: {
    shopId: string;
    gearItemId: string;
    bookingId: string;
    reservedFrom: string;
    reservedUntil: string;
    tripId?: string;
  },
): Promise<ReserveGearUnitOutcome> {
  const reservedFrom = input.reservedFrom.trim();
  const reservedUntil = input.reservedUntil.trim();
  if (
    !isValidCalendarDate(reservedFrom) ||
    !isValidCalendarDate(reservedUntil) ||
    reservedUntil < reservedFrom
  ) {
    return { ok: false, reason: "invalid_window" };
  }

  try {
    return await db.transaction(async (tx) => {
      const [item] = await tx
        .select({ id: gearItems.id, status: gearItems.status })
        .from(gearItems)
        .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
        .limit(1);
      if (!item) return { ok: false, reason: "not_found" } as const;
      if (item.status !== "in_service")
        return { ok: false, reason: "unit_out_of_service" } as const;

      const [booking] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.shopId, input.shopId),
            input.tripId ? eq(bookings.tripId, input.tripId) : undefined,
          ),
        )
        .limit(1);
      if (!booking) return { ok: false, reason: "booking_not_found" } as const;

      const [reservation] = await tx
        .insert(gearReservations)
        .values({
          shopId: input.shopId,
          gearItemId: input.gearItemId,
          bookingId: input.bookingId,
          reservedFrom,
          reservedUntil,
        })
        .returning();
      if (!reservation) return { ok: false, reason: "unit_unavailable" } as const;
      return { ok: true, reservation } as const;
    });
  } catch (error) {
    if (violatesExclusionConstraint(error, "gear_reservations_no_overlap")) {
      return { ok: false, reason: "unit_unavailable" };
    }
    throw error;
  }
}

export type GearReservationActionOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_returned" | "already_checked_out" };

/**
 * Record the handover — the unit physically left the counter. Conditional on
 * the stamp being empty: `checked_out_at` is the record of *when* it left,
 * and a double-tapped button must not quietly rewrite it (security review,
 * 2026-08-20).
 */
export async function checkOutGearReservation(
  db: AppDb,
  input: { shopId: string; reservationId: string },
): Promise<GearReservationActionOutcome> {
  const [updated] = await db
    .update(gearReservations)
    .set({ checkedOutAt: nowDate() })
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        isNull(gearReservations.returnedAt),
        isNull(gearReservations.checkedOutAt),
      ),
    )
    .returning({ id: gearReservations.id });
  if (updated) return { ok: true };
  const existing = await reservationStamps(db, input);
  if (!existing) return { ok: false, reason: "not_found" };
  return { ok: false, reason: existing.returnedAt ? "already_returned" : "already_checked_out" };
}

/** Close the reservation: the unit is home, the window frees immediately. */
export async function returnGearReservation(
  db: AppDb,
  input: { shopId: string; reservationId: string; note?: string },
): Promise<GearReservationActionOutcome> {
  const [updated] = await db
    .update(gearReservations)
    .set({ returnedAt: nowDate(), returnNote: optional(input.note) })
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        isNull(gearReservations.returnedAt),
      ),
    )
    .returning({ id: gearReservations.id });
  if (updated) return { ok: true };
  return {
    ok: false,
    reason: (await reservationStamps(db, input)) ? "already_returned" : "not_found",
  };
}

/**
 * Un-assign a unit that never left the counter. Once it has been checked out
 * the honest close is a return — releasing an out unit would erase the only
 * record of who has it.
 */
export async function releaseGearReservation(
  db: AppDb,
  input: { shopId: string; reservationId: string },
): Promise<GearReservationActionOutcome> {
  const [deleted] = await db
    .delete(gearReservations)
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        isNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    )
    .returning({ id: gearReservations.id });
  if (deleted) return { ok: true };
  if (!(await reservationStamps(db, input))) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "already_checked_out" };
}

/**
 * A booking that leaves the roster lets go of the units it never collected.
 * Called inside each cancellation transaction beside the capability revoke,
 * for the same reason: a cancelled diver holding the only size-S BCD against
 * the divers who are actually coming is a stale claim nothing would surface
 * (dive-domain review, 2026-08-20). Checked-out units deliberately stay —
 * they are physically with someone, and the register's overdue chase is the
 * honest path home for those.
 */
export async function releaseUnclaimedGearReservations(
  db: DbExecutor,
  input: { shopId: string; bookingId: string },
): Promise<void> {
  await db
    .delete(gearReservations)
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        eq(gearReservations.bookingId, input.bookingId),
        isNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    );
}

async function reservationStamps(
  db: AppDb,
  input: { shopId: string; reservationId: string },
): Promise<{ checkedOutAt: Date | null; returnedAt: Date | null } | null> {
  const [row] = await db
    .select({
      checkedOutAt: gearReservations.checkedOutAt,
      returnedAt: gearReservations.returnedAt,
    })
    .from(gearReservations)
    .where(
      and(eq(gearReservations.id, input.reservationId), eq(gearReservations.shopId, input.shopId)),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Register readers
// ---------------------------------------------------------------------------

/** What the register row says about where a unit is. */
export type GearRowReservation = {
  reservationId: string;
  bookingId: string;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  checkedOutAt: Date | null;
  returnedAt: Date | null;
  personName: string;
  tripTitle: string | null;
};

export type GearRegisterRow = {
  item: GearItem;
  serviceState: GearServiceState;
  reservation: GearRowReservation | null;
};

/**
 * One page of the fleet, each unit carrying its most urgent service clock and
 * the open reservation its row should talk about. Ordered by kind (the pg
 * enum's declaration order matches `GEAR_KIND_ORDER`) then label, so the
 * register reads like the prep list does.
 */
export async function listGearItems(
  db: AppDb,
  shopId: string,
  options: { todayLocal: CalendarDate; kind?: GearItemKind; page?: number; pageSize?: number },
) {
  const filter = and(
    eq(gearItems.shopId, shopId),
    options.kind ? eq(gearItems.kind, options.kind) : undefined,
  );
  const pageSize = options.pageSize ?? 50;

  const page = await offsetPage<GearItem>({
    page: options.page,
    pageSize,
    countRows: async () => {
      const [row] = await db.select({ value: count() }).from(gearItems).where(filter);
      return row?.value ?? 0;
    },
    fetchRows: (offset, limit) =>
      db
        .select()
        .from(gearItems)
        .where(filter)
        .orderBy(asc(gearItems.kind), asc(gearItems.label))
        .offset(offset)
        .limit(limit),
  });

  const itemIds = page.rows.map((item) => item.id);
  const [clocksByItem, openReservations] = await Promise.all([
    latestServiceClocks(db, shopId, itemIds),
    listOpenReservations(db, shopId, itemIds),
  ]);

  const rows: GearRegisterRow[] = page.rows.map((item) => ({
    item,
    serviceState: gearServiceState(clocksByItem.get(item.id) ?? [], options.todayLocal),
    reservation: pickDisplayReservation(openReservations.get(item.id) ?? [], options.todayLocal),
  }));
  return { ...page, rows };
}

async function listOpenReservations(
  db: AppDb,
  shopId: string,
  gearItemIds: readonly string[],
): Promise<Map<string, GearRowReservation[]>> {
  if (gearItemIds.length === 0) return new Map();
  const rows = await db
    .select({
      gearItemId: gearReservations.gearItemId,
      reservationId: gearReservations.id,
      bookingId: gearReservations.bookingId,
      reservedFrom: gearReservations.reservedFrom,
      reservedUntil: gearReservations.reservedUntil,
      checkedOutAt: gearReservations.checkedOutAt,
      returnedAt: gearReservations.returnedAt,
      personName: people.fullName,
      tripTitle: trips.title,
    })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    // The shop condition on the joined person is defense-in-depth: today the
    // reservation writer proves all three rows share a shop, and this keeps a
    // future mismatched row from ever rendering another tenant's name here.
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        inArray(gearReservations.gearItemId, [...gearItemIds]),
        isNull(gearReservations.returnedAt),
      ),
    )
    .orderBy(asc(gearReservations.reservedFrom));

  const byItem = new Map<string, GearRowReservation[]>();
  for (const { gearItemId, ...reservation } of rows) {
    const bucket = byItem.get(gearItemId) ?? [];
    bucket.push(reservation);
    byItem.set(gearItemId, bucket);
  }
  return byItem;
}

/** Fleet size per kind, for the register's filter band. Counts every status. */
export async function countGearItemsByKind(
  db: AppDb,
  shopId: string,
): Promise<Map<GearItemKind, number>> {
  const rows = await db
    .select({ kind: gearItems.kind, value: count() })
    .from(gearItems)
    .where(eq(gearItems.shopId, shopId))
    .groupBy(gearItems.kind);
  return new Map(rows.map((row) => [row.kind, row.value]));
}

export type GearItemDetail = {
  item: GearItem;
  clocks: GearServiceClock[];
  history: GearServiceEventRow[];
  reservations: GearRowReservation[];
};

export async function getGearItemDetail(
  db: AppDb,
  shopId: string,
  gearItemId: string,
): Promise<GearItemDetail | null> {
  const [item] = await db
    .select()
    .from(gearItems)
    .where(and(eq(gearItems.id, gearItemId), eq(gearItems.shopId, shopId)))
    .limit(1);
  if (!item) return null;

  const [clocksByItem, history, reservations] = await Promise.all([
    latestServiceClocks(db, shopId, [gearItemId]),
    listGearServiceEvents(db, shopId, gearItemId),
    listItemReservationHistory(db, shopId, gearItemId),
  ]);
  return {
    item,
    clocks: clocksByItem.get(gearItemId) ?? [],
    history,
    reservations,
  };
}

/** A unit's recent rentals, newest window first — open ones included. */
async function listItemReservationHistory(
  db: AppDb,
  shopId: string,
  gearItemId: string,
): Promise<GearRowReservation[]> {
  const rows = await db
    .select({
      reservationId: gearReservations.id,
      bookingId: gearReservations.bookingId,
      reservedFrom: gearReservations.reservedFrom,
      reservedUntil: gearReservations.reservedUntil,
      checkedOutAt: gearReservations.checkedOutAt,
      returnedAt: gearReservations.returnedAt,
      personName: people.fullName,
      tripTitle: trips.title,
    })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    // The shop condition on the joined person is defense-in-depth: today the
    // reservation writer proves all three rows share a shop, and this keeps a
    // future mismatched row from ever rendering another tenant's name here.
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(gearReservations.shopId, shopId), eq(gearReservations.gearItemId, gearItemId)))
    .orderBy(desc(gearReservations.reservedFrom), desc(gearReservations.createdAt))
    .limit(20);
  return rows;
}

export type AvailableGearUnit = {
  id: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  /**
   * The unit's most urgent clock, so the picker can say "service overdue"
   * in the option itself. Informing at the moment of the decision, never
   * hiding the unit — the dock decides (dive-domain review, 2026-08-20).
   */
  serviceState: GearServiceState;
};

/**
 * Units a staffer could assign for a window: in service, with no open
 * reservation overlapping it, and not physically out the door — a unit
 * checked out and past its window doesn't overlap next weekend, but it is
 * not on the wall either, and offering it packs a boat around an empty peg.
 * One kind, or the whole fleet for a picker that groups. Advisory only —
 * the exclusion constraint is the arbiter, this just keeps the picker honest.
 */
export async function listAvailableGearUnits(
  db: AppDb,
  shopId: string,
  options: {
    from: CalendarDate;
    until: CalendarDate;
    todayLocal: CalendarDate;
    kind?: GearItemKind;
  },
): Promise<AvailableGearUnit[]> {
  const units = await db
    .select({
      id: gearItems.id,
      kind: gearItems.kind,
      label: gearItems.label,
      size: gearItems.size,
    })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        options.kind ? eq(gearItems.kind, options.kind) : undefined,
        eq(gearItems.status, "in_service"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(gearReservations)
            .where(
              and(
                eq(gearReservations.gearItemId, gearItems.id),
                isNull(gearReservations.returnedAt),
                or(
                  // The asked-for window is spoken for…
                  and(
                    lte(gearReservations.reservedFrom, options.until),
                    gte(gearReservations.reservedUntil, options.from),
                  ),
                  // …or the unit is out with a lapsed window and not home yet.
                  // A never-picked-up lapsed reservation deliberately does NOT
                  // block: that unit hangs on the wall, and its stale claim is
                  // the returns panel's to release.
                  and(
                    isNotNull(gearReservations.checkedOutAt),
                    lt(gearReservations.reservedUntil, options.todayLocal),
                  ),
                ),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(gearItems.label));

  const clocksByItem = await latestServiceClocks(
    db,
    shopId,
    units.map((unit) => unit.id),
  );
  return units.map((unit) => ({
    ...unit,
    serviceState: gearServiceState(clocksByItem.get(unit.id) ?? [], options.todayLocal),
  }));
}

export type TripGearAssignment = {
  reservationId: string;
  bookingId: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  checkedOutAt: Date | null;
};

/** Open assignments for one departure's roster, keyed by booking. */
export async function listTripGearAssignments(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<Map<string, TripGearAssignment[]>> {
  const rows = await db
    .select({
      reservationId: gearReservations.id,
      bookingId: gearReservations.bookingId,
      kind: gearItems.kind,
      label: gearItems.label,
      size: gearItems.size,
      reservedFrom: gearReservations.reservedFrom,
      reservedUntil: gearReservations.reservedUntil,
      checkedOutAt: gearReservations.checkedOutAt,
    })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(bookings.tripId, tripId),
        isNull(gearReservations.returnedAt),
      ),
    )
    .orderBy(asc(gearItems.kind), asc(gearItems.label));

  const byBooking = new Map<string, TripGearAssignment[]>();
  for (const row of rows) {
    const bucket = byBooking.get(row.bookingId) ?? [];
    bucket.push(row);
    byBooking.set(row.bookingId, bucket);
  }
  return byBooking;
}

export type GearReturnRow = {
  reservationId: string;
  gearItemId: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  checkedOutAt: Date | null;
  personName: string;
  tripTitle: string | null;
};

/**
 * Open reservations whose window ends today (`dueBackOn`) or has already
 * passed (`overdueAsOf`) — the register's returns panel and the Today queue's
 * gear rows both read these, so the two can never disagree.
 */
export async function listGearDueBack(
  db: AppDb,
  shopId: string,
  dueBackOn: CalendarDate,
): Promise<GearReturnRow[]> {
  return listReturnRows(db, shopId, eq(gearReservations.reservedUntil, dueBackOn));
}

export async function listOverdueGearReservations(
  db: AppDb,
  shopId: string,
  overdueAsOf: CalendarDate,
): Promise<GearReturnRow[]> {
  return listReturnRows(db, shopId, lt(gearReservations.reservedUntil, overdueAsOf));
}

async function listReturnRows(
  db: AppDb,
  shopId: string,
  windowFilter: SQL,
): Promise<GearReturnRow[]> {
  return (
    db
      .select({
        reservationId: gearReservations.id,
        gearItemId: gearReservations.gearItemId,
        kind: gearItems.kind,
        label: gearItems.label,
        size: gearItems.size,
        reservedFrom: gearReservations.reservedFrom,
        reservedUntil: gearReservations.reservedUntil,
        checkedOutAt: gearReservations.checkedOutAt,
        personName: people.fullName,
        tripTitle: trips.title,
      })
      .from(gearReservations)
      .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
      .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
      // The shop condition on the joined person is defense-in-depth: today the
      // reservation writer proves all three rows share a shop, and this keeps a
      // future mismatched row from ever rendering another tenant's name here.
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
      .leftJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(eq(gearReservations.shopId, shopId), isNull(gearReservations.returnedAt), windowFilter),
      )
      .orderBy(asc(gearReservations.reservedUntil), asc(gearItems.label))
  );
}

export type GearServiceDueRow = {
  gearItemId: string;
  kind: GearItemKind;
  label: string;
  state: GearServiceState;
};

/**
 * Working units whose most urgent clock is overdue or runs out within
 * `withinDays`. Retired units keep their history but stop asking for care.
 */
export async function listGearServiceDue(
  db: AppDb,
  shopId: string,
  todayLocal: CalendarDate,
  withinDays: number,
): Promise<GearServiceDueRow[]> {
  const items = await db
    .select({ id: gearItems.id, kind: gearItems.kind, label: gearItems.label })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), ne(gearItems.status, "retired")))
    .orderBy(asc(gearItems.kind), asc(gearItems.label));
  if (items.length === 0) return [];

  const clocksByItem = await latestServiceClocks(
    db,
    shopId,
    items.map((item) => item.id),
  );
  const due: GearServiceDueRow[] = [];
  for (const item of items) {
    const state = gearServiceState(clocksByItem.get(item.id) ?? [], todayLocal);
    if (state.state === "overdue" || (state.state === "due_soon" && state.daysLeft <= withinDays)) {
      due.push({ gearItemId: item.id, kind: item.kind, label: item.label, state });
    }
  }
  due.sort((a, b) => {
    const dueA = a.state.state === "no_clock" ? "" : a.state.nextDueOn;
    const dueB = b.state.state === "no_clock" ? "" : b.state.nextDueOn;
    return dueA.localeCompare(dueB) || a.label.localeCompare(b.label);
  });
  return due;
}
