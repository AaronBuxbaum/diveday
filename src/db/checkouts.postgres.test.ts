import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fakeCheckout } from "@/test/fakes";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBookingParty } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import type { AppDb } from "./client";
import { getBookingPayment } from "./payments";
import { bookingCheckouts, shops, trips } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

/**
 * The Stripe completion webhook against a writer that expires the same
 * checkout at the same instant (issue #2219).
 *
 * `markCheckoutPaidBySessionId` decides from the checkout's status whether a
 * completion may record money. Every writer that retires a pending checkout
 * (`setBookingParticipantType`, a reschedule, a cancellation) does so in its
 * own transaction, so the webhook must read that status under the row's lock
 * and complete only a row that is still `pending`. PGlite is single-connection
 * and can only replay the two writes one after the other; here the expiring
 * writer genuinely holds the checkout row while the webhook is mid-flight.
 *
 * ## Why the outcome, not the wait, is the assertion
 *
 * The gate below locks the checkout row, then expires it. Without the fix the
 * webhook's plain read does not block at all: it reads `pending`, its
 * unconditional `UPDATE ... WHERE id = $1` parks on the gate's lock, and when
 * the gate commits Postgres re-checks only `id`, so `completed` overwrites
 * `expired` and the booking is recorded paid at the retired session's price.
 * Measured: with the `.for("update")` and the `status = 'pending'` condition
 * both removed, this test fails, the webhook handing back a completed checkout
 * where it should have refused.
 */

const HOUR_MS = 60 * 60 * 1000;

async function pendingCheckout(db: AppDb) {
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
  const accountId = `acct_${suffix}`;
  await upsertShopStripeAccount(db, shop.id, accountId);
  await setShopStripeAccountStatus(db, accountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking refused: ${party.reason}`);
  const bookingId = party.bookings[0]?.bookingId;
  if (!bookingId) throw new Error("party returned no booking");
  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: trip.id,
      bookingIds: [bookingId],
      customerEmail: "nora@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }) => tripTitle,
    },
    fakeCheckout(),
  );
  if (!start.ok) throw new Error("checkout start failed");
  return { shopId: shop.id, bookingId, checkout: start.checkout };
}

describePostgres("checkout completion under real concurrency", () => {
  it("never completes a checkout another writer expired while the webhook was in flight", async () => {
    const pg = await postgresTestDb();
    const { shopId, bookingId, checkout } = await pendingCheckout(pg.db);

    // The expiring writer: it holds the checkout row and retires it, the way
    // `setBookingParticipantType` does when a diver's seat becomes a rider's.
    let expire!: () => void;
    const expireNow = new Promise<void>((resolve) => {
      expire = resolve;
    });
    let locked!: () => void;
    const lockedNow = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const expiring = pg.connect().transaction(async (tx) => {
      await tx
        .select({ id: bookingCheckouts.id })
        .from(bookingCheckouts)
        .where(eq(bookingCheckouts.id, checkout.id))
        .for("update");
      locked();
      await expireNow;
      await tx
        .update(bookingCheckouts)
        .set({ status: "expired" })
        .where(eq(bookingCheckouts.id, checkout.id));
    });
    await Promise.race([lockedNow, expiring]);

    // Stripe's completion for the same session arrives while the row is held.
    const webhook = markCheckoutPaidBySessionId(pg.connect(), checkout.stripeSessionId);
    await waitForLockWaiters(pg.db, 1);
    expire();
    await expiring;
    const result = await webhook;

    expect(result).toBeNull();
    const [row] = await pg.db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkout.id));
    expect(row?.status).toBe("expired");
    expect(row?.completedAt).toBeNull();
    expect(await getBookingPayment(pg.db, shopId, bookingId)).toBeNull();
  });
});
