import { describe, expect, it } from "vitest";
import { createBookingParty } from "../../../db/bookings";
import { setBookingPayment } from "../../../db/payments";
import { upcomingTripsWithCounts } from "../../../db/trips-queries.test-support";
import { fileScopedShopContext } from "../../../test/db";
import { getTripMoney } from "./store";

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";
const ctx = fileScopedShopContext();

/**
 * **The Money card reads what is recorded** (layer E): a hand-marked payment
 * is collected at what the shop holds, the seat's unpaid rest is owed, and
 * another shop reads none of it.
 */
describe("a departure's money, from its records", () => {
  it("collects a recorded payment and owes the rest of a priced seat", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips.find(
      (row) => !row.course && row.capacity - row.booked >= 1 && (row.priceCents ?? 0) > 0,
    );
    if (!trip) throw new Error("no priced demo departure with room");
    const before = await getTripMoney(db, shop, trip.id);
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Money Diver",
        email: "money-diver@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0]?.bookingId as string;
    const deposit = 1_000;
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "deposit_paid",
      amountCents: deposit,
      currency: shop.currency,
      method: "cash",
    });
    const after = await getTripMoney(db, shop, trip.id);
    expect(after.collectedCents - before.collectedCents).toBe(deposit);
    expect(after.owedCents - before.owedCents).toBeGreaterThan(0);
    expect(after.currency).toBe(shop.currency);
    const other = await getTripMoney(db, { id: OTHER_SHOP_ID, currency: shop.currency }, trip.id);
    expect(other).toMatchObject({ collectedCents: 0, owedCents: 0, rentalCents: 0 });
  });
});
