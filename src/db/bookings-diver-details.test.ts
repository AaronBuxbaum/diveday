import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  confirmCarriedFacts,
  getBookingPickupTime,
  setBookingDietaryNote,
  setBookingDiveIntent,
  setBookingHotelPickup,
  setBookingLastDived,
  setBookingPickupDetails,
  setBookingReEntryAsk,
} from "./bookings";
import { bookings, tripDeskEvents, trips } from "./schema";

// No transaction or concurrency semantics are under test: each test rolls back its writes.
const ctx = fileScopedShopContext();
async function seat() {
  const { db, shop } = ctx;
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
    .limit(1);
  if (!booking) throw new Error("Expected live seeded booking");
  await db.update(trips).set({ lunchAboard: true }).where(eq(trips.id, booking.tripId));
  return { db, booking, input: { shopId: shop.id, bookingId: booking.id } };
}
const writers = [
  [
    "intent",
    (input: { shopId: string; bookingId: string }) =>
      setBookingDiveIntent(ctx.db, { ...input, intent: "easing_back" }),
  ],
  [
    "re-entry",
    (input: { shopId: string; bookingId: string }) =>
      setBookingReEntryAsk(ctx.db, { ...input, ask: "deck_word" }),
  ],
  [
    "confirmation",
    (input: { shopId: string; bookingId: string }) => confirmCarriedFacts(ctx.db, input),
  ],
  [
    "recency",
    (input: { shopId: string; bookingId: string }) =>
      setBookingLastDived(ctx.db, { ...input, band: "over_five_years" }),
  ],
  [
    "dietary",
    (input: { shopId: string; bookingId: string }) =>
      setBookingDietaryNote(ctx.db, { ...input, note: " vegetarian " }),
  ],
  [
    "hotel",
    (input: { shopId: string; bookingId: string }) =>
      setBookingHotelPickup(ctx.db, { ...input, hotelPickupLocation: "Lobby" }),
  ],
  [
    "pickup",
    (input: { shopId: string; bookingId: string }) =>
      setBookingPickupDetails(ctx.db, { ...input, pickupTime: "08:30" }),
  ],
] as const;
describe("booking detail public seam", () => {
  it("writes optional crew facts without changing the booking's admission or payment state", async () => {
    const { db, booking, input } = await seat();
    for (const [, write] of writers) expect(await write(input)).toBe(true);
    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved).toMatchObject({
      diveIntent: "easing_back",
      reEntryAsk: "deck_word",
      lastDivedBand: "over_five_years",
      dietaryNote: "vegetarian",
      hotelPickupLocation: "Lobby",
      pickupTime: "08:30",
      status: booking.status,
      personId: booking.personId,
      tripId: booking.tripId,
      carriedFactsConfirmedAt: nowDate(),
    });
    expect(await getBookingPickupTime(db, input.shopId, booking.id)).toBe("08:30");
  });
  it("refuses every setter for another tenant and for cancelled seats", async () => {
    const { db, booking, input } = await seat();
    for (const [, write] of writers)
      expect(await write({ ...input, shopId: "00000000-0000-4000-8000-000000000099" })).toBe(false);
    expect(
      await getBookingPickupTime(db, "00000000-0000-4000-8000-000000000099", booking.id),
    ).toBeNull();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    for (const [, write] of writers) expect(await write(input)).toBe(false);
    const [after] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(after).toEqual({ ...booking, status: "cancelled" });
  });
  it("distinguishes omitted pickup location from clearing and emits only the existing hotel event", async () => {
    const { db, booking, input } = await seat();
    const events = () =>
      db
        .select()
        .from(tripDeskEvents)
        .where(
          and(eq(tripDeskEvents.bookingId, booking.id), eq(tripDeskEvents.kind, "pickup_set")),
        );
    const before = (await events()).length;
    await setBookingHotelPickup(db, { ...input, hotelPickupLocation: "Lobby" });
    await setBookingPickupDetails(db, { ...input, pickupTime: " 08:30 " });
    expect(await getBookingPickupTime(db, input.shopId, booking.id)).toBe("08:30");
    expect(
      (await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]?.hotelPickupLocation,
    ).toBe("Lobby");
    await setBookingPickupDetails(db, { ...input, pickupTime: null, hotelPickupLocation: null });
    await setBookingHotelPickup(db, { ...input, hotelPickupLocation: null });
    expect(await getBookingPickupTime(db, input.shopId, booking.id)).toBeNull();
    expect((await events()).length).toBe(before + 1);
  });
});
