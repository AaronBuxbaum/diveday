/**
 * **A seat a diver paid for online, as the Money ledger lists it** (fourth UX
 * review, item 18).
 *
 * Online booking payments live on `booking_checkouts`, one Stripe session per
 * party, and `booking_checkout_bookings`, one row per seat it paid for. The
 * Orders ledger and its CSV read `orders` alone, so the shop's main revenue
 * stream was missing from the page titled Money while Reports counted it. This
 * module is the seat half of that ledger: one entry per seat of every
 * completed checkout, on the day the money arrived, with the diver who holds
 * the seat and the departure it is for.
 *
 * **A seat's share is the settlement split by what each seat was asked**, the
 * rule `markCheckoutPaidBySessionId` already uses when it marks each booking
 * paid (src/db/checkouts.ts): `(trip share or the per-diver amount) + gear +
 * pass-through`, over the same sum across the checkout. A refund is recorded
 * against the whole checkout, so it comes off each seat in the same
 * proportion. Rounded per seat, so a party's seats can sum to a cent either
 * side of the charge; the CSV carries the charge itself on the first seat.
 *
 * Shop-scoped on every table it reads, each join on its own `shop_id`.
 */
import { and, eq, gte, ilike, inArray, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import type { ShopOrderFilter } from "./orders";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  courses,
  orders,
  people,
  trips,
} from "./schema";
import { seatBalanceOwedCentsFromJoinedRow } from "./seat-balance";
import { notRehearsal } from "./trips-live";

/** What this seat was asked, the weight its share of the charge is split by. */
export const seatAskedCents = sql<number>`(coalesce(${bookingCheckoutBookings.tripCents}, ${bookingCheckouts.amountPerDiverCents}) + ${bookingCheckoutBookings.gearCents} + ${bookingCheckoutBookings.passThroughCents})`;

/** What every seat of this seat's checkout was asked together. */
const checkoutAskedCents = sql<number>`(select sum(coalesce(seat.trip_cents, ${bookingCheckouts.amountPerDiverCents}) + seat.gear_cents + seat.pass_through_cents) from booking_checkout_bookings seat where seat.checkout_id = ${bookingCheckouts.id})`;

/** What the checkout took: Stripe's settled figure, or the asked total plus its tax. */
const checkoutChargedCents = sql<number>`coalesce(${bookingCheckouts.settledTotalCents}, ${bookingCheckouts.totalCents} + coalesce(${bookingCheckouts.taxCents}, 0))`;

/** `cents` split to this seat by its asked share; zero when the checkout asked nothing. */
function seatShare(cents: SQL): SQL<number> {
  return sql<number>`coalesce(round(${cents} * ${seatAskedCents}::numeric / nullif(${checkoutAskedCents}, 0)), 0)::int`;
}

/** What this seat still holds after refunds: what the ledger's day subtotal adds. */
export const seatNetCents = seatShare(
  sql`(${checkoutChargedCents} - ${bookingCheckouts.refundedCents})`,
);

/**
 * The status word a seat payment reads under, in the orders' own vocabulary
 * so the ledger's status filter means one thing for both: `paid` until money
 * goes back, then `partly_refunded`, then `refunded`. Never `open`, `void` or
 * `uncollectible`: a checkout that did not settle is not money.
 */
export const seatPaymentStatus = sql<
  "paid" | "partly_refunded" | "refunded"
>`case when ${bookingCheckouts.refundedCents} <= 0 then 'paid' when ${bookingCheckouts.refundedCents} >= ${checkoutChargedCents} then 'refunded' else 'partly_refunded' end`;

/**
 * The ledger filter, read for seat payments. The same fields as
 * `shopOrderWhere` and the same meaning: the diver is the seat's, the
 * departure the checkout's, the date the day the money settled. A status no
 * settled payment can have (`open`, `void`, `uncollectible`) matches nothing.
 */
