/**
 * **What the roster's Paid mark shows and starts from** (batch 6 item 1), one
 * read per departure: per seat, the amount a hand mark recorded, how it was
 * paid and who marked it, and what the seat still owes — the figure the
 * amount field opens holding, so taking the usual fare is one tap.
 */
import { and, asc, eq, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  heldAfterMark,
  type ManualPaymentMethodCode,
  type PartyShare,
  splitPartyPayment,
} from "@/lib/payment-marks";
import type { AppDb, DbExecutor } from "./client";
import { getBookingPayment, setBookingPayment } from "./payments";
import { bookingPayments, bookings, courses, people, shops, trips } from "./schema";
import { seatBalanceOwedCentsFromJoinedRow } from "./seat-balance";
import { recordShopActivityWithin } from "./shop-activity";
import { tripRosterOrder, tripRosterWhere } from "./trips-roster";

export type PaymentMarkFacts = {
  /** The shop's currency: what an amount typed into the mark is read in. */
  shopCurrency: string;
  /** What the seat still owes, or null when it owes nothing or names no price. */
  balanceOwedCents: number | null;
  /** The last hand mark that recorded money, while it is the seat's current state. */
  mark: {
    amountCents: number;
    currency: string;
    method: ManualPaymentMethodCode;
    /** The staffer who marked it, or null once their record is gone. */
    recordedByName: string | null;
  } | null;
};

/** The staffer who recorded a hand mark: `people` again, beside the seat's own person. */
const markRecorder = alias(people, "payment_mark_recorder");

/** The columns a seat's Paid mark is worked out from, shop-scoped on every table. */
const markColumns = {
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
  paymentCurrency: bookingPayments.currency,
  paymentMethod: bookingPayments.method,
  recordedByName: markRecorder.fullName,
  shopCurrency: shops.currency,
};

type MarkRow = {
  participantType: (typeof bookings.$inferSelect)["participantType"];
  trip: {
    priceCents: number | null;
    snorkelerPriceCents: number | null;
    riderPriceCents: number | null;
  };
  courseTitle: string | null;
  coursePriceCents: number | null;
  courseELearningPriceCents: number | null;
  paymentStatus: (typeof bookingPayments.$inferSelect)["status"] | null;
  paymentAmountCents: number | null;
  paymentCurrency: string | null;
  paymentMethod: ManualPaymentMethodCode | null;
  recordedByName: string | null;
  shopCurrency: string;
};

function markFacts(row: MarkRow): PaymentMarkFacts {
  return {
    shopCurrency: row.shopCurrency,
    balanceOwedCents: seatBalanceOwedCentsFromJoinedRow(row),
    mark:
      row.paymentMethod && row.paymentAmountCents !== null && row.paymentCurrency
        ? {
            amountCents: row.paymentAmountCents,
            currency: row.paymentCurrency,
            method: row.paymentMethod,
            recordedByName: row.recordedByName,
          }
        : null,
  };
}

/**
 * Shop-scoped on every table it touches, like `getOrderBookingContext`, whose
 * price arithmetic this shares (`seatListPriceCents`, `seatBalanceOwedCents`).
 * Called with a departure the page has already resolved for this shop.
 */
export async function paymentMarkFactsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, PaymentMarkFacts>> {
  const rows = await db
    .select({ bookingId: bookings.id, ...markColumns })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    .leftJoin(
      markRecorder,
      and(eq(markRecorder.id, bookingPayments.recordedByPersonId), eq(markRecorder.shopId, shopId)),
    )
    // diveday:allow-deleted-trips: read for a departure the roster page has already resolved.
    .where(and(eq(bookings.tripId, tripId), eq(bookings.shopId, shopId)));
  return new Map(rows.map((row) => [row.bookingId, markFacts(row)]));
}

/**
 * **The roster and its Paid marks in one statement**: `getTripRoster`'s seats,
 * in its order, with what `paymentMarkFactsForTrip` reads joined beside each.
 * The roster page reads both, and a second statement over the same seats was
 * one more query on every departure it opens (`staff-render-cost.test.ts`).
 */
export async function getTripRosterWithPaymentMarks(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ booking: bookings, person: people, ...markColumns })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    .leftJoin(
      markRecorder,
      and(eq(markRecorder.id, bookingPayments.recordedByPersonId), eq(markRecorder.shopId, shopId)),
    )
    // diveday:allow-deleted-trips: read for a departure the roster page has already resolved.
    .where(tripRosterWhere(shopId, tripId))
    .orderBy(...tripRosterOrder);
  return {
    roster: rows.map(({ booking, person }) => ({ booking, person })),
    paymentMarksByBooking: new Map(rows.map((row) => [row.booking.id, markFacts(row)])),
  };
}

export type PartyShareLine = PartyShare & { personName: string };

export type PartySplitRead =
  | { kind: "split"; shares: PartyShareLine[]; unspentCents: number; owedCents: number }
  | { kind: "over"; owedCents: number }
  | { kind: "nothing_owed" }
  | { kind: "refused" }
  | { kind: "not_found" };

type PartyInput = { shopId: string; tripId: string; leadBookingId: string; amountCents: number };

/**
 * The party's seats and the split of one payment across them, read once for
 * both the preview and the write (issue #2605) so what is shown is what the
 * write works out. Shop- and departure-scoped on every read: a lead id from
 * another shop or departure finds no party. `lock` takes the seats' row locks
 * in id order (so two parties' marks cannot wait on each other) and is for the
 * write; the preview reads without it.
 */
async function readPartySplit(
  db: DbExecutor,
  input: PartyInput,
  lock: boolean,
): Promise<
  | (Extract<PartySplitRead, { kind: "split" }> & {
      payments: Map<string, Awaited<ReturnType<typeof getBookingPayment>>>;
    })
  | Exclude<PartySplitRead, { kind: "split" }>
