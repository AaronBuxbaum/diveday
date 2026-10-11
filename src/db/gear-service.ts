/**
 * Gear: service events and the clocks they set. Imported through the `./gear`
 * barrel.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearServiceClock, GearServiceKind } from "@/lib/gear";
import type { AppDb, DbExecutor } from "./client";
import { liveGearItem, optional } from "./gear-shared";
import {
  bookings,
  gearItems,
  gearReservations,
  gearServiceEvents,
  people,
  shops,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

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
  // A transaction too: a work order's "Work done" record writes its checks
  // through here inside its own transaction (ADR 20261008-gear-work-orders).
  db: DbExecutor,
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
      // The app clock, the one `returnedAt` is written from: a same-day
      // service answers a concern only when it was written after the return
      // (`serviceConcernStillOpen`), so the two instants must come off the
      // same clock to be compared.
      createdAt: nowDate(),
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
  db: DbExecutor,
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
 *
 * **A counter rental counts the dives the person said they did** when it came
 * back (`dives_logged`, asked at the return and optional), dated by the first
 * day of its window. One with no number counts nothing — a floor again: a
 * guess at "probably two a day" would run the clock fast.
 */
async function completedDivesByUnit(
  db: DbExecutor,
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
  const counterRows = await db
    .select({
      gearItemId: gearReservations.gearItemId,
      tripDate: gearReservations.reservedFrom,
      plannedDives: sql<number>`${gearReservations.divesLogged}`,
    })
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        inArray(gearReservations.gearItemId, [...gearItemIds]),
        isNull(gearReservations.bookingId),
        isNotNull(gearReservations.returnedAt),
        isNotNull(gearReservations.divesLogged),
      ),
    );

  const byUnit = new Map<string, { tripDate: CalendarDate; plannedDives: number }[]>();
  for (const row of [...rows, ...counterRows]) {
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
