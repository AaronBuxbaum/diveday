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
  notInArray,
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
  type GearReturnOutcome,
  type GearServiceClock,
  type GearServiceKind,
  type GearServiceState,
  gearRegisterGroup,
  gearServiceIsDue,
  gearServiceState,
  pickDisplayReservation,
  type ReservationWindow,
} from "@/lib/gear";
import {
  SIZED_RENTAL_FIT_COLUMN,
  type SizedRentalKind,
  sizedRentalKindOfGearKind,
} from "@/lib/rentals";
import {
  type AppDb,
  type DbExecutor,
  violatesExclusionConstraint,
  violatesUniqueIndex,
} from "./client";
import { recordDeskEvent } from "./desk-events";
import { type OffsetPage, offsetPage } from "./paging";
import {
  bookings,
  type GearItem,
  type GearReservation,
  gearItemKind,
  gearItems,
  gearReservations,
  gearServiceEvents,
  people,
  priorGearAssignments,
  rentalFitProfiles,
  shops,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

// The lib unions and the pg enums must never drift: both directions are
// compile errors here — a value added to one side without the other fails
// the build, not a migration at 2am.
gearItemKind.enumValues satisfies readonly GearItemKind[];
GEAR_KIND_ORDER satisfies readonly (typeof gearItemKind.enumValues)[number][];

function optional(value: string | undefined) {
  return value?.trim() || null;
}

/**
 * The register's own live-rows filter (ADR 20260820-every-delete-is-soft).
 * Every read that means "the fleet" carries it; the three that deliberately do
 * not are the deleted-units list this page offers Restore from, one unit's own
 * record (`getGearItemDetail`, which reports the state instead of hiding the
 * row), and the export bundle, where a shop takes everything it owns,
 * tombstones included.
 */
const liveGearItem = () => isNull(gearItems.deletedAt);

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
      .where(
        and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId), liveGearItem()),
      )
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
 * Move a unit between in service and needs service. The service note travels
 * with `needs_service` ("inflator sticks") and is cleared on the way back in —
 * a stale complaint on a fixed unit reads as an open one.
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
    .where(
      and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId), liveGearItem()),
    )
    .returning();
  return item ? { ok: true, item } : { ok: false, reason: "not_found" };
}

export type DeleteGearItemOutcome =
  | { ok: true; deleted: GearItem }
  | { ok: false; reason: "not_found" | "reserved" };

/**
 * Take a unit off the register — soft, like every other delete (ADR
 * 20260820-every-delete-is-soft). It stamps `deleted_at` and leaves the row
 * where it is, so the unit's service events and every rental window it ever
 * carried stay attached and a restore is one column write.
 *
 * **Refuses a unit that is still provisioned**, the same call `deleteTrip`
 * makes for a departure with a roster: a unit reserved for a departure still
 * to come, or one out on a rental right now, is somebody's kit for the
 * weekend, and hiding it from the register would leave a diver's assignment
 * pointing at a unit nobody can find. The refusal names nothing here — the
 * surface knows which reservation holds it — and the way out is the same page's
 * Release or Mark returned.
 *
 * A lapsed claim nobody ever collected does **not** block: that unit is on the
 * wall (the same call `listAvailableGearUnits` makes), and its stale row goes
 * quiet with the unit and comes back with it.
 *
 * The guard is checked under a row lock, so a reservation landing mid-delete
 * loses the race rather than being silently hidden with its unit.
 */
export async function deleteGearItem(
  db: AppDb,
  input: {
    shopId: string;
    gearItemId: string;
    todayLocal: CalendarDate;
    deletedByPersonId?: string;
  },
): Promise<DeleteGearItemOutcome> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(gearItems)
      .where(
        and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId), liveGearItem()),
      )
      .limit(1)
      .for("update");
    if (!item) return { ok: false, reason: "not_found" } as const;

    const [held] = await tx
      .select({ value: count() })
      .from(gearReservations)
      .where(
        and(
          eq(gearReservations.shopId, input.shopId),
          eq(gearReservations.gearItemId, input.gearItemId),
          isNull(gearReservations.returnedAt),
          or(
            // Out the door now, whatever its window says…
            isNotNull(gearReservations.checkedOutAt),
            // …or spoken for today or on a day still to come.
            gte(gearReservations.reservedUntil, input.todayLocal),
          ),
        ),
      );
    if ((held?.value ?? 0) > 0) return { ok: false, reason: "reserved" } as const;

    const [deleted] = await tx
      .update(gearItems)
      .set({
        deletedAt: nowDate(),
        deletedByPersonId: input.deletedByPersonId ?? null,
        updatedAt: nowDate(),
      })
      .where(and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId)))
      .returning();
    return deleted
      ? ({ ok: true, deleted } as const)
      : ({ ok: false, reason: "not_found" } as const);
  });
}

export type RestoreGearItemOutcome =
  | { ok: true; item: GearItem }
  | { ok: false; reason: "not_found" | "duplicate_label" };

