import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  not,
  sql,
  sum,
} from "drizzle-orm";
import { canViewShopReports, type Role } from "@/lib/authz";
import type { MonthlyReportInput, ReportTrip } from "@/lib/reporting";
import type { DbExecutor } from "./client";
import { offsetPage } from "./paging";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  orders,
  people,
  personRoles,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";

/**
 * Owner reporting exposes shop-wide revenue, so it re-checks authorization
 * against the *database* — the signed-in person's live account and role rows —
 * not the roles baked into the JWT at sign-in. A manager demoted, disabled, or
 * deleted mid-session loses the report immediately, closing the same revocation
 * window the export/import surfaces already close (canPersonExportShopData).
 */
export async function canPersonViewShopReports(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [person] = await db
    .select({ id: people.id, deletedAt: people.deletedAt })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  if (!person || person.deletedAt) return false;

  const [account] = await db
    .select({ status: userAccounts.status })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  if (account?.status !== "active") return false;

  const roleRows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, personId));
  return canViewShopReports(roleRows.map((row) => row.role as Role));
}

/** Bookings that still count as "on the boat" — the roster set, not cancellations. */
const ACTIVE_BOOKING_STATUSES = ["booked", "checked_in"] as const;
/** Payment states that represent money actually collected (a deposit is partial, but real). */
const COLLECTED_PAYMENT_STATUSES = ["paid", "deposit_paid"] as const;

/**
 * The month's numbers, anchored to trips that *departed* in `[startUtc, endUtc)`.
 * Returns the raw per-trip rows and the revenue total; all the derived rates
 * live in the pure `summarizeMonth` (src/lib/reporting.ts) so this file stays a
 * thin, timezone-agnostic query — the caller converts the shop-local month into
 * the UTC window with src/lib/zoned.ts.
 *
 * A cancelled trip keeps its departure time, capacity, and bookings (only its
 * `status` flips), so every aggregate here filters it out — the page reports on
 * trips that *sailed*, and a cancelled boat sailed nothing.
 *
 * Separate queries rather than one wide join: mixing a bookings count and a
 * waiver-completed count in a single grouped select double-counts across the
 * join fan-out, and revenue lives on different tables entirely.
 */