export function seatPaymentWhere(shopId: string, filter: ShopOrderFilter): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    eq(bookingCheckoutBookings.shopId, shopId),
    eq(bookingCheckouts.status, "completed"),
  ];
  if (filter.status) {
    if (filter.status === "paid") conditions.push(sql`${bookingCheckouts.refundedCents} <= 0`);
    else if (filter.status === "partly_refunded" || filter.status === "refunded") {
      conditions.push(sql`${seatPaymentStatus} = ${filter.status}`);
    } else conditions.push(sql`false`);
  }
  if (filter.personId) conditions.push(eq(bookings.personId, filter.personId));
  if (filter.personQuery) conditions.push(ilike(people.fullName, `%${filter.personQuery}%`));
  if (filter.q) {
    conditions.push(
      or(ilike(people.fullName, `%${filter.q}%`), ilike(trips.title, `%${filter.q}%`)),
    );
  }
  if (filter.tripId) conditions.push(eq(bookingCheckouts.tripId, filter.tripId));
  if (filter.from) conditions.push(gte(bookingCheckouts.completedAt, filter.from));
  if (filter.to) conditions.push(lt(bookingCheckouts.completedAt, filter.to));
  return and(...conditions);
}

/**
 * The seat-payment branch of the ledger's union: the columns the order branch
 * selects, in the same order and under the same names (`pagedOrdersByDay`).
 */
export function seatLedgerEntries(db: DbExecutor, shopId: string, filter: ShopOrderFilter) {
  return (
    db
      .select({
        kind: sql<"order" | "seat">`'seat'`.as("kind"),
        id: sql<string>`${bookingCheckoutBookings.id}`.as("id"),
        at: sql<Date>`${bookingCheckouts.completedAt}`.as("at"),
        personName: sql<string>`${people.fullName}`.as("person_name"),
        currency: sql<string>`${bookingCheckouts.currency}`.as("currency"),
        netCents: sql<number>`${seatNetCents}`.as("net_cents"),
      })
      .from(bookingCheckoutBookings)
      .innerJoin(
        bookingCheckouts,
        and(
          eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId),
          eq(bookingCheckouts.shopId, shopId),
        ),
      )
      .innerJoin(
        bookings,
        and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
      )
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
      // diveday:allow-deleted-trips: a payment names the departure it paid for, deleted or not.
      .innerJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
      .where(seatPaymentWhere(shopId, filter))
  );
}

/** One seat a diver paid for online, as a ledger row and an export line read it. */
export type SeatPaymentRow = {
  /** The `booking_checkout_bookings` row: one seat on one checkout. */
  id: string;
  checkoutId: string;
  bookingId: string;
  paidAt: Date;
  currency: string;
  status: "paid" | "partly_refunded" | "refunded";
  /** This seat's share of what the checkout took. */
  amountCents: number;
  /** This seat's share of what went back. */
  refundedCents: number;
  /** This seat's allocated share of the checkout's tax. */
  taxCents: number;
  /** The whole checkout: one Stripe charge, for every seat it paid for. */
  checkout: { chargedCents: number; refundedCents: number; taxCents: number };
  person: { id: string; fullName: string };
  trip: { id: string; title: string; startsAt: Date };
};

const seatPaymentColumns = {
  id: bookingCheckoutBookings.id,
  checkoutId: bookingCheckouts.id,
  bookingId: bookingCheckoutBookings.bookingId,
  paidAt: bookingCheckouts.completedAt,
  currency: bookingCheckouts.currency,
  status: seatPaymentStatus,
  amountCents: seatShare(checkoutChargedCents),
  refundedCents: seatShare(sql`${bookingCheckouts.refundedCents}`),
  taxCents: bookingCheckoutBookings.taxCents,
  chargedCents: checkoutChargedCents,
  checkoutRefundedCents: bookingCheckouts.refundedCents,
  checkoutTaxCents: bookingCheckouts.taxCents,
  personId: people.id,
  personName: people.fullName,
  tripId: trips.id,
  tripTitle: trips.title,
  tripStartsAt: trips.startsAt,
};

function seatPaymentQuery(db: DbExecutor, shopId: string) {
  return (
    db
      .select(seatPaymentColumns)
      .from(bookingCheckoutBookings)
      .innerJoin(
        bookingCheckouts,
        and(
          eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId),
          eq(bookingCheckouts.shopId, shopId),
        ),
      )
      .innerJoin(
        bookings,
        and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
      )
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
      // diveday:allow-deleted-trips: a payment names the departure it paid for, deleted or not.
      .innerJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
      .$dynamic()
  );
}