/**
 * Put a deleted unit back on the register — the undo toast's action, and the
 * deleted list's. The tag freed up when the unit went, so another unit may be
 * wearing it now: the partial unique index refuses that, and so does this,
 * rather than putting two "BCD #14"s on one wall.
 */
export async function restoreGearItem(
  db: AppDb,
  input: { shopId: string; gearItemId: string },
): Promise<RestoreGearItemOutcome> {
  try {
    const [item] = await db
      .update(gearItems)
      .set({ deletedAt: null, deletedByPersonId: null, updatedAt: nowDate() })
      .where(
        and(
          eq(gearItems.id, input.gearItemId),
          eq(gearItems.shopId, input.shopId),
          isNotNull(gearItems.deletedAt),
        ),
      )
      .returning();
    return item ? { ok: true, item } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (violatesUniqueIndex(error, "gear_items_shop_label_unique")) {
      return { ok: false, reason: "duplicate_label" };
    }
    throw error;
  }
}

/** Presence is the register's on-switch: zero rows means no gear UI anywhere. */
export async function countGearItems(db: AppDb, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), liveGearItem()));
  return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Service events
// ---------------------------------------------------------------------------

export type RecordGearServiceOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_found"
        | "invalid_date"
        | "due_not_after_service"
        | "invalid_dives"
        | "dives_need_a_date";
    };

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
    nextDueDives?: number;
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
  // A dive interval with no date beside it is half a clock: `gearServiceState`
  // reads the two together, and "whichever comes first" needs both to compare.
  // Refused rather than silently dropped — a staffer who typed 100 and got
  // nothing would have no way to tell it did not take.
  const nextDueDives = input.nextDueDives;
  if (nextDueDives !== undefined) {
    if (!Number.isInteger(nextDueDives) || nextDueDives <= 0) {
      return { ok: false, reason: "invalid_dives" };
    }
    if (!nextDueOn) return { ok: false, reason: "dives_need_a_date" };
  }

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: gearItems.id, status: gearItems.status })
      .from(gearItems)
      .where(
        and(eq(gearItems.id, input.gearItemId), eq(gearItems.shopId, input.shopId), liveGearItem()),
      )
      .limit(1);
    if (!item) return { ok: false, reason: "not_found" } as const;

    await tx.insert(gearServiceEvents).values({
      shopId: input.shopId,
      gearItemId: input.gearItemId,
      kind: input.kind,
      servicedOn,
      nextDueOn,
      nextDueDives: nextDueDives ?? null,
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
      nextDueDives: gearServiceEvents.nextDueDives,
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
    clocks.set(row.kind, {
      kind: row.kind,
      servicedOn: row.servicedOn,
      nextDueOn: row.nextDueOn,
      nextDueDives: row.nextDueDives,
    });
    latest.set(row.gearItemId, clocks);
  }

  // The dive clock's other half. Only fetched for units that actually carry a
  // dive interval — most shops set none, and this is a join across every
  // completed rental of a unit's life.
  const dualClocked = [...latest]
    .filter(([, clocks]) => [...clocks.values()].some((clock) => clock.nextDueDives))
    .map(([itemId]) => itemId);
  if (dualClocked.length > 0) {
    const dives = await completedDivesByUnit(db, shopId, dualClocked);
    for (const [itemId, clocks] of latest) {
      const record = dives.get(itemId) ?? [];
      for (const clock of clocks.values()) {
        if (!clock.nextDueDives) continue;
        clock.divesSince = record
          .filter((entry) => entry.tripDate >= clock.servicedOn)
          .reduce((total, entry) => total + entry.plannedDives, 0);
      }
    }
  }
  return new Map([...latest].map(([itemId, clocks]) => [itemId, [...clocks.values()]]));
}

/**
 * Every dive a unit is on record for: one entry per rental it came back from,
 * carrying the departure's shop-local date and its planned dive count.
 *
 * **This is the honest floor, and the shape says so.** It counts *returned*
 * reservations — a unit still out has not finished its dives, and one handed
 * over on a handshake was never written down at all — so a shop that keeps its
 * register loosely will see a number below the truth. That is the right way for
 * it to be wrong: a service clock that runs slow tells a shop to service
 * something they already did, where one that ran fast would quietly clear a
 * regulator that is past its interval. Nothing gates on it (`gearServiceState`
 * informs, ADR 20260815-minimal-gear-register); it moves a row into "due soon"
 * on a page a human reads.
 *
 * The trip's date is compared against `serviced_on` as a shop-local calendar
 * date on both sides, so a departure and a service on the same day both count —
 * a boundary a floor can afford.
 */
