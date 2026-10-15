import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { recordingCheckout } from "@/test/fakes";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { createBooking } from "./bookings";
import { trips } from "./schema";
import { setShopFeature } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { startTipCheckout } from "./tips";

/**
 * Two tip submissions for one booking at once, a double click or two open tabs
 * (fourth review, row 33). `startTipCheckout` locks the booking row, then
 * reuses a pending tip or mints one Stripe session. Without the lock both see no
 * pending tip and both mint a session; if both are paid, the diver is charged
 * twice for one tip. The count of sessions Stripe was asked for is the outcome.
 */

describePostgres("startTipCheckout under real concurrency", () => {
  it("asks Stripe for one session when one booking tips twice at once", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db, "Tip Reef");
    await setShopFeature(pg.db, shop.id, "tips", true);
    await upsertShopStripeAccount(pg.db, shop.id, "acct_tips_race");
    await setShopStripeAccountStatus(pg.db, "acct_tips_race", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const startsAt = new Date(nowDate().getTime() + 24 * HOUR_MS);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Reef",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
        capacity: 6,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const booked = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Tip Diver",
      email: "tip@example.com",
    });
    if (!booked.ok) throw new Error(`booking refused: ${booked.reason}`);

    const stripe = recordingCheckout();
    const input = {
      bookingId: booked.bookingId,
      amountCents: 1_000,
      successUrl: "https://diveday.example/recap/tok?tip=paid",
      cancelUrl: "https://diveday.example/recap/tok?tip=cancelled",
      lineDescription: "Tip",
    };
    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${booked.bookingId} for update`,
    );
    const submits = [pg.connect(), pg.connect()].map((db) =>
      startTipCheckout(db, input, stripe.provider),
    );
    await waitForLockWaiters(pg.db, submits.length);
    await gate.release();

    const outcomes = await Promise.all(submits);
    expect(stripe.requests).toHaveLength(1);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const urls = outcomes.map((outcome) => (outcome.ok ? outcome.checkoutUrl : null));
    expect(urls[0]).toBe(urls[1]);
  });
});
