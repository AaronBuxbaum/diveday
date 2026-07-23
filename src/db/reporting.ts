import { and, count, countDistinct, eq, gte, inArray, isNull, lt, ne, sum } from "drizzle-orm";
import { canViewShopReports, type Role } from "@/lib/authz";
import type { MonthlyReportInput, ReportTrip } from "@/lib/reporting";
import type { DbExecutor } from "./client";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
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
      and(eq(bookings.tripId, trips.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])),
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
      and(eq(bookings.tripId, trips.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])),
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
  const [baseRevenue] = await db
    .select({ total: sum(bookingPayments.amountCents) })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(inWindow, inArray(bookingPayments.status, [...COLLECTED_PAYMENT_STATUSES])));

  // The one thing that current-state row loses: when a deposit is later topped
  // up by a balance payment, `setBookingPayment` overwrites the deposit amount
  // with the balance, so the base above drops the deposit. Add it back — the
  // per-diver amount of every completed *deposit* checkout whose booking has
  // since gone fully `paid`. A booking still `deposit_paid` keeps its deposit in
  // the base and is excluded here, so nothing is double-counted.
  const [recoveredDeposits] = await db
    .select({ total: sum(bookingCheckouts.amountPerDiverCents) })
    .from(bookingCheckouts)
    .innerJoin(bookingCheckoutBookings, eq(bookingCheckoutBookings.checkoutId, bookingCheckouts.id))
    .innerJoin(bookings, eq(bookings.id, bookingCheckoutBookings.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .where(
      and(
        inWindow,
        eq(bookingCheckouts.isDeposit, true),
        eq(bookingCheckouts.status, "completed"),
        eq(bookingPayments.status, "paid"),
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
    revenueCents: Number(baseRevenue?.total ?? 0) + Number(recoveredDeposits?.total ?? 0),
  };
}
