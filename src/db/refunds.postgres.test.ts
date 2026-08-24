import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { CheckoutProvider, RefundCheckoutResult } from "@/lib/payments/checkout";
import type { InvoicingProvider, RefundInvoiceResult } from "@/lib/payments/invoicing";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { refundOrder } from "./orders";
import { setBookingPayment } from "./payments";
import { refundBookingOnCancellation, refundBookingOnShopCancellation } from "./refunds";
import { bookings, orders, paymentOperationIntents, people, shops, trips } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

/**
 * The refund lock, under genuine contention (PAY-L3).
 *
 * `refundOrder` opens `claimOrderRefund` with `SELECT ... FOR UPDATE` on the
 * order row and then decides, inside that lock, whether a refund of this order
 * is already in flight. Every other test of that function runs on PGlite, which
 * is single-connection: the lock is never contended there, and deleting the
 * `.for("update")` leaves the whole PGlite suite green. This file is the one
 * place that is not true — the same gap `src/db/bookings.postgres.test.ts`
 * closes for the oversell guard, stated from the money side in
 * `src/db/money-replay.test.ts`.
 *
 * ## What "both reached Stripe" costs
 *
 * Without the lock, two staff taps (two tabs, a double-submitted form, a retry
 * after a slow response) both read `status = 'paid'`, both mint their own
 * intent — and therefore their own distinct `Idempotency-Key`, deliberately, so
 * that two *genuine* refunds of one shared payment intent never collapse into
 * one (PAY-C1) — and both call Stripe. Only Stripe's own over-refund rejection
 * stops the money moving twice. The tests below assert the cheaper, local
 * refusal happens first: exactly one contender reaches the provider, exactly one
 * refund intent exists, and the losers are told `in_progress` rather than
 * `failed`.
 *
 * ## Why the tests hold a gate open
 *
 * Firing two `refundOrder` calls with `Promise.all` and asserting one won proves
 * nothing: the first can commit its claim before the second's `BEGIN`, and the
 * assertion passes for that sequential run exactly as it does for a contended
 * one. So a third connection takes the order row's lock first, the contenders
 * are started, and the test waits until Postgres itself reports them *all*
 * parked on that lock (`waitForLockWaiters`) before releasing it. Only then is
 * the gate dropped, so every tap is inside its transaction at the same instant.
 *
 * ## Which assertion actually catches a missing guard
 *
 * The gate proves *simultaneity*; the **provider call count** proves the guard —
 * the same division `bookings.postgres.test.ts` sets out at length, and worth
 * restating because an earlier draft of this header had it backwards ("with the
 * `FOR UPDATE` gone nothing would ever block, the wait would time out"). It does
 * not. A contender parks on the gate whether or not `claimOrderRefund` locks
 * anything: `startPaymentOperation`'s `INSERT` carries a foreign key to
 * `orders`, and the FK check takes a `KEY SHARE` lock on that order row, which
 * conflicts with the gate's `FOR UPDATE`.
 *
 * Measured, not reasoned about. Deleting the `.for("update")` in
 * `claimOrderRefund` and rerunning this file: `waitForLockWaiters` still passed
 * and both contended tests failed in about a second on the outcome instead —
 * two taps refunded the order twice, and five taps sent Stripe five reversals
 * with five distinct idempotency keys. `expect(invoicing.keys)` is the line that
 * reports it.
 */

/** A shop, a customer, and one paid order with a refundable Stripe invoice. */
async function paidOrder(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Refund Race Divers ${suffix}`,
      slug: `refund-race-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Nora Quinn", email: `nora-${suffix}@example.com` })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  // Inserted directly rather than through `createOrder`: this file is about one
  // transaction's locking behaviour, and the order's provenance is irrelevant
  // to it. `bookingId` is deliberately null so `applyOrderUpdate`'s booking
  // cascade stays out of the picture and the only contended row is the order.
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: person.id,
      createdByPersonId: person.id,
      status: "paid",
      currency: "usd",
      totalCents: 22_000,
      amountPaidCents: 22_000,
      stripeAccountId: "acct_race",
      stripeCustomerId: `cus_${suffix}`,
      stripeInvoiceId: `in_${suffix}`,
    })
    .returning();
  if (!order) throw new Error("order insert returned no row");
  return { shopId: shop.id, orderId: order.id };
}

/** The lock `claimOrderRefund` takes first, held open by the starting gate. */
const orderRowLock = (orderId: string) =>
  sql`select id from orders where id = ${orderId} for update`;

