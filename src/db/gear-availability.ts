/**
 * Gear: which units are free to hand out, open service concerns, and what a
 * trip has assigned. Imported through the `./gear` barrel.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import {
  type GearItemKind,
  type GearItemStatus,
  type GearServiceState,
  gearServiceState,
  serviceConcernStillOpen,
} from "@/lib/gear";
import type { AppDb, DbExecutor } from "./client";
import { latestServiceClocks } from "./gear-service";
import { liveGearItem, openGearReservation } from "./gear-shared";
import { bookings, gearItems, gearReservations, gearServiceEvents, shops } from "./schema";

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
  /**
   * It last came home flagged as a service concern, and nobody has written
   * the care that answers it since (`serviceConcernStillOpen`). Said in the
   * picker the way a lapsed clock is; never proposed.
   */
  serviceConcern: boolean;
};

/**
 * The units among these whose last return still stands as a service concern
 * (`serviceConcernStillOpen`). Two reads, and the second only when the first
 * finds a concern at all: the newest closed reservation per unit that came
 * home with an outcome, then the service history of the flagged ones.
 *
 * A return with no outcome is skipped, not read as "all good": the register's
 * quick Return and the unit page's Return close a reservation without anybody
 * saying how the unit came home, and letting that row stand as the last word
 * would wipe the concern the return before it raised (dive-domain review).
 */
export async function openServiceConcerns(
  db: DbExecutor,
  shopId: string,
  units: readonly { id: string; kind: GearItemKind }[],
): Promise<Set<string>> {
  if (units.length === 0) return new Set();
  const lastReturns = await db
    .selectDistinctOn([gearReservations.gearItemId], {
      gearItemId: gearReservations.gearItemId,
      outcome: gearReservations.returnOutcome,
      returnedAt: gearReservations.returnedAt,
    })
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        inArray(
          gearReservations.gearItemId,
          units.map((unit) => unit.id),
        ),
        isNotNull(gearReservations.returnedAt),
        isNotNull(gearReservations.returnOutcome),
      ),
    )
    .orderBy(gearReservations.gearItemId, desc(gearReservations.returnedAt));
  const flagged = lastReturns.filter(
    (row): row is typeof row & { returnedAt: Date } =>
      row.outcome === "service_concern" && row.returnedAt !== null,
  );
  if (flagged.length === 0) return new Set();

  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const events = await db
    .select({
      gearItemId: gearServiceEvents.gearItemId,
      kind: gearServiceEvents.kind,
      servicedOn: gearServiceEvents.servicedOn,
      createdAt: gearServiceEvents.createdAt,
    })
    .from(gearServiceEvents)
    .where(
      and(
        eq(gearServiceEvents.shopId, shopId),
        inArray(
          gearServiceEvents.gearItemId,
          flagged.map((row) => row.gearItemId),
        ),
      ),
    );
  const kindById = new Map(units.map((unit) => [unit.id, unit.kind]));
  const open = new Set<string>();
  for (const row of flagged) {
    const kind = kindById.get(row.gearItemId);
    if (!kind) continue;
    const stillOpen = serviceConcernStillOpen(
      kind,
      {
        outcome: row.outcome,
        returnedOn: calendarDateInTimezone(row.returnedAt, shop?.timezone ?? "UTC"),
        returnedAt: row.returnedAt,
      },
      events.filter((event) => event.gearItemId === row.gearItemId),
    );
    if (stillOpen) open.add(row.gearItemId);
  }
  return open;
}

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
    /**
     * The day the service clocks are read on; today unless said. The counter
     * reads them on the window's last day (`counterRentalServiceVerdicts`).
     */
    serviceAsOf?: CalendarDate;
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
                openGearReservation(),
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

  const [clocksByItem, concerns] = await Promise.all([
    latestServiceClocks(
      db,
      shopId,
      units.map((unit) => unit.id),
    ),
    openServiceConcerns(db, shopId, units),
  ]);
  return units.map((unit) => ({
    ...unit,
    serviceState: gearServiceState(
      clocksByItem.get(unit.id) ?? [],
      options.serviceAsOf ?? options.todayLocal,
    ),
    serviceConcern: concerns.has(unit.id),
  }));
}

/** The kind of each of these units this shop owns and has not deleted. */
export async function gearItemKindsById(
  db: AppDb,
  shopId: string,
  ids: readonly string[],
): Promise<Map<string, GearItemKind>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: gearItems.id, kind: gearItems.kind })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), inArray(gearItems.id, [...ids]), liveGearItem()));
  return new Map(rows.map((row) => [row.id, row.kind]));
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
  /**
   * The unit's own status now, not when it was assigned: a technician can
   * pull an assigned unit off the wall ("Needs service") days before the
   * departure, and the Gear tab must say so on the row that holds it.
   */
  status: GearItemStatus;
  /** What the technician wrote when they pulled it, if anything. */
  serviceNote: string | null;
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
      status: gearItems.status,
      serviceNote: gearItems.serviceNote,
    })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(bookings.tripId, tripId),
        openGearReservation(),
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