export async function getMonthlyReport(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<MonthlyReportInput> {
  const inWindow = and(
    eq(trips.shopId, shopId),
    ne(trips.status, "cancelled"),
    gte(trips.startsAt, startUtc),
    lt(trips.startsAt, endUtc),
  );

  // Trip spine: every trip in the window with its capacity and active-booking
  // count. A left join keeps trips that sailed empty (count 0), which still
  // offered seats and belong in the fill-rate denominator.
  const tripRows = await db
    .select({
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      activeBookings: count(bookings.id),
    })
    .from(trips)
    .leftJoin(
      bookings,
      and(
        eq(bookings.tripId, trips.id),
        eq(bookings.shopId, shopId),
        inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    )
    .where(inWindow)
    .groupBy(trips.id, trips.title, trips.startsAt, trips.capacity);

  // Waiver-complete bookings per trip. A waiver is signed once and then covers
  // every one of that diver's bookings (20260721-waiver-sign-once), so an active
  // booking counts as complete when its *person* holds a current completed,
  // non-superseded release at the shop — matching the boarding gate, not merely a
  // release issued for that exact booking. countDistinct on the booking id so a
  // diver with several signed releases still counts their booking once.
  const waiverRows = await db
    .select({
      tripId: trips.id,
      waiverComplete: countDistinct(bookings.id),
    })
    .from(trips)
    .innerJoin(
      bookings,
      and(
        eq(bookings.tripId, trips.id),
        eq(bookings.shopId, shopId),
        inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    )
    .innerJoin(
      waiverRecords,
      and(
        eq(waiverRecords.personId, bookings.personId),
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.status, "completed"),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .where(inWindow)
    .groupBy(trips.id);

  // Money collected on this month's trips. The base is each booking's current
  // payment row (paid or deposit_paid), which correctly covers full payments,
  // deposits not yet topped up, refunds (excluded), and staff manual marks.
  // `bookings`/`bookingPayments` carry their own (independently-writable)
  // `shop_id` alongside the FK chain to `trips` — every join here is scoped
  // to both, so this never trusts a child row's own shop_id alone (CR-007).
  const [baseRevenue] = await db
    .select({ total: sum(bookingPayments.amountCents) })
    .from(bookingPayments)
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingPayments.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        inWindow,
        eq(bookingPayments.shopId, shopId),
        inArray(bookingPayments.status, [...COLLECTED_PAYMENT_STATUSES]),
      ),
    );

  // The one thing that current-state row loses: when a deposit is later topped
  // up by a balance payment, `setBookingPayment` overwrites the deposit amount
  // with the balance, so the base above drops the deposit. Add it back — this
  // diver's share of every completed *deposit* checkout whose booking has
  // since gone fully `paid`. A booking still `deposit_paid` keeps its deposit in
  // the base and is excluded here, so nothing is double-counted.
  //
  // The share is the money that *settled*, on the same basis as the per-booking
  // payment rows the base sums: this diver's asked amount (deposit + their own
  // gear) scaled by what Stripe actually collected against what was asked
  // (PAY-H1/H2). With no settled figure the checkout's own total stands in, so
  // a historical row still contributes exactly what it did before. Rounded per
  // row rather than largest-remainder — a report tolerates a sub-cent of drift
  // where the payment ledger cannot, and `nullif` keeps a zero-total checkout
  // (nothing to recover) out of the sum instead of dividing by zero.
  const recoveredDepositCents = sql<string>`coalesce(sum(round(
    (${bookingCheckouts.amountPerDiverCents} + ${bookingCheckoutBookings.gearCents})
      * coalesce(${bookingCheckouts.settledTotalCents}, ${bookingCheckouts.totalCents})::numeric
      / nullif(${bookingCheckouts.totalCents}, 0)
  )), 0)`;
  const [recoveredDeposits] = await db
    .select({ total: recoveredDepositCents })
    .from(bookingCheckouts)
    .innerJoin(
      bookingCheckoutBookings,
      and(
        eq(bookingCheckoutBookings.checkoutId, bookingCheckouts.id),
        eq(bookingCheckoutBookings.shopId, shopId),
      ),
    )
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    .where(
      and(
        inWindow,
        eq(bookingCheckouts.shopId, shopId),
        eq(bookingCheckouts.isDeposit, true),
        eq(bookingCheckouts.status, "completed"),
        eq(bookingPayments.status, "paid"),
      ),
    );

  // Older/demo data can contain a paid invoice without the booking-payment
  // mirror (the invoice is still the authoritative collected amount). Use it
  // only when no current payment row exists, avoiding double counting the
  // normal webhook/manual-payment path above.
  const [invoiceRevenue] = await db
    .select({ total: sum(orders.amountPaidCents) })
    .from(orders)
    .innerJoin(bookings, and(eq(bookings.id, orders.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        inWindow,
        eq(orders.shopId, shopId),
        eq(orders.status, "paid"),
        gt(orders.amountPaidCents, 0),
        not(
          exists(
            db
              .select({ id: bookingPayments.id })
              .from(bookingPayments)
              .where(
                and(
                  eq(bookingPayments.bookingId, orders.bookingId),
                  eq(bookingPayments.shopId, shopId),
                ),
              ),
          ),
        ),
      ),
    );

  const waiverByTrip = new Map(waiverRows.map((row) => [row.tripId, Number(row.waiverComplete)]));

  const reportTrips: ReportTrip[] = tripRows.map((row) => ({
    tripId: row.tripId,
    title: row.title,
    startsAt: row.startsAt,
    capacity: row.capacity,
    activeBookings: Number(row.activeBookings),
    waiverComplete: waiverByTrip.get(row.tripId) ?? 0,
  }));

  return {
    trips: reportTrips,
    revenueCents:
      Number(baseRevenue?.total ?? 0) +
      Number(recoveredDeposits?.total ?? 0) +
      Number(invoiceRevenue?.total ?? 0),
  };
}

/**
 * The departure time of this shop's oldest reportable trip, or null when the
 * shop has never scheduled one. The reports page uses it as the floor of its
 * month picker: a shop that opened in March should not be handed a control
 * offering to walk back to 1970, and it is the same bound the page clamps a
 * hand-typed `?month=` against. Cancelled trips are excluded for the reason
 * every other aggregate here excludes them — a cancelled boat sailed nothing,
 * so its month is not a month with data.
 */
export async function earliestReportedTripStart(
  db: DbExecutor,
  shopId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), ne(trips.status, "cancelled")))
    .orderBy(asc(trips.startsAt))
    .limit(1);
  return row?.startsAt ?? null;
}

