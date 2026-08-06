import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { setBookingPayment } from "./payments";
import { bookingPaymentEvents, bookingPayments, shops, trips } from "./schema";

/**
 * `withBookingPaymentLock`, under genuine contention.
 *
 * Every write to a booking's payment row funnels through that one helper, which
 * locks the always-present `bookings` row `FOR UPDATE` so a staff waive/refund
 * and a provider-webhook cascade landing at the same instant serialize instead
 * of interleaving (CR-004, and the security review that found the original fix
 * locked a row that usually does not exist yet). Like the oversell guard next
 * door, that lock has never been contended by a test: PGlite is
 * single-connection, so `src/db/payments.test.ts` and `src/db/money-replay.test.ts`
 * can only replay these interleavings *sequentially* — which money-replay.test.ts
 * says in its own header.
 *
 * ## What is asserted, and why it is the trail rather than the final status
 *
 * With two writes racing, either final status is legitimate — whichever
 * committed last is the truth, and the product has no preference. What is *not*
 * legitimate is two events both claiming to have followed the same previous
 * status. `booking_payment_events` is append-only evidence of how the money
 * moved (DATA-M3, ADR 20260803-booking-payment-events); a fork in that chain is
 * a trail that cannot be reconstructed, and it is exactly what an unserialized
 * read-then-write produces. So the assertion is that the recorded history forms
 * a single chain, each event's `previous_status` being the one before it.
 *
 * That chain assertion is also what fails when the lock goes away, and it was
 * measured rather than assumed: deleting the `.for("update")` in
 * `withBookingPaymentLock` and rerunning this file leaves `waitForLockWaiters`
 * passing — a write's `INSERT` takes an FK `KEY SHARE` lock on the same booking
 * row either way, so the contenders still park on the gate — and fails on the
 * trail instead. Both events come back carrying a null `previous_status`, each
 * claiming to be the booking's first, because both read the row before either
 * wrote it. That is the fork, and it is the shape of the failure to expect here:
 * "expected length 1, got 2" on the events with no predecessor.
 */

const HOUR_MS = 60 * 60 * 1000;

/** A shop, a departure, and one booked diver whose payment row is contested. */
async function bookedDiver(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Race Test Divers ${suffix}`,
      slug: `race-test-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const startsAt = new Date(nowDate().getTime() + 24 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 6,
      priceCents: 18_000,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!booking.ok) throw new Error(`booking refused: ${booking.reason}`);
  return { shopId: shop.id, bookingId: booking.bookingId };
}

/** The row `withBookingPaymentLock` locks — the booking, never the payment. */
const bookingRowLock = (bookingId: string) =>
  sql`select id from bookings where id = ${bookingId} for update`;

describePostgres("booking payment writes under real concurrency", () => {
  it("serializes two simultaneous payment writes into one unbroken trail", async () => {
    const pg = await postgresTestDb();
    const { shopId, bookingId } = await bookedDiver(pg.db);

    const gate = await holdRowLock(pg, bookingRowLock(bookingId));
    // A staff member marking the seat paid at the counter while the provider's
    // webhook reports the same booking refunded — two backends, one booking.
    const counter = setBookingPayment(pg.connect(), {
      shopId,
      bookingId,
      status: "paid",
      amountCents: 18_000,
      currency: "usd",
      operation: "manual_mark",
    });
    const webhook = setBookingPayment(pg.connect(), {
      shopId,
      bookingId,
      status: "refunded",
      amountCents: 18_000,
      currency: "usd",
      operation: "cancellation_refund",
    });

    // Both inside `withBookingPaymentLock`'s transaction and parked on the
    // booking row, so dropping the gate starts them together. As next door in
    // `bookings.postgres.test.ts`, this establishes the race rather than
    // detecting the lock — the event chain below is what does that.
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    await Promise.all([counter, webhook]);

    const events = await pg.db
      .select()
      .from(bookingPaymentEvents)
      .where(eq(bookingPaymentEvents.bookingId, bookingId));
    expect(events).toHaveLength(2);

    // Reconstructed by following `previous_status`, never by sorting. There is
    // no column here that orders two racing writes: `id` is `defaultRandom()`,
    // so ascending it is ascending a random UUID; `occurred_at` comes from the
    // suite's frozen clock and is *identical* for both; and `created_at`'s
    // `now()` is transaction-*start* time, which is deliberately the same
    // instant for two contenders released from one gate. An earlier draft
    // ordered by `id` and passed roughly half the time — a coin flip dressed as
    // an assertion, which is worse than no test.
    //
    // Order-independence is not just a workaround for that. The claim being
    // made is about the *shape* of the trail — one chain, not a fork — and that
    // claim is true or false regardless of what order the rows come back in.
    const first = events.filter((event) => event.previousStatus === null);
    const second = events.filter((event) => event.previousStatus !== null);
    // Exactly one write found no payment row: whichever got the lock first. Two
    // would be the fork — both read the booking before either wrote it, which is
    // precisely what an unserialized read-then-write produces.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // And the survivor's predecessor is the other event, so the two links join.
    expect(second[0]?.previousStatus).toBe(first[0]?.status);
    // Both writes are still represented — the pair is the two that were sent,
    // not the same one recorded twice.
    expect([first[0]?.status, second[0]?.status].sort()).toEqual(["paid", "refunded"]);

    // And the surviving row is the last event's status, not some third value.
    const [row] = await pg.db
      .select()
      .from(bookingPayments)
      .where(eq(bookingPayments.bookingId, bookingId));
    expect(row?.status).toBe(second[0]?.status);
  });
});