async function completedDivesByUnit(
  db: AppDb,
  shopId: string,
  gearItemIds: readonly string[],
): Promise<Map<string, { tripDate: CalendarDate; plannedDives: number }[]>> {
  if (gearItemIds.length === 0) return new Map();
  const rows = await db
    .select({
      gearItemId: gearReservations.gearItemId,
      tripDate: sql<CalendarDate>`(${trips.startsAt} at time zone ${shops.timezone})::date::text`,
      plannedDives: trips.plannedDives,
    })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        inArray(gearReservations.gearItemId, [...gearItemIds]),
        isNotNull(gearReservations.returnedAt),
        ne(bookings.status, "cancelled"),
        liveTrip(),
      ),
    );

  const byUnit = new Map<string, { tripDate: CalendarDate; plannedDives: number }[]>();
  for (const row of rows) {
    const bucket = byUnit.get(row.gearItemId) ?? [];
    bucket.push({ tripDate: row.tripDate, plannedDives: row.plannedDives });
    byUnit.set(row.gearItemId, bucket);
  }
  return byUnit;
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
      // Serialize same-unit writers before anything else. Two concurrent
      // inserts both add their tuple and then each waits on the *other's*
      // uncommitted tuple to decide the EXCLUDE check — Postgres breaks that
      // cycle by killing one with a deadlock (40P01) instead of the worded
      // refusal (seen on CI's real-Postgres job, 2026-08-20). Behind this
      // transaction-scoped advisory lock the second writer waits until the
      // first commits, so the constraint only ever judges committed rows and
      // the loser reads back 23P01 → unit_unavailable, as designed. A
      // hashtext collision between two units merely serializes unrelated
      // reservations for a moment — never a wrong outcome.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('gear_reservations'), hashtext(${input.gearItemId}))`,
      );
      const [item] = await tx
        .select({ id: gearItems.id, status: gearItems.status })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.id, input.gearItemId),
            eq(gearItems.shopId, input.shopId),
            liveGearItem(),
          ),
        )
        .limit(1);
      if (!item) return { ok: false, reason: "not_found" } as const;
      if (item.status !== "in_service")
        return { ok: false, reason: "unit_out_of_service" } as const;

      const [booking] = await tx
        .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
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
      // "Ben Okafor has different gear now." on the manifest's catch-up strip
      // — one of the four arrival facts #1187 names. **Which unit is
      // deliberately not in the event**: the strip says the fact, the prep page
      // says the detail, and a size on a boarding list is a detail nobody at
      // the rail is acting on.
      await recordDeskEvent(tx, {
        shopId: input.shopId,
        tripId: booking.tripId,
        kind: "gear_changed",
        bookingId: booking.id,
        subjectPersonId: booking.personId,
      });
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
  | {
      ok: false;
      reason: "not_found" | "already_returned" | "already_checked_out" | "concern_needs_words";
    };

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

/**
 * Close the reservation: the unit is home, the window frees immediately.
 *
 * **The outcome is optional and its absence means "nobody said"** (issue
 * #1186). Two callers close a reservation without asking anyone — a cancelled
 * booking letting go of what it never collected, and the unit page's own quick
 * return — and defaulting those to `all_good` would put a reassuring answer on
 * a set nobody looked at, which is exactly what would make the other two
 * outcomes not worth reading.
 *
 * **A service concern must carry words.** A flag with no note is something a
 * technician cannot act on, and it is the whole of what "only exceptions open
 * additional detail" means: the fast path stays one tap, and the slow one earns
 * its extra field.
 */