/**
 * A meeting point for `total` taps, opened once that many have **either
 * answered or reached the provider**.
 *
 * This is what makes the multi-tap tests below deterministic instead of nearly
 * deterministic. Their claim is that the losing taps are refused *locally*,
 * with `in_progress`, while the winner is away at Stripe — and in production
 * that is a network round trip of hundreds of milliseconds, so the losers
 * certainly answer inside it. A fake provider that returns on the next
 * microtask does not reproduce that at all: the winner comes straight back and
 * asks for the order row again to write `status = 'refunded'`, and Postgres is
 * free to grant it that lock ahead of losers still queued for their turn. Those
 * losers then read a refunded order and answer `not_paid` — a correct,
 * different refusal that the test is not describing.
 *
 * That is not theoretical. Instrumenting the five-tap test and running the
 * real-Postgres suites fifteen times produced
 * `in_progress, not_paid, not_paid, not_paid, refunded` once, and a full-suite
 * run before that produced two `not_paid`. Both are the same overtake, and
 * neither is a product defect: one Stripe call, one intent, one refunded order
 * every time. The test was asserting a scheduling accident.
 *
 * Counting arrivals from *both* sides is what keeps it honest when the guard is
 * gone. Delete the `.for("update")` in `claimOrderRefund` and all five taps
 * claim, so all five reach the provider — the meeting point still opens, all
 * five reversals go through, and the run fails on `invoicing.keys` having five
 * entries, which is the failure this file exists to produce. A rendezvous that
 * only counted answers would deadlock there and report a timeout instead.
 */
function tapsMeetingAtStripe(total: number): { arrive: () => void; open: Promise<void> } {
  let opened!: () => void;
  const open = new Promise<void>((resolve) => {
    opened = resolve;
  });
  let arrived = 0;
  return {
    arrive: () => {
      arrived += 1;
      if (arrived >= total) opened();
    },
    open,
  };
}

/**
 * An invoicing provider that counts reversals and records the idempotency key
 * of each. Anything that reaches it has already passed the local guard, so the
 * count *is* the number of refunds Stripe was asked for.
 *
 * `atStripe` stands in for the round trip's duration: a tap inside it has
 * committed its claim and cannot answer its caller yet, which is the state the
 * losing taps are supposed to find. Omitted — for the sequential test, where
 * there is no second tap to wait for — the call returns as before.
 */
function countingInvoicing(atStripe?: { arrive: () => void; open: Promise<void> }): {
  provider: InvoicingProvider;
  keys: string[];
} {
  const keys: string[] = [];
  // `refundInvoice` is the only method this path reaches; the rest throw rather
  // than returning a plausible stub, so a call that shouldn't happen fails the
  // test loudly instead of passing quietly.
  const unreachable = () => {
    throw new Error("countingInvoicing: unexpected provider call");
  };
  const provider: InvoicingProvider = {
    createInvoice: unreachable,
    voidInvoice: unreachable,
    retrieveInvoice: unreachable,
    resendInvoice: unreachable,
    async refundInvoice(
      _accountId: string,
      _invoiceId: string,
      idempotencyKey: string,
    ): Promise<RefundInvoiceResult> {
      keys.push(idempotencyKey);
      if (atStripe) {
        atStripe.arrive();
        await atStripe.open;
      }
      return { status: "refunded", refundId: `re_${keys.length}` };
    },
  };
  return { provider, keys };
}

async function refundIntentCount(db: AppDb, orderId: string): Promise<number> {
  const rows = await db
    .select({ id: paymentOperationIntents.id })
    .from(paymentOperationIntents)
    .where(eq(paymentOperationIntents.orderId, orderId));
  return rows.length;
}

