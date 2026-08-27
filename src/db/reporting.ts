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
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  sql,
  sum,
} from "drizzle-orm";
import { canViewShopReports, type Role } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { MonthlyReportInput, ReportTrip } from "@/lib/reporting";
import type { DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  importedPaymentHistory,
  orders,
  people,
  personRoles,
  tips,
  tripAssignments,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";
import { liveTrip } from "./trips-live";

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
/**
 * Payment states that represent money actually collected (a deposit is partial,
 * but real).
 *
 * `partly_refunded` belongs here, and the reason is the whole of why this
 * constant is safe: what is summed is `amount_cents`, and that column holds
 * **what the shop still has**, not what it once charged. A partial refund
 * lowers it by exactly the amount that went back (`applyOrderUpdate`,
 * src/db/orders.ts), so revenue subtracts the refunded money by arithmetic
 * rather than by inferring it from a status word. Leaving the state out
 * instead would have taken the *retained* portion to zero as well — a shop
 * that handed back $30 of a $200 charge would have reported $0 for that seat
 * (issue #699).
 */
const COLLECTED_PAYMENT_STATUSES = ["paid", "deposit_paid", "partly_refunded"] as const;

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
  options: { currency?: string; timeZone?: string } = {},
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
    .where(and(inWindow, liveTrip()))
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
    .where(and(inWindow, liveTrip()))
    .groupBy(trips.id);

  // Money collected on this month's trips. The base is each booking's current
  // payment row, which correctly covers full payments, deposits not yet topped
  // up, full refunds (excluded — the row leaves `COLLECTED_PAYMENT_STATUSES`),
  // partial refunds (counted at what is left, because `amount_cents` is the
  // retained figure), and staff manual marks.
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
    (${bookingCheckouts.amountPerDiverCents} + ${bookingCheckoutBookings.gearCents} + ${bookingCheckoutBookings.passThroughCents})
      * coalesce(${bookingCheckouts.settledTotalCents}, ${bookingCheckouts.totalCents})::numeric
      / nullif(${bookingCheckouts.totalCents}, 0)
  )), 0)`;
  const recoveredPassThroughCents = sql<string>`coalesce(sum(round(
    ${bookingCheckoutBookings.passThroughCents}
      * coalesce(${bookingCheckouts.settledTotalCents}, ${bookingCheckouts.totalCents})::numeric
      / nullif(${bookingCheckouts.totalCents}, 0)
  )), 0)`;
  const [recoveredDeposits] = await db
    .select({
      total: recoveredDepositCents,
      tax: sum(bookingCheckoutBookings.taxCents),
      passThrough: recoveredPassThroughCents,
    })
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

  // Tax for a current booking payment comes from the checkout allocation, but
  // only while that checkout is still the payment row's provider. A later
  // invoice balance replaces the booking payment and has its own tax evidence
  // below; a deposit that it replaced is recovered by the query above.
  const [currentCheckoutTax] = await db
    .select({ total: sum(bookingCheckoutBookings.taxCents) })
    .from(bookingCheckoutBookings)
    .innerJoin(
      bookingCheckouts,
      and(
        eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId),
        eq(bookingCheckouts.shopId, shopId),
        eq(bookingCheckouts.status, "completed"),
      ),
    )
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(
      bookingPayments,
      and(
        eq(bookingPayments.bookingId, bookingCheckoutBookings.bookingId),
        eq(bookingPayments.shopId, shopId),
        eq(bookingPayments.providerRef, bookingCheckouts.stripeSessionId),
      ),
    )
    .where(and(inWindow, inArray(bookingPayments.status, [...COLLECTED_PAYMENT_STATUSES])));

  // The pass-through line is collected with the checkout but is not the
  // shop's revenue. Match it to the current booking payment by Stripe session
  // id so manual payments remain untouched.
  const [currentPassThrough] = await db
    .select({ total: sum(bookingCheckoutBookings.passThroughCents) })
    .from(bookingCheckoutBookings)
    .innerJoin(
      bookingCheckouts,
      and(
        eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId),
        eq(bookingCheckouts.shopId, shopId),
        eq(bookingCheckouts.status, "completed"),
      ),
    )
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(
      bookingPayments,
      and(
        eq(bookingPayments.bookingId, bookingCheckoutBookings.bookingId),
        eq(bookingPayments.shopId, shopId),
        eq(bookingPayments.providerRef, bookingCheckouts.stripeSessionId),
      ),
    )
    .where(and(inWindow, inArray(bookingPayments.status, [...COLLECTED_PAYMENT_STATUSES])));

  // Older/demo data can contain a paid invoice without the booking-payment
  // mirror (the invoice is still the authoritative collected amount). Use it
  // only when no current payment row exists, avoiding double counting the
  // normal webhook/manual-payment path above.
  const [invoiceRevenue] = await db
    .select({
      total: sum(orders.amountPaidCents),
      tax: sum(orders.taxCents),
      passThrough: sum(orders.passThroughCents),
    })
    .from(orders)
    .innerJoin(bookings, and(eq(bookings.id, orders.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        inWindow,
        eq(orders.shopId, shopId),
        // `partly_refunded` as well as `paid`: `amount_paid_cents` is what the
        // shop still holds, so the row's own figure is already net of what
        // went back, and dropping the status entirely would report a
        // part-refunded invoice as no revenue at all rather than as less of
        // it (issue #699).
        inArray(orders.status, ["paid", "partly_refunded"]),
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

  // A paid staff invoice normally mirrors its collected total into
  // `booking_payments`, so the revenue query above deliberately excludes it.
  // Its tax and pass-through allocation still belong in separate report lines,
  // matched by providerRef so an unrelated manual payment on the same booking
  // cannot subtract amounts that were not part of the invoice being reported.
  const [invoiceBookingAmounts] = await db
    .select({ total: sum(orders.taxCents), passThrough: sum(orders.passThroughCents) })
    .from(orders)
    .innerJoin(bookings, and(eq(bookings.id, orders.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(
      bookingPayments,
      and(
        eq(bookingPayments.bookingId, orders.bookingId),
        eq(bookingPayments.shopId, shopId),
        eq(bookingPayments.providerRef, orders.stripeInvoiceId),
      ),
    )
    .where(
      and(
        inWindow,
        eq(orders.shopId, shopId),
        inArray(orders.status, ["paid", "partly_refunded"]),
        gt(orders.amountPaidCents, 0),
      ),
    );

  // Imported source history is not tied to a local trip, so it lives on its
  // own calendar-day timeline rather than pretending an imported booking was a
  // DiveDay departure. It can affect the aggregate only if the import parser
  // named a currency and that currency matches this shop's declared one; other
  // rows remain visible in Orders but are structurally incapable of entering a
  // single-currency report. `direction` is a conservative source classifier,
  // never an order or booking-payment status.
  const importStart = calendarDateInTimezone(startUtc, options.timeZone ?? "UTC");
  const importEnd = calendarDateInTimezone(endUtc, options.timeZone ?? "UTC");
  const [importedFinancialTotals] = await db
    .select({
      payments: sql<string>`coalesce(sum(case when ${importedPaymentHistory.direction} = 'payment' then ${importedPaymentHistory.amountCents} else 0 end), 0)`,
      refunds: sql<string>`coalesce(sum(case when ${importedPaymentHistory.direction} = 'refund' then ${importedPaymentHistory.amountCents} else 0 end), 0)`,
      count: count(importedPaymentHistory.id),
    })
    .from(importedPaymentHistory)
    .where(
      and(
        eq(importedPaymentHistory.shopId, shopId),
        eq(importedPaymentHistory.currency, options.currency ?? "usd"),
        isNotNull(importedPaymentHistory.amountCents),
        inArray(importedPaymentHistory.direction, ["payment", "refund"]),
        gte(importedPaymentHistory.occurredOn, importStart),
        lt(importedPaymentHistory.occurredOn, importEnd),
      ),
    );

  // Post-trip tips settled on this month's trips (PAY-M2). Anchored to the
  // trip's departure like every other figure here, not to when the diver
  // happened to tap the recap link, so a tip left the morning after a June
  // charter belongs to June's boat.
  //
  // Only `paid`: a pending Stripe session is money nobody has, and an expired
  // one is money nobody will get. Tips are a separate flow from the booking
  // payment gate — their own table, their own Stripe session, 100% to the shop
  // (docs ADR 20260726-post-trip-tipping) — so this can never double-count
  // against the revenue sums above, and it is returned as its own figure
  // rather than added into them.
  //
  // Summed without a currency filter, exactly as `booking_payments` is two
  // queries above. `tips.currency` is per-row and a shop can change currency
  // (docs ADR 20260731-shop-currency), so this report is single-currency by
  // assumption throughout — a pre-existing limitation of the whole page, not
  // one tips introduce.
  const [tipTotals] = await db
    .select({ total: sum(tips.amountCents), tipCount: count(tips.id) })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(inWindow, eq(tips.shopId, shopId), eq(tips.status, "paid")));

  const waiverByTrip = new Map(waiverRows.map((row) => [row.tripId, Number(row.waiverComplete)]));

  const reportTrips: ReportTrip[] = tripRows.map((row) => ({
    tripId: row.tripId,
    title: row.title,
    startsAt: row.startsAt,
    capacity: row.capacity,
    activeBookings: Number(row.activeBookings),
    waiverComplete: waiverByTrip.get(row.tripId) ?? 0,
  }));

  const currentRevenueCents =
    Number(baseRevenue?.total ?? 0) +
    Number(recoveredDeposits?.total ?? 0) +
    Number(invoiceRevenue?.total ?? 0);
  const passThroughCents =
    Number(currentPassThrough?.total ?? 0) +
    Number(recoveredDeposits?.passThrough ?? 0) +
    Number(invoiceRevenue?.passThrough ?? 0) +
    Number(invoiceBookingAmounts?.passThrough ?? 0);
  const taxCents =
    Number(currentCheckoutTax?.total ?? 0) +
    Number(recoveredDeposits?.tax ?? 0) +
    Number(invoiceRevenue?.tax ?? 0) +
    Number(invoiceBookingAmounts?.total ?? 0);
  const importedPaymentCents = Number(importedFinancialTotals?.payments ?? 0);
  const importedRefundCents = Number(importedFinancialTotals?.refunds ?? 0);

  return {
    trips: reportTrips,
    revenueCents:
      currentRevenueCents -
      taxCents -
      passThroughCents +
      importedPaymentCents -
      importedRefundCents,
    passThroughCents,
    taxCents,
    importedPaymentCents,
    importedRefundCents,
    importedFinancialRecordCount: Number(importedFinancialTotals?.count ?? 0),
    tipsCents: Number(tipTotals?.total ?? 0),
    tipCount: Number(tipTotals?.tipCount ?? 0),
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
    .where(and(eq(trips.shopId, shopId), ne(trips.status, "cancelled"), liveTrip()))
    .orderBy(asc(trips.startsAt))
    .limit(1);
  return row?.startsAt ?? null;
}

/**
 * The first source-financial day that can affect the report's aggregate. This
 * deliberately follows the same currency/direction/amount gate as
 * `getMonthlyReport`, so the month picker never reaches backwards merely for
 * an ambiguous receipt that the report itself correctly leaves out.
 */
export async function earliestImportedFinancialHistoryDate(
  db: DbExecutor,
  shopId: string,
  currency = "usd",
): Promise<string | null> {
  const [row] = await db
    .select({ occurredOn: importedPaymentHistory.occurredOn })
    .from(importedPaymentHistory)
    .where(
      and(
        eq(importedPaymentHistory.shopId, shopId),
        eq(importedPaymentHistory.currency, currency),
        isNotNull(importedPaymentHistory.amountCents),
        inArray(importedPaymentHistory.direction, ["payment", "refund"]),
      ),
    )
    .orderBy(asc(importedPaymentHistory.occurredOn))
    .limit(1);
  return row?.occurredOn ?? null;
}

/** How many trips the "Trips this month" table shows per page. */
export const REPORT_TRIPS_PAGE_SIZE = PAGE_SIZE.list;

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
      const [counted] = await db
        .select({ total: count() })
        .from(trips)
        .where(and(inWindow, liveTrip()));
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
        .where(and(inWindow, liveTrip()))
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
        .where(and(inArray(trips.id, tripIds), liveTrip()))
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

/**
 * How many crew were assigned to each of these trips — the number only, never
 * a cost. DiveDay does not know what a shop pays anybody, so a thin departure
 * that sailed with a full crew is visible here as a fact about staffing, not
 * an inference about money (issue #700). One batched query rather than one
 * per row, the same shape `courseCrewCountsByTrip` (src/db/today.ts) uses for
 * the identical N+1 reason.
 *
 * `trip_assignments` carries no `shop_id` of its own (CR-007) — proven here by
 * joining through `trips`, filtered to `tripIds`, which the caller has already
 * scoped to this shop's own report window.
 */
export async function crewCountsByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({ tripId: tripAssignments.tripId, crewCount: countDistinct(tripAssignments.personId) })
    .from(tripAssignments)
    .innerJoin(trips, and(eq(trips.id, tripAssignments.tripId), eq(trips.shopId, shopId)))
    .where(inArray(tripAssignments.tripId, tripIds))
    .groupBy(tripAssignments.tripId);
  return new Map(rows.map((row) => [row.tripId, Number(row.crewCount)]));
}