export async function returnGearReservation(
  db: AppDb,
  input: {
    shopId: string;
    reservationId: string;
    note?: string;
    outcome?: GearReturnOutcome;
  },
): Promise<GearReservationActionOutcome> {
  const note = optional(input.note);
  if (input.outcome === "service_concern" && !note) {
    return { ok: false, reason: "concern_needs_words" };
  }
  const [updated] = await db
    .update(gearReservations)
    .set({ returnedAt: nowDate(), returnNote: note, returnOutcome: input.outcome ?? null })
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
 * **Hand a whole rental set over in one act** (issue #1185, delight report
 * D25) — the mirror of {@link returnTripGearSet}, and written to look like it.
 *
 * A set is one diver's units on one departure, which is what a counter
 * actually hands across: the diver arrives, takes their armful, and the
 * hand-over is one deliberate act rather than one tap per piece.
 *
 * Conditional on the stamp being empty for the reason
 * {@link checkOutGearReservation} states: `checked_out_at` is the record of
 * *when* the unit left, and a second tap must not rewrite it. A unit already
 * out is therefore left exactly as it was, and a set with nothing left to hand
 * over is `not_found` rather than a silent success.
 */
export async function checkOutTripGearSet(
  db: AppDb,
  input: { shopId: string; bookingId: string },
): Promise<GearReservationActionOutcome> {
  const handedOver = await db
    .update(gearReservations)
    .set({ checkedOutAt: nowDate() })
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        eq(gearReservations.bookingId, input.bookingId),
        isNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    )
    .returning({ id: gearReservations.id });
  return handedOver.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * **Bring a whole rental set home in one act** (issue #1186, delight report
 * D26).
 *
 * A "set" is one diver's units on one departure, which is what a counter
 * actually hands back: somebody walks up with an armful, and asking for an
 * outcome per piece is the paperwork this feature exists to remove. So the
 * outcome is asked once and written to every unit in the set.
 *
 * Nothing is invented for a unit that is not out. Only checked-out,
 * unreturned reservations for this booking are closed, and a set where none
 * are is `not_found` rather than a silent success — a staffer who taps Return
 * on a set somebody else already brought back should be told, not reassured.
 *
 * The service concern's note is required for the same reason it is required on
 * the single-unit path, and refused before anything is written, so a set is
 * never half-closed on a refusal.
 */
export async function returnTripGearSet(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    outcome: GearReturnOutcome;
    note?: string;
  },
): Promise<GearReservationActionOutcome> {
  const note = optional(input.note);
  if (input.outcome === "service_concern" && !note) {
    return { ok: false, reason: "concern_needs_words" };
  }
  const returned = await db
    .update(gearReservations)
    .set({ returnedAt: nowDate(), returnNote: note, returnOutcome: input.outcome })
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        eq(gearReservations.bookingId, input.bookingId),
        isNotNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    )
    .returning({ id: gearReservations.id });
  return returned.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
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
    .returning({ id: gearReservations.id, bookingId: gearReservations.bookingId });
  if (deleted) {
    // The same handoff line the reservation wrote: a unit taken back off a
    // diver is as much a change to what they are carrying as one assigned
    // (#1187). Read after the delete because the row is gone by then and the
    // booking is the only thing left to resolve the departure from — and only
    // when there is one: a bookingless counter rental belongs to no departure
    // and so is nobody's handoff.
    const [booking] = deleted.bookingId
      ? await db
          .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
          .from(bookings)
          .where(and(eq(bookings.id, deleted.bookingId), eq(bookings.shopId, input.shopId)))
          .limit(1)
      : [];
    if (booking) {
      await recordDeskEvent(db, {
        shopId: input.shopId,
        tripId: booking.tripId,
        kind: "gear_changed",
        bookingId: booking.id,
        subjectPersonId: booking.personId,
      });
    }
    return { ok: true };
  }
  const stamps = await reservationStamps(db, input);
  if (!stamps) return { ok: false, reason: "not_found" };
  // A returned row can carry no check-out stamp (marking a unit returned never
  // required one), so the refusal names the state that actually blocks the
  // release rather than defaulting to "checked out".
  return { ok: false, reason: stamps.returnedAt ? "already_returned" : "already_checked_out" };
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

/**
 * The trip-level twin of {@link releaseUnclaimedGearReservations}, for the
 * writers that cancel whole departures while keeping their bookings on the
 * books — the per-date cancel and blow-out (via `setTripStatus`), the
 * minimum-seats sweep, and the two series bulk cancellations. Their bookings
 * survive, so the booking cascade never runs, and without this every unit
 * reserved against the cancelled departure would sit blocked in
 * `listAvailableGearUnits` until someone noticed. Checked-out units
 * deliberately stay: they are physically with a diver, and the return is the
 * honest close.
 */
export async function releaseUnclaimedGearReservationsForTrips(
  db: DbExecutor,
  input: { shopId: string; tripIds: readonly string[] },
): Promise<void> {
  if (input.tripIds.length === 0) return;
  await db.delete(gearReservations).where(
    and(
      eq(gearReservations.shopId, input.shopId),
      isNull(gearReservations.checkedOutAt),
      isNull(gearReservations.returnedAt),
      inArray(
        gearReservations.bookingId,
        db
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(eq(bookings.shopId, input.shopId), inArray(bookings.tripId, [...input.tripIds])),
          ),
      ),
    ),
  );
}

/**
 * Slide a departure's unclaimed gear reservations onto its new dates.
 *
 * A reservation's window is derived from the trip at assign time
 * (`tripReservationWindow`), never re-read, so a departure that moves used to
 * leave every unit spoken for on the old days: the boat left on Thursday with
 * kit the register still believed was out on Tuesday, the units read free for
 * Thursday and could be double-assigned, and Today's due-back and overdue rows
 * — which are window-driven — pointed at the wrong day.
 *
 * **Checked-out units are deliberately left alone.** Their window describes a
 * physical handover that has already happened; the diver has the regulator, and
 * the return is the honest close for it wherever the departure ends up.
 *
 * **A collision releases the loser, and says so.** The new window can overlap
 * another reservation of the same unit — the `gear_reservations_no_overlap`
 * exclusion constraint refuses it, correctly — and the alternatives are worse
 * than releasing: keeping the stale window is the bug this function exists to
 * fix, and refusing the whole move would let one gear assignment veto a schedule
 * edit the crew has already agreed with a customer. So the reservation is
 * released and the count travels back in the move outcome, for the board to say
 * "2 gear assignments released — reassign on prep". Releasing without saying so
 * would be the actual failure: silence there is a unit somebody thinks is packed.
 *
 * Each update runs in its own savepoint. On real Postgres a failed statement
 * aborts the enclosing transaction block, so a plain try/catch would poison the
 * caller's transaction — `moveTrip`'s — for every row after the first collision
 * (the same reasoning as `findOrCreatePerson`).
 */