describePostgres("refundOrder under real concurrency", () => {
  it("lets exactly one of two simultaneous refunds reach Stripe", async () => {
    const pg = await postgresTestDb();
    const { shopId, orderId } = await paidOrder(pg.db);
    const atStripe = tapsMeetingAtStripe(2);
    const invoicing = countingInvoicing(atStripe);

    const gate = await holdRowLock(pg, orderRowLock(orderId));
    // Two genuinely separate connections, so these are two Postgres backends —
    // not two awaits interleaved on one. The winner is held at the provider
    // until the loser has answered, so what is asserted below is the refusal
    // that happens *during* the Stripe call rather than one that depends on
    // which of the two next reached the order row (see `tapsMeetingAtStripe`).
    const first = refundOrder(pg.connect(), shopId, orderId, invoicing.provider).finally(
      atStripe.arrive,
    );
    const second = refundOrder(pg.connect(), shopId, orderId, invoicing.provider).finally(
      atStripe.arrive,
    );

    // Both are now inside `claimOrderRefund`'s transaction and blocked on the
    // order row, so dropping the gate starts them together. This establishes the
    // race; it is not what detects a missing guard (see the header).
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "refunded")).toHaveLength(1);
    // Refused *locally*, and told so — not `failed`, which would send staff
    // back to press the button a third time.
    expect(outcomes.filter((outcome) => outcome.status !== "refunded")).toEqual([
      { status: "in_progress" },
    ]);
    // The refusal is not the point on its own — the money is. A second
    // reversal shows up here as 2 even if the loser was told `in_progress`.
    expect(invoicing.keys).toHaveLength(1);
    expect(await refundIntentCount(pg.db, orderId)).toBe(1);
  });

  it("refuses four of five simultaneous taps and asks Stripe once", async () => {
    // Past a single pair, where a guard that lets one extra through stops being
    // invisible: five contenders would otherwise be five reversals of one
    // charge, each with its own distinct idempotency key, so Stripe's own
    // replay protection cannot collapse them either.
    const pg = await postgresTestDb();
    const { shopId, orderId } = await paidOrder(pg.db);
    const atStripe = tapsMeetingAtStripe(5);
    const invoicing = countingInvoicing(atStripe);

    const gate = await holdRowLock(pg, orderRowLock(orderId));
    const contenders = [0, 1, 2, 3, 4].map(() =>
      refundOrder(pg.connect(), shopId, orderId, invoicing.provider).finally(atStripe.arrive),
    );

    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.status === "refunded")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "in_progress")).toHaveLength(4);
    expect(invoicing.keys).toHaveLength(1);
    expect(await refundIntentCount(pg.db, orderId)).toBe(1);

    const [row] = await pg.db.select().from(orders).where(eq(orders.id, orderId));
    expect(row).toMatchObject({ status: "refunded", amountPaidCents: 0 });
  });

  it("refuses a second refund of an order the first already settled", async () => {
    // The sequential half, under a real server rather than PGlite: once the
    // winner's `refunded` status is committed, the plain status read turns the
    // next attempt away with `not_paid` and Stripe is never asked again.
    const pg = await postgresTestDb();
    const { shopId, orderId } = await paidOrder(pg.db);
    const invoicing = countingInvoicing();

    expect((await refundOrder(pg.db, shopId, orderId, invoicing.provider)).status).toBe("refunded");
    expect(await refundOrder(pg.db, shopId, orderId, invoicing.provider)).toEqual({
      status: "not_paid",
    });
    expect(invoicing.keys).toHaveLength(1);
  });
});

/**
 * The **booking**-level refund lock, under the same genuine contention (issue
 * #950).
 *
 * `refundBookingOnCancellation` and `refundBookingOnShopCancellation` used to
 * read a seat's retained balance with a plain `getBookingPayment`, mint an
 * intent — and therefore a distinct `Idempotency-Key` — and call Stripe, with
 * no lock held across the three. Two concurrent cancellations of one seat both
 * passed the balance read and presented Stripe two different keys, and Stripe
 * accepts both while the underlying charge still has capacity.
 *
 * On a **shared party checkout** it always does: one payment intent covers
 * several seats, so a per-seat reversal never exhausts it. That is what removes
 * Stripe's own over-refund rejection as the backstop, and it is why these tests
 * seat a party of two on one `providerRef` — one seat refunded twice comes out
 * of the other seat's fare, and the other seat still reads `paid`.
 *
 * Same machinery and the same division of labour as the order suite above: the
 * gate proves the taps are genuinely simultaneous, and `checkout.calls` proves
 * the guard. `claimBookingRefund` locks the **bookings** row (not
 * `booking_payments`, which may not exist — `withBookingPaymentLock`'s reason),
 * so that is the row the gate holds.
 */

/** A connected shop, a party of two on one Stripe charge, both seats paid. */
async function paidPartyOfTwo(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Party Refund Divers ${suffix}`,
      slug: `party-refund-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  await upsertShopStripeAccount(db, shop.id, `acct_${suffix}`);
  await setShopStripeAccountStatus(db, `acct_${suffix}`, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });

  // Far enough out that the stated cancellation window is still open, so the
  // diver-cancel path reaches Stripe rather than answering `forfeit`.
  const startsAt = new Date(nowMs() + 30 * 24 * 60 * 60 * 1000);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      priceCents: 18_000,
      cancellationWindowHours: 48,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");

  const bookingIds: string[] = [];
  for (const name of ["Pat Party", "Sam Second"]) {
    const [person] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: name,
        email: `${name.split(" ")[0]?.toLowerCase()}-${suffix}@example.com`,
      })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    // One `providerRef` across both seats: this *is* the shared party checkout,
    // and the reason a second reversal of one seat is not caught by Stripe.
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: booking.id,
      status: "paid",
      amountCents: 18_000,
      currency: "usd",
      provider: "stripe",
      providerRef: `cs_${suffix}`,
      operation: "checkout_settled",
    });
    bookingIds.push(booking.id);
  }
  const [bookingId, otherBookingId] = bookingIds;
  if (!bookingId || !otherBookingId) throw new Error("expected a party of two");
  return { shopId: shop.id, bookingId, otherBookingId, startsAt };
}