function toSeatPaymentRow(row: {
  id: string;
  checkoutId: string;
  bookingId: string;
  paidAt: Date | null;
  currency: string;
  status: SeatPaymentRow["status"];
  amountCents: number;
  refundedCents: number;
  taxCents: number;
  chargedCents: number;
  checkoutRefundedCents: number;
  checkoutTaxCents: number | null;
  personId: string;
  personName: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
}): SeatPaymentRow {
  return {
    id: row.id,
    checkoutId: row.checkoutId,
    bookingId: row.bookingId,
    // A completed checkout always carries `completed_at`; the fallback is the
    // trip's own date only so the type holds, never a day a row reads under.
    paidAt: row.paidAt ?? row.tripStartsAt,
    currency: row.currency,
    status: row.status,
    amountCents: Number(row.amountCents),
    refundedCents: Number(row.refundedCents),
    taxCents: row.taxCents,
    checkout: {
      chargedCents: Number(row.chargedCents),
      refundedCents: row.checkoutRefundedCents,
      taxCents: row.checkoutTaxCents ?? 0,
    },
    person: { id: row.personId, fullName: row.personName },
    trip: { id: row.tripId, title: row.tripTitle, startsAt: row.tripStartsAt },
  };
}

/** The ledger page's seat rows, by the ids the union put on it. One query whatever the count. */
export async function seatPaymentsByIds(
  db: DbExecutor,
  shopId: string,
  ids: readonly string[],
): Promise<Map<string, SeatPaymentRow>> {
  const rows = await seatPaymentQuery(db, shopId).where(
    and(
      eq(bookingCheckoutBookings.shopId, shopId),
      eq(bookingCheckouts.status, "completed"),
      inArray(bookingCheckoutBookings.id, [...ids]),
    ),
  );
  return new Map(rows.map((row) => [row.id, toSeatPaymentRow(row)]));
}

/** Every seat payment under the ledger's filter, for "Download orders (CSV)". */
export async function listSeatPaymentsForExport(
  db: DbExecutor,
  shopId: string,
  filter: ShopOrderFilter,
  limit: number,
): Promise<SeatPaymentRow[]> {
  const rows = await seatPaymentQuery(db, shopId)
    .where(seatPaymentWhere(shopId, filter))
    .orderBy(
      sql`${bookingCheckouts.completedAt} desc`,
      sql`${bookingCheckouts.id}`,
      sql`${people.fullName}`,
      sql`${bookingCheckoutBookings.id}`,
    )
    .limit(limit);
  return rows.map(toSeatPaymentRow);
}

/**
 * **Seats that sailed owing money with no order behind them** (fourth UX
 * review, item 23): a diver marked to pay at the shop who boarded and never
 * did, or paid a deposit and never the rest. The Orders ledger cannot show
 * them, since nothing was invoiced, so the owed line counts them beside the
 * open orders.
 *
 * Only departures that have left: a seat on next Saturday's boat owing its
 * fare is the ordinary state of a pay-at-the-shop booking, money due at the
 * dock, not money to chase. An open order on the booking is already counted
 * among the orders, so the seat is not counted twice. A cancelled departure
 * or a cancelled seat owes nothing.
 */
export async function owedSeatsAfterSailing(
  db: DbExecutor,
  shopId: string,
  now: Date,
): Promise<{ count: number; cents: number }> {
  const rows = await db
    .select({
      participantType: bookings.participantType,
      trip: {
        priceCents: trips.priceCents,
        snorkelerPriceCents: trips.snorkelerPriceCents,
        riderPriceCents: trips.riderPriceCents,
      },
      courseTitle: courses.title,
      coursePriceCents: courses.priceCents,
      courseELearningPriceCents: courses.eLearningPriceCents,
      paymentStatus: bookingPayments.status,
      paymentAmountCents: bookingPayments.amountCents,
    })
    .from(bookings)
    // diveday:allow-deleted-trips: a departure with a booking cannot be deleted (`deleteTrip`'s `has_roster`); a rehearsal is left out by `notRehearsal()`.
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId), notRehearsal()))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    .leftJoin(
      orders,
      and(eq(orders.bookingId, bookings.id), eq(orders.shopId, shopId), eq(orders.status, "open")),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.status, ["booked", "checked_in"]),
        ne(trips.status, "cancelled"),
        lt(trips.startsAt, now),
        isNull(orders.id),
        or(
          isNull(bookingPayments.status),
          inArray(bookingPayments.status, ["unpaid", "deposit_paid"]),
        ),
      ),
    );
  let cents = 0;
  let seats = 0;
  for (const row of rows) {
    const owed = seatBalanceOwedCentsFromJoinedRow(row);
    if (owed === null) continue;
    seats += 1;
    cents += owed;
  }
  return { count: seats, cents };
}