export async function rewindowTripGearReservations(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; window: ReservationWindow },
): Promise<{ moved: number; released: number }> {
  const open = await tx
    .select({ id: gearReservations.id })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        isNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    )
    .orderBy(asc(gearReservations.id));

  let moved = 0;
  let released = 0;
  // Sequential, never a fan-out: this runs inside `moveTrip`'s transaction,
  // which is one checked-out client (`scripts/check-db-concurrency.mjs`).
  for (const reservation of open) {
    try {
      await tx.transaction(async (sp) => {
        await sp
          .update(gearReservations)
          .set({ reservedFrom: input.window.from, reservedUntil: input.window.until })
          .where(eq(gearReservations.id, reservation.id));
      });
      moved += 1;
    } catch (error) {
      if (!violatesExclusionConstraint(error, "gear_reservations_no_overlap")) throw error;
      await tx.delete(gearReservations).where(eq(gearReservations.id, reservation.id));
      released += 1;
    }
  }
  return { moved, released };
}

/**
 * How many open reservations ride on one departure — the exact set
 * {@link rewindowTripGearReservations} above will try to carry onto new dates,
 * asked with the identical predicate and deliberately kept beside it so the two
 * cannot drift apart unnoticed.
 *
 * A *count*, never an availability check. The schedule builder's move preview
 * uses it to say how much kit travels and that collisions are released; whether
 * a particular unit is free on the new dates is decided by the
 * `gear_reservations_no_overlap` exclusion constraint at commit time, and a
 * read taken while a panel sits open can be stale by then (issue #1203).
 */
export async function countOpenTripGearReservations(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  const [counted] = await db
    .select({ total: count() })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(bookings.tripId, tripId),
        isNull(gearReservations.checkedOutAt),
        isNull(gearReservations.returnedAt),
      ),
    );
  return counted?.total ?? 0;
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
  /**
   * How the set came home, when somebody said (issue #1186). Null on a row
   * closed before this existed and on the paths that close one without asking,
   * and rendered as silence rather than as "all good" — see the column's own
   * note in `schema.ts`.
   */
  returnOutcome: GearReturnOutcome | null;
  /** The words a `service_concern` had to carry, or whatever else was noted. */
  returnNote: string | null;
  personName: string;
  tripTitle: string | null;
  /**
   * When the departure this reservation rides on gets back — the clock time an
   * Out row shows on the day its window closes ("due back today 4:00 PM"), and
   * null for a reservation with no trip behind it, which falls back to date
   * words (ADR 20260827-the-shops-shelves, slice 9d). It is the trip's raw
   * `endsAt`: the standing one-hour late-arrival buffer belongs to *deciding*
   * whether something is overdue, never to the time printed on the row.
   */
  tripEndsAt: Date | null;
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
  options: {
    todayLocal: CalendarDate;
    kind?: GearItemKind;
    page?: number;
    pageSize?: number;
    /**
     * Units already rendered in full above this page — the register's Out and
     * Overdue groups (see {@link gearRegisterGroups}). Excluded from both the
     * rows and the count, so "Page 2 of 3" counts what this list actually
     * holds (ADR 20260803-one-pagination-model).
     */
    excludeItemIds?: readonly string[];
  },
) {
  const excluded = options.excludeItemIds ?? [];
  const filter = and(
    eq(gearItems.shopId, shopId),
    liveGearItem(),
    options.kind ? eq(gearItems.kind, options.kind) : undefined,
    excluded.length > 0 ? notInArray(gearItems.id, [...excluded]) : undefined,
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

  return { ...page, rows: await withRegisterFacts(db, shopId, page.rows, options.todayLocal) };
}

/**
 * The service clock and the open reservation each unit's row talks about —
 * two round trips for a whole list rather than two per row.
 */
async function withRegisterFacts(
  db: AppDb,
  shopId: string,
  items: readonly GearItem[],
  todayLocal: CalendarDate,
): Promise<GearRegisterRow[]> {
  const itemIds = items.map((item) => item.id);
  const [clocksByItem, openReservations] = await Promise.all([
    latestServiceClocks(db, shopId, itemIds),
    listOpenReservations(db, shopId, itemIds),
  ]);
  return items.map((item) => ({
    item,
    serviceState: gearServiceState(clocksByItem.get(item.id) ?? [], todayLocal),
    reservation: pickDisplayReservation(openReservations.get(item.id) ?? [], todayLocal),
  }));
}

/**
 * **The register as three groups** — ADR 20260827-the-shops-shelves, slice 9d.
 *
 * Out and Overdue always render complete. They are bounded by the shop's live
 * reservations rather than by its fleet size, and a register that hides an
 * overdue unit on page 3 is lying about the one thing it exists to say. Only
 * the wall pages, through the reader above and the Pager the rest of the app
 * wears.
 *
 * The SQL predicate below and {@link gearRegisterGroup} agree by construction:
 * a unit has an open window that has already begun exactly when the
 * reservation its row talks about is out or overdue. `pickDisplayReservation`
 * prefers a lapsed window and then the one covering today, so a unit holding
 * both a begun window and a later one can never be filed on the wall — which
 * is what keeps every unit in exactly one group.
 */
export type GearRegisterGroups = {
  /** With a diver, or waiting on the desk to hand it over. Complete. */
  out: GearRegisterRow[];
  /** A lapsed window nobody has closed. Complete. */
  overdue: GearRegisterRow[];
  /** Everything else — one page of it, with its own count. */
  onWall: OffsetPage<GearRegisterRow>;
};

export async function gearRegisterGroups(
  db: AppDb,
  shopId: string,
  options: { todayLocal: CalendarDate; kind?: GearItemKind; page?: number; pageSize?: number },
): Promise<GearRegisterGroups> {
  const claimed = await db
    .select({ id: gearItems.id })
    .from(gearReservations)
    .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        isNull(gearReservations.returnedAt),
        lte(gearReservations.reservedFrom, options.todayLocal),
        liveGearItem(),
      ),
    );
  // One unit can hold several open windows; the register talks about it once.
  const claimedIds = [...new Set(claimed.map((row) => row.id))];

  const [claimedRows, onWall] = await Promise.all([
    claimedIds.length === 0
      ? Promise.resolve<GearRegisterRow[]>([])
      : listClaimedGearRows(db, shopId, claimedIds, options),
    listGearItems(db, shopId, { ...options, excludeItemIds: claimedIds }),
  ]);

  const out: GearRegisterRow[] = [];
  const overdue: GearRegisterRow[] = [];
  for (const row of claimedRows) {
    (gearRegisterGroup(row.reservation, options.todayLocal) === "overdue" ? overdue : out).push(
      row,
    );
  }
  return { out, overdue, onWall };
}