/** The lock `claimBookingRefund` takes first, held open by the starting gate. */
const bookingRowLock = (bookingId: string) =>
  sql`select id from bookings where id = ${bookingId} for update`;

/**
 * A checkout provider that counts reversals and records each idempotency key.
 * The booking-side twin of {@link countingInvoicing}; `atStripe` plays the same
 * role, holding the winner inside its round trip until every tap has answered
 * or arrived, so the losers' refusals are the ones this file describes rather
 * than a scheduling accident.
 */
function countingCheckout(atStripe?: { arrive: () => void; open: Promise<void> }): {
  provider: CheckoutProvider;
  keys: string[];
} {
  const keys: string[] = [];
  const unreachable = () => {
    throw new Error("countingCheckout: unexpected provider call");
  };
  const provider: CheckoutProvider = {
    createCheckoutSession: unreachable,
    retrieveCheckoutSession: unreachable,
    async refundCheckoutSession(
      _accountId: string,
      _sessionId: string,
      idempotencyKey: string,
    ): Promise<RefundCheckoutResult> {
      keys.push(idempotencyKey);
      if (atStripe) {
        atStripe.arrive();
        await atStripe.open;
      }
      return { status: "refunded", refundId: `re_${keys.length}` };
    },
  };
  return { provider, keys };
}

async function bookingRefundIntentCount(db: AppDb, bookingId: string): Promise<number> {
  const rows = await db
    .select({ id: paymentOperationIntents.id })
    .from(paymentOperationIntents)
    .where(eq(paymentOperationIntents.bookingId, bookingId));
  return rows.length;
}

describePostgres("booking refunds under real concurrency", () => {
  it("lets exactly one of two simultaneous shop-cancellation refunds reach Stripe", async () => {
    const pg = await postgresTestDb();
    const { shopId, bookingId } = await paidPartyOfTwo(pg.db);
    const atStripe = tapsMeetingAtStripe(2);
    const checkout = countingCheckout(atStripe);

    const gate = await holdRowLock(pg, bookingRowLock(bookingId));
    // Two genuinely separate connections — a resumed blow-out cascade racing
    // the minimum-seats sweep is exactly this shape, and both are retry loops.
    const first = refundBookingOnShopCancellation(
      pg.connect(),
      { shopId, bookingId },
      checkout.provider,
    ).finally(atStripe.arrive);
    const second = refundBookingOnShopCancellation(
      pg.connect(),
      { shopId, bookingId },
      checkout.provider,
    ).finally(atStripe.arrive);

    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "refunded")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status !== "refunded")).toEqual([
      { status: "in_progress" },
    ]);
    // The money, not the wording: a second reversal shows up here as 2 even
    // when the loser was politely told `in_progress`.
    expect(checkout.keys).toHaveLength(1);
    expect(await bookingRefundIntentCount(pg.db, bookingId)).toBe(1);
  });

  it("refuses four of five simultaneous diver cancellations and asks Stripe once", async () => {
    const pg = await postgresTestDb();
    const { shopId, bookingId, startsAt } = await paidPartyOfTwo(pg.db);
    const atStripe = tapsMeetingAtStripe(5);
    const checkout = countingCheckout(atStripe);
    const insideWindow = new Date(startsAt.getTime() - 72 * 60 * 60 * 1000);

    const gate = await holdRowLock(pg, bookingRowLock(bookingId));
    const contenders = [0, 1, 2, 3, 4].map(() =>
      refundBookingOnCancellation(
        pg.connect(),
        { shopId, bookingId, now: insideWindow },
        checkout.provider,
      ).finally(atStripe.arrive),
    );

    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.status === "refunded")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "in_progress")).toHaveLength(4);
    expect(checkout.keys).toHaveLength(1);
    expect(await bookingRefundIntentCount(pg.db, bookingId)).toBe(1);
  });

  it("never blocks a second seat on the same charge", async () => {
    // The guard is per booking, deliberately. Two party members cancelling at
    // once are two *genuine* refunds off one payment intent (PAY-C1), and a
    // lock that collapsed them into one would be its own money bug.
    const pg = await postgresTestDb();
    const { shopId, bookingId, otherBookingId } = await paidPartyOfTwo(pg.db);
    const atStripe = tapsMeetingAtStripe(2);
    const checkout = countingCheckout(atStripe);

    const outcomes = await Promise.all([
      refundBookingOnShopCancellation(
        pg.connect(),
        { shopId, bookingId },
        checkout.provider,
      ).finally(atStripe.arrive),
      refundBookingOnShopCancellation(
        pg.connect(),
        { shopId, bookingId: otherBookingId },
        checkout.provider,
      ).finally(atStripe.arrive),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["refunded", "refunded"]);
    // Two distinct keys, so Stripe treats them as the two separate reversals
    // they are rather than collapsing the second onto the first.
    expect(new Set(checkout.keys).size).toBe(2);
  });
});