> {
  const query = db
    .select({ id: bookings.id, personName: people.fullName })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
        or(
          eq(bookings.id, input.leadBookingId),
          eq(bookings.partyLeadBookingId, input.leadBookingId),
        ),
      ),
    )
    .orderBy(asc(bookings.id));
  const seats = lock ? await query.for("update", { of: bookings }) : await query;
  const lead = seats.find((seat) => seat.id === input.leadBookingId);
  if (!lead) return { kind: "not_found" };
  // The lead's own seat first, then the party by name (and id, for two of a
  // name), so the same payment always lands the same way.
  const inOrder = [
    lead,
    ...seats
      .filter((seat) => seat.id !== lead.id)
      .sort((a, b) => a.personName.localeCompare(b.personName, "en") || a.id.localeCompare(b.id)),
  ];
  const facts = await paymentMarkFactsForTrip(db, input.shopId, input.tripId);
  const payments = new Map<string, Awaited<ReturnType<typeof getBookingPayment>>>();
  for (const seat of inOrder) {
    payments.set(seat.id, await getBookingPayment(db, input.shopId, seat.id));
  }
  const split = splitPartyPayment(
    input.amountCents,
    inOrder.map((seat) => ({
      bookingId: seat.id,
      owedCents: facts.get(seat.id)?.balanceOwedCents ?? null,
      handMarkRefused: Boolean(payments.get(seat.id)?.provider),
    })),
  );
  if (split.kind === "over") return { kind: "over", owedCents: split.owedCents };
  if (split.kind === "nothing_owed") return { kind: "nothing_owed" };
  if (split.kind === "refused") return { kind: "refused" };
  const names = new Map(inOrder.map((seat) => [seat.id, seat.personName]));
  return {
    kind: "split",
    shares: split.shares.map((share) => ({
      ...share,
      personName: names.get(share.bookingId) ?? "",
    })),
    unspentCents: split.unspentCents,
    owedCents: split.unspentCents + split.shares.reduce((sum, share) => sum + share.amountCents, 0),
    payments,
  };
}

/** The split a party payment would make, without making it: the roster's preview before the confirm. */
export async function previewPartyPayment(
  db: DbExecutor,
  input: PartyInput,
): Promise<PartySplitRead> {
  const read = await readPartySplit(db, input, false);
  if (read.kind !== "split") return read;
  const { payments: _payments, ...split } = read;
  return split;
}

/** `changed`: the party owes something other than what the preview showed (a payment or a cancel landed in between), so nothing was written. */
export type PartyPaidResult = PartySplitRead | { kind: "changed" };

/**
 * **One payment for a whole party** (issue #2605): the lead's seat and every
 * seat that points at it (`partyLeadBookingId`) on one departure, each taking
 * its balance owed first (`splitPartyPayment`), written in one transaction so
 * the party is paid whole or not at all.
 *
 * The split is worked out here, from the database, never from figures the
 * browser sent: the form carries the lead's id, the amount and the method, and
 * nothing about how it divides. Nobody is written off by it, so it needs no
 * more than the right to record money: a payment that runs out leaves a
 * deposit on one seat and the rest owing. A hand mark on a seat paid online or
 * from a package is refused for the whole party, as it is for the seat alone.
 *
 * **Not replay-safe on its own, so the confirm names what it was shown**:
 * `expectedOwedCents` is the party's total owed on the preview. Under the row
 * locks the owed total is read again, and a different figure (a double
 * submit, a second staffer, a seat cancelled meanwhile) writes nothing and
 * answers `changed`, so the staffer previews again. The write is additive, so
 * without this a replayed confirm would take the same cash twice.
 *
 * The activity lines go in the same transaction, one per seat the payment
 * reached: the books and the log agree or neither is written.
 */
export async function markPartyPaid(
  db: AppDb,
  input: PartyInput & {
    method: ManualPaymentMethodCode;
    currency: string;
    recordedByPersonId: string;
    expectedOwedCents: number;
  },
): Promise<PartyPaidResult> {
  return db.transaction(async (tx) => {
    const read = await readPartySplit(tx, input, true);
    if (read.kind === "nothing_owed" && input.expectedOwedCents > 0) return { kind: "changed" };
    if (read.kind !== "split") return read;
    if (read.owedCents !== input.expectedOwedCents) return { kind: "changed" };
    const { payments, ...result } = read;
    for (const share of result.shares) {
      const current = payments.get(share.bookingId) ?? null;
      const status = share.settles ? "paid" : "deposit_paid";
      // A share only ever adds to a deposit taken by hand: the single-seat
      // mark replaces one it is correcting, but a party payment corrects
      // nothing, and replacing here would erase cash the shop already holds.
      const priorDeposit =
        current?.status === "deposit_paid" && current.provider === null
          ? (current.amountCents ?? 0)
          : 0;
      const held =
        status === "paid"
          ? heldAfterMark(current, status, {
              kind: "money",
              amountCents: share.amountCents,
              method: input.method,
            })
          : { amountCents: priorDeposit + share.amountCents, method: input.method };
      const saved = await setBookingPayment(tx, {
        shopId: input.shopId,
        bookingId: share.bookingId,
        status,
        currency: input.currency,
        amountCents: held.amountCents,
        method: held.method,
        recordedByPersonId: input.recordedByPersonId,
      });
      if (!saved) throw new Error("party payment: a locked seat refused its own write");
      await recordShopActivityWithin(tx, {
        shopId: input.shopId,
        actorPersonId: input.recordedByPersonId,
        write: { code: "party_marked_paid", bookingId: share.bookingId },
      });
    }
    return result;
  });
}