/** The claimed units in full, in the register's own kind-then-label order. */
async function listClaimedGearRows(
  db: AppDb,
  shopId: string,
  itemIds: readonly string[],
  options: { todayLocal: CalendarDate; kind?: GearItemKind },
): Promise<GearRegisterRow[]> {
  const items = await db
    .select()
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        liveGearItem(),
        inArray(gearItems.id, [...itemIds]),
        // The kind chips narrow every group, not just the wall.
        options.kind ? eq(gearItems.kind, options.kind) : undefined,
      ),
    )
    .orderBy(asc(gearItems.kind), asc(gearItems.label));
  return withRegisterFacts(db, shopId, items, options.todayLocal);
}

/**
 * **The fleet-wide answer to "what wants the bench?"** — every live unit the
 * register would say a service sentence about, soonest deadline first,
 * wherever the unit currently is.
 *
 * This is the one reading on the register that no group owns. Out, Overdue and
 * On the wall each fold a fact the retired stat tiles used to duplicate; the
 * service tile duplicated nothing, and deleting it with the other two would
 * have left the register able to answer "what is due for service?" only for
 * the fifty units on the current wall page — while the page's own description
 * still promised the answer. Today's queue keeps the urgent half (six days,
 * `src/db/today.ts`); this keeps the month, which is where a tank's visual
 * inspection and hydro — clocks a fill station enforces — are caught before
 * they strand a boat.
 *
 * Fleet-wide and unpaged on purpose. It is bounded by the work rather than by
 * the fleet, exactly like {@link gearRegisterGroups}' out and overdue lists,
 * and a service run hidden on page 3 is the failure this reader exists to
 * undo. It ignores the kind chips for the same reason the deleted list does:
 * it is its own view of the register, and the chip that opens it states the
 * whole count it will show.
 */
export async function listGearServiceDueRows(
  db: AppDb,
  shopId: string,
  options: { todayLocal: CalendarDate },
): Promise<GearRegisterRow[]> {
  const items = await db
    .select()
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), liveGearItem()))
    .orderBy(asc(gearItems.kind), asc(gearItems.label));
  if (items.length === 0) return [];

  // Clocks over the whole fleet, because the question is a fleet question —
  // but reservations only for the handful that came back due. The register
  // runs this on every request to state the chip's count, and reading every
  // open window to decide a number that does not depend on one would be a
  // query the page pays for and never uses.
  const clocksByItem = await latestServiceClocks(
    db,
    shopId,
    items.map((item) => item.id),
  );
  const due = items
    .map((item) => ({
      item,
      serviceState: gearServiceState(clocksByItem.get(item.id) ?? [], options.todayLocal),
    }))
    .filter((row) => gearServiceIsDue(row.item, row.serviceState));
  if (due.length === 0) return [];

  const openReservations = await listOpenReservations(
    db,
    shopId,
    due.map((row) => row.item.id),
  );
  return due
    .map((row) => ({
      ...row,
      reservation: pickDisplayReservation(
        openReservations.get(row.item.id) ?? [],
        options.todayLocal,
      ),
    }))
    .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.item.label.localeCompare(b.item.label));
}

