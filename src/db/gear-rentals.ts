import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import type { GearItemKind } from "@/lib/gear";
import { type GearRentalHolder, groupGearRentals } from "@/lib/gear-rentals";
import type { AppDb } from "./client";
import { type OffsetPage, offsetPage } from "./paging";
import {
  bookingPayments,
  bookings,
  gearItems,
  gearReservations,
  type OrderStatus,
  orders,
  type PaymentStatus,
  people,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **What a rental's money says.** The booking's order when one was raised
 * against it (the billing record of record), otherwise the booking's own
 * payment row — the same order of precedence the diver record's money word
 * reads (`bookingMoneyStatusKey`), so one booking never reads "Paid" on one
 * screen and "Unpaid" on the next. Null when nothing has been raised: nothing
 * is owed until something is, and a counter rental that no order names has no
 * money fact to show.
 */
export type GearRentalMoney =
  | { source: "order"; status: OrderStatus; orderId: string }
  | { source: "payment"; status: PaymentStatus };

/** One open reservation, as the Rentals view reads it. */
export type GearRentalUnit = {
  reservationId: string;
  gearItemId: string;
  label: string;
  kind: GearItemKind;
  size: string | null;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  checkedOutAt: Date | null;
  holderPersonId: string;
  holderName: string;
  bookingId: string | null;
  tripId: string | null;
  tripTitle: string | null;
  tripStartsAt: Date | null;
  money: GearRentalMoney | null;
};

export type GearRentalsPage = OffsetPage<GearRentalHolder<GearRentalUnit>>;

/**
 * **Every open rental the shop has, by holder** — trip rentals and counter
 * rentals in one list (plan `rental-tracking`, layer 2).
 *
 * Open means not yet returned, which takes in the window running today, the
 * lapsed one nobody closed, and every reservation that starts later. The two
 * holder shapes arrive through left joins — a booking's diver, or the person a
 * counter rental names — so neither shape can drop the other's rows the way a
 * booking-only inner join would.
 *
 * Paged by holder rather than by unit, so one diver's set never splits across
 * two pages; the count is the holders the fold makes from the same rows
 * (ADR 20260803-one-pagination-model). The rows are bounded by the shop's live
 * reservations, not by its history, which is what makes reading them whole
 * and paging the fold affordable.
 */
export async function listGearRentals(
  db: AppDb,
  shopId: string,
  options: { todayLocal: CalendarDate; page?: number; pageSize?: number },
): Promise<GearRentalsPage> {
  const units = await listOpenRentalUnits(db, shopId);
  const holders = groupGearRentals(units, options.todayLocal);
  return offsetPage({
    page: options.page,
    pageSize: options.pageSize ?? 20,
    countRows: async () => holders.length,
    fetchRows: async (offset, limit) => holders.slice(offset, offset + limit),
  });
}

/** How many people hold an open rental — the number the register's chip states. */
export async function countGearRentalHolders(db: AppDb, shopId: string): Promise<number> {
  const [row] = await db
    .select({
      value: sql<number>`count(distinct coalesce(${gearReservations.personId}, ${bookings.personId}))::int`,
    })
    .from(gearReservations)
    .innerJoin(
      gearItems,
      and(
        eq(gearItems.id, gearReservations.gearItemId),
        eq(gearItems.shopId, shopId),
        isNull(gearItems.deletedAt),
      ),
    )
    .leftJoin(
      bookings,
      and(eq(bookings.id, gearReservations.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(
      people,
      and(
        eq(people.id, sql`coalesce(${gearReservations.personId}, ${bookings.personId})`),
        eq(people.shopId, shopId),
      ),
    )
    .where(and(eq(gearReservations.shopId, shopId), isNull(gearReservations.returnedAt)));
  return row?.value ?? 0;
}

async function listOpenRentalUnits(db: AppDb, shopId: string): Promise<GearRentalUnit[]> {
  const rows = await db
    .select({
      reservationId: gearReservations.id,
      gearItemId: gearItems.id,
      label: gearItems.label,
      kind: gearItems.kind,
      size: gearItems.size,
      reservedFrom: gearReservations.reservedFrom,
      reservedUntil: gearReservations.reservedUntil,
      checkedOutAt: gearReservations.checkedOutAt,
      holderPersonId: people.id,
      holderName: people.fullName,
      bookingId: bookings.id,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(gearReservations)
    // A deleted unit is off the register and off every list of it.
    .innerJoin(
      gearItems,
      and(
        eq(gearItems.id, gearReservations.gearItemId),
        eq(gearItems.shopId, shopId),
        isNull(gearItems.deletedAt),
      ),
    )
    // Both holder shapes (ADR 20260815-minimal-gear-register, amended
    // 2026-08-25): the booking's diver, or the person a counter rental names.
    // Every joined row carries the shop condition as defense-in-depth, so a
    // mismatched row can never put another tenant's name on this page.
    .leftJoin(
      bookings,
      and(eq(bookings.id, gearReservations.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(
      people,
      and(
        eq(people.id, sql`coalesce(${gearReservations.personId}, ${bookings.personId})`),
        eq(people.shopId, shopId),
      ),
    )
    .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId), liveTrip()))
    .where(and(eq(gearReservations.shopId, shopId), isNull(gearReservations.returnedAt)))
    .orderBy(asc(gearReservations.reservedUntil), asc(gearItems.kind), asc(gearItems.label));

  const bookingIds = [...new Set(rows.flatMap((row) => (row.bookingId ? [row.bookingId] : [])))];
  const money = await moneyByBooking(db, shopId, bookingIds);
  return rows.map((row) => ({
    ...row,
    money: row.bookingId ? (money.get(row.bookingId) ?? null) : null,
  }));
}

/**
 * Each booking's money word, two reads for the whole page rather than two per
 * row: the newest order raised against the booking, else its payment row.
 */
async function moneyByBooking(
  db: AppDb,
  shopId: string,
  bookingIds: readonly string[],
): Promise<Map<string, GearRentalMoney>> {
  const byBooking = new Map<string, GearRentalMoney>();
  if (bookingIds.length === 0) return byBooking;
  const [orderRows, paymentRows] = await Promise.all([
    db
      .select({ id: orders.id, bookingId: orders.bookingId, status: orders.status })
      .from(orders)
      .where(and(eq(orders.shopId, shopId), inArray(orders.bookingId, [...bookingIds])))
      // diveday:allow-time-id-order: it only picks each booking's newest order; the order is never shown
      .orderBy(desc(orders.createdAt), desc(orders.id)),
    db
      .select({ bookingId: bookingPayments.bookingId, status: bookingPayments.status })
      .from(bookingPayments)
      .where(
        and(
          eq(bookingPayments.shopId, shopId),
          inArray(bookingPayments.bookingId, [...bookingIds]),
        ),
      ),
  ]);
  for (const row of orderRows) {
    if (!row.bookingId || byBooking.has(row.bookingId)) continue;
    byBooking.set(row.bookingId, { source: "order", status: row.status, orderId: row.id });
  }
  for (const row of paymentRows) {
    if (byBooking.has(row.bookingId)) continue;
    byBooking.set(row.bookingId, { source: "payment", status: row.status });
  }
  return byBooking;
}