/** How many trips the "Trips this month" table shows per page. */
export const REPORT_TRIPS_PAGE_SIZE = 20;

export type MonthlyReportTripPage = {
  trips: ReportTrip[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * The month's trips, one page at a time (ordered by departure, then id for a
 * stable tiebreak) — the "Trips this month" table's own display slice.
 * `getMonthlyReport`'s `trips` array stays unbounded on purpose:
 * `summarizeMonth`'s totals (seat fill, waiver completion, at-capacity count)
 * have to see every trip in the month, not just the page a viewer happens to
 * be looking at, so a shop with a busy month costs the table one page, not
 * the headline numbers going quietly wrong.
 *
 * Offset-paged, like every other paged staff list. It was a forward-only
 * keyset cursor with no way back a page and no count to state
 * (ADR 20260803-one-pagination-model).
 */
export async function pagedMonthlyReportTrips(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
  options: { page?: number; limit?: number } = {},
): Promise<MonthlyReportTripPage> {
  const inWindow = and(
    eq(trips.shopId, shopId),
    ne(trips.status, "cancelled"),
    gte(trips.startsAt, startUtc),
    lt(trips.startsAt, endUtc),
  );

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? REPORT_TRIPS_PAGE_SIZE,
    countRows: async () => {
      // Counted off `trips` alone. The row query below groups over a booking
      // join, so counting *its* rows would need a distinct — the window itself
      // is the honest denominator either way.
      const [counted] = await db.select({ total: count() }).from(trips).where(inWindow);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({
          tripId: trips.id,
          title: trips.title,
          startsAt: trips.startsAt,
          capacity: trips.capacity,
          activeBookings: count(bookings.id),
        })
        .from(trips)
        .leftJoin(
          bookings,
          and(
            eq(bookings.tripId, trips.id),
            eq(bookings.shopId, shopId),
            inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
          ),
        )
        .where(inWindow)
        .groupBy(trips.id, trips.title, trips.startsAt, trips.capacity)
        .orderBy(asc(trips.startsAt), asc(trips.id))
        .limit(limit)
        .offset(offset),
  });

  const pageRows = paged.rows;
  const tripIds = pageRows.map((row) => row.tripId);

  const waiverRows = tripIds.length
    ? await db
        .select({
          tripId: trips.id,
          waiverComplete: countDistinct(bookings.id),
        })
        .from(trips)
        .innerJoin(
          bookings,
          and(
            eq(bookings.tripId, trips.id),
            eq(bookings.shopId, shopId),
            inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
          ),
        )
        .innerJoin(
          waiverRecords,
          and(
            eq(waiverRecords.personId, bookings.personId),
            eq(waiverRecords.shopId, shopId),
            eq(waiverRecords.status, "completed"),
            isNull(waiverRecords.supersededAt),
          ),
        )
        .where(inArray(trips.id, tripIds))
        .groupBy(trips.id)
    : [];
  const waiverByTrip = new Map(waiverRows.map((row) => [row.tripId, Number(row.waiverComplete)]));

  const reportTrips: ReportTrip[] = pageRows.map((row) => ({
    tripId: row.tripId,
    title: row.title,
    startsAt: row.startsAt,
    capacity: row.capacity,
    activeBookings: Number(row.activeBookings),
    waiverComplete: waiverByTrip.get(row.tripId) ?? 0,
  }));

  return {
    trips: reportTrips,
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}