/**
 * A row's place in the queue, as a sortable key. A unit already off the wall
 * sorts first whatever its clocks say — it is stopped *now*, which outranks
 * anything still running — and everything else sorts by the deadline it is
 * running out of.
 */
function dueKey(row: GearRegisterRow): string {
  if (row.item.status !== "in_service") return "";
  return row.serviceState.state === "no_clock" ? "9999-12-31" : row.serviceState.nextDueOn;
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
      // This reader is intentionally booking-only; the inner join is the shape guard, and `bookings.id` keeps that fact non-null in the type.
      bookingId: bookings.id,
      reservedFrom: gearReservations.reservedFrom,
      reservedUntil: gearReservations.reservedUntil,
      checkedOutAt: gearReservations.checkedOutAt,
      returnedAt: gearReservations.returnedAt,
      returnOutcome: gearReservations.returnOutcome,
      returnNote: gearReservations.returnNote,
      personName: people.fullName,
      tripTitle: trips.title,
      // The clock an Out row shows on the last day of its window — taken off
      // the trip join this reader already makes (ADR 20260827-the-shops-shelves).
      tripEndsAt: trips.endsAt,
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
    .where(and(eq(gearItems.shopId, shopId), liveGearItem()))
    .groupBy(gearItems.kind);
  return new Map(rows.map((row) => [row.kind, row.value]));
}

/** One deleted unit, as the register's Deleted list renders it. */
export type DeletedGearItemRow = {
  id: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  deletedAt: Date;
};

/**
 * The units that have been deleted — the way back to one. Without this the
 * undo lasts as long as a toast and then the unit is unreachable: gone from
 * the fleet, its own URL a 404, and nothing left that can restore it (the
 * same hole the diver roster's Deleted view was added to close).
 */
export async function listDeletedGearItems(
  db: AppDb,
  shopId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const filter = and(eq(gearItems.shopId, shopId), isNotNull(gearItems.deletedAt));
  return offsetPage<DeletedGearItemRow>({
    page: options.page,
    pageSize: options.pageSize ?? 50,
    countRows: async () => {
      const [row] = await db.select({ value: count() }).from(gearItems).where(filter);
      return row?.value ?? 0;
    },
    fetchRows: async (offset, limit) => {
      const rows = await db
        .select({
          id: gearItems.id,
          kind: gearItems.kind,
          label: gearItems.label,
          size: gearItems.size,
          deletedAt: gearItems.deletedAt,
        })
        .from(gearItems)
        .where(filter)
        .orderBy(desc(gearItems.deletedAt), asc(gearItems.label))
        .offset(offset)
        .limit(limit);
      // The filter proves the stamp; this narrows the type without a cast.
      return rows.flatMap((row) => (row.deletedAt ? [{ ...row, deletedAt: row.deletedAt }] : []));
    },
  });
}

/** How many units are deleted — the register's Deleted chip appears on it. */
export async function countDeletedGearItems(db: AppDb, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), isNotNull(gearItems.deletedAt)));
  return row?.value ?? 0;
}

export type GearItemDetail = {
  item: GearItem;
  clocks: GearServiceClock[];
  history: GearServiceEventRow[];
  reservations: GearRowReservation[];
  priorAssignments: Array<{
    id: string;
    assignedFrom: CalendarDate;
    assignedUntil: CalendarDate;
    personName: string;
    statusLabel: string | null;
    note: string | null;
  }>;
};

