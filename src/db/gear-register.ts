/**
 * Gear: the register page's readers — rows, groups, deleted units and one
 * unit's record. Imported through the `./gear` barrel.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
} from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import {
  type GearItemKind,
  type GearReturnOutcome,
  type GearServiceClock,
  type GearServiceState,
  gearRegisterGroup,
  gearServiceState,
  pickDisplayReservation,
} from "@/lib/gear";
import type { AppDb } from "./client";
import {
  type GearServiceEventRow,
  latestServiceClocks,
  listGearServiceEvents,
} from "./gear-service";
import { liveGearItem, openGearReservation, reservationHolder } from "./gear-shared";
import { type OffsetPage, offsetPage } from "./paging";
import {
  bookings,
  type GearItem,
  gearItems,
  gearReservations,
  people,
  priorGearAssignments,
  trips,
} from "./schema";

/** What the register row says about where a unit is. */
export type GearRowReservation = {
  reservationId: string;
  /**
   * The seat this unit rides on, or null for a **counter rental** — a unit
   * lent to a person who is not on a boat (`src/db/gear-counter-rentals.ts`).
   * The holder's name reads the same either way.
   */
  bookingId: string | null;
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
        openGearReservation(),
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
 * A row's place in the queue, as a sortable key. A unit already off the wall
 * sorts first whatever its clocks say — it is stopped *now*, which outranks
 * anything still running — and everything else sorts by the deadline it is
 * running out of.
 */
export function dueKey(row: GearRegisterRow): string {
  if (row.item.status !== "in_service") return "";
  return row.serviceState.state === "no_clock" ? "9999-12-31" : row.serviceState.nextDueOn;
}

export async function listOpenReservations(
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
      returnOutcome: gearReservations.returnOutcome,
      returnNote: gearReservations.returnNote,
      personName: people.fullName,
      tripTitle: trips.title,
      // The clock an Out row shows on the last day of its window — taken off
      // the trip join this reader already makes (ADR 20260827-the-shops-shelves).
      tripEndsAt: trips.endsAt,
    })
    .from(gearReservations)
    // Both holder shapes: a seat names its diver through the booking, and a
    // counter rental names its person directly (`reservationHolder`).
    .leftJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    // The shop condition on the joined person is defense-in-depth: today the
    // reservation writer proves all three rows share a shop, and this keeps a
    // future mismatched row from ever rendering another tenant's name here.
    .innerJoin(people, and(eq(people.id, reservationHolder()), eq(people.shopId, shopId)))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        inArray(gearReservations.gearItemId, [...gearItemIds]),
        openGearReservation(),
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
      bookingId: gearReservations.bookingId,
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
    .leftJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    // The shop condition on the joined person is defense-in-depth: today the
    // reservation writer proves all three rows share a shop, and this keeps a
    // future mismatched row from ever rendering another tenant's name here.
    .innerJoin(people, and(eq(people.id, reservationHolder()), eq(people.shopId, shopId)))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(gearReservations.gearItemId, gearItemId),
        // A hold let go never became a rental (issue #2258).
        isNull(gearReservations.releasedAt),
      ),
    )
    .orderBy(desc(gearReservations.reservedFrom), desc(gearReservations.createdAt))
    .limit(20);
  return rows;
}