/**
 * One unit's whole record — **deleted units included**, which is the one read
 * here that deliberately drops `liveGearItem()`.
 *
 * The delete is soft precisely so the service events and the rental windows
 * survive it, and a reader that filtered the row out made that history
 * unreachable: a shop asked when "Reg #4" was last serviced had to restore the
 * unit onto the live register — back into every picker — to read it, then
 * delete it again. The diver roster has answered this the other way since its
 * Deleted view landed, and the two pillars now agree (ADR
 * 20260820-every-delete-is-soft, amended 2026-08-23).
 *
 * This is a *visibility* affordance and nothing more. The row carries its own
 * `deletedAt`, so the surface reports the state and drops every control that
 * writes; every operational read — the fleet, the pickers, the counts, the
 * prep assignments — keeps `liveGearItem()`, and so does every writer.
 */
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

  const [clocksByItem, history, reservations, priorAssignments] = await Promise.all([
    latestServiceClocks(db, shopId, [gearItemId]),
    listGearServiceEvents(db, shopId, gearItemId),
    listItemReservationHistory(db, shopId, gearItemId),
    db
      .select({
        id: priorGearAssignments.id,
        assignedFrom: priorGearAssignments.assignedFrom,
        assignedUntil: priorGearAssignments.assignedUntil,
        personName: people.fullName,
        statusLabel: priorGearAssignments.statusLabel,
        note: priorGearAssignments.note,
      })
      .from(priorGearAssignments)
      .innerJoin(
        people,
        and(eq(people.id, priorGearAssignments.personId), eq(people.shopId, shopId)),
      )
      .where(
        and(
          eq(priorGearAssignments.shopId, shopId),
          eq(priorGearAssignments.gearItemId, gearItemId),
        ),
      )
      .orderBy(desc(priorGearAssignments.assignedFrom), desc(priorGearAssignments.createdAt)),
  ]);
  return {
    item,
    clocks: clocksByItem.get(gearItemId) ?? [],
    history,
    reservations,
    priorAssignments,
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
      // A unit's historical booking row, not a future counter-rental reader.
      bookingId: bookings.id,
      reservedFrom: gearReservations.reservedFrom,
      reservedUntil: gearReservations.reservedUntil,
      checkedOutAt: gearReservations.checkedOutAt,
      returnedAt: gearReservations.returnedAt,
      returnOutcome: gearReservations.returnOutcome,
      returnNote: gearReservations.returnNote,
      personName: people.fullName,
      tripTitle: trips.title,
      tripEndsAt: trips.endsAt,
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
        liveGearItem(),
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
  /** The unit itself, so a caller can ask its service clocks about it. */
  gearItemId: string;
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
      gearItemId: gearItems.id,
      // This is the departure roster's booking-only view.
      bookingId: bookings.id,
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
        liveGearItem(),
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

/** One unit that came home today in a size the diver's fit does not record. */
export type FitAdjustedReturn = {
  reservationId: string;
  personId: string;
  personName: string;
  /** Which fit column the size would be kept in. */
  kind: SizedRentalKind;
  unitLabel: string;
  /** The size that actually went out. Free text, as the shop wrote it. */
  size: string;
  tripTitle: string | null;
  tripEndsAt: Date | null;
  /** What the fit records for this kind today. Null when nothing does. */
  recordedSize: string | null;
};

/**
 * **What the day already taught the shop about a diver's size** (issue #1174,
 * delight report D14).
 *
 * A `fit_adjusted` return is the desk saying, at the counter, that the unit
 * that went out was not the one the fit named — which is exactly D14's
 * "staff-confirmed outcome" and needs no new flag to be readable. This finds
 * the ones where the size genuinely differs from what is on file, so the
 * evening can ask once whether to keep it.
 *
 * **Bounded to the shop's own day**, because the question expires with it: the
 * leftovers trail is keyed by `shop_day`, so a dismissal recorded tonight
 * cannot carry to tomorrow, and a row that reappeared every evening until
 * somebody answered would be the nag this whole surface is against. The
 * `fit_adjusted` outcome stays on the reservation for anyone who wants it
 * later.
 *
 * **Gear stays opt-in by presence** (ADR 20260815-minimal-gear-register): the
 * read starts at `gear_reservations`, so a shop with no fleet produces no rows
 * and no surface anywhere changes. A post-trip prompt appearing for a shop
 * that does not rent gear is the exact trap #1174's triage names.
 */
export async function listFitAdjustedReturns(
  db: AppDb,
  shopId: string,
  returnedWithin: { from: Date; to: Date },
): Promise<FitAdjustedReturn[]> {
  const rows = await db
    .select({
      reservationId: gearReservations.id,
      personId: bookings.personId,
      personName: people.fullName,
      gearKind: gearItems.kind,
      unitLabel: gearItems.label,
      size: gearItems.size,
      tripTitle: trips.title,
      tripEndsAt: trips.endsAt,
      fit: rentalFitProfiles,
    })
    .from(gearReservations)
    .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(
      rentalFitProfiles,
      and(eq(rentalFitProfiles.personId, bookings.personId), eq(rentalFitProfiles.shopId, shopId)),
    )
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(gearReservations.returnOutcome, "fit_adjusted"),
        isNotNull(gearReservations.returnedAt),
        gte(gearReservations.returnedAt, returnedWithin.from),
        lt(gearReservations.returnedAt, returnedWithin.to),
        isNotNull(gearItems.size),
        liveGearItem(),
      ),
    )
    .orderBy(asc(people.fullName), asc(gearItems.label));

  return rows.flatMap((row): FitAdjustedReturn[] => {
    const kind = sizedRentalKindOfGearKind(row.gearKind);
    const size = row.size?.trim();
    if (!kind || !size) return [];
    const recordedSize = row.fit?.[SIZED_RENTAL_FIT_COLUMN[kind]]?.trim() || null;
    // Nothing to ask about when the fit already says what went out. The
    // question is only worth a staffer's evening when the two disagree.
    if (recordedSize === size) return [];
    return [
      {
        reservationId: row.reservationId,
        personId: row.personId,
        personName: row.personName,
        kind,
        unitLabel: row.unitLabel,
        size,
        tripTitle: row.tripTitle,
        tripEndsAt: row.tripEndsAt,
        recordedSize,
      },
    ];
  });
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
        and(
          eq(gearReservations.shopId, shopId),
          isNull(gearReservations.returnedAt),
          liveGearItem(),
          windowFilter,
        ),
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
 * `withinDays`. A deleted unit keeps its history and stops asking for care.
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
    .where(and(eq(gearItems.shopId, shopId), liveGearItem()))
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
