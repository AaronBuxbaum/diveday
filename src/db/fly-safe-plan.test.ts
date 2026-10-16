import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { readPlannedFlySafe } from "./fly-safe-plan";
import { trips } from "./schema";
import { createTrip } from "./trips";

const ctx = fileScopedShopContext();

/** Fifth-loop ideas, item 18: the planned flying time on `/ready`, before the boat sails. */
describe("readPlannedFlySafe", () => {
  const base = new Date("2031-03-12T12:00:00.000Z");

  async function departure(title: string, startsAt: Date, plannedDives = 1) {
    const trip = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 6,
      plannedDives,
    });
    if (!trip) throw new Error(`createTrip refused ${title}`);
    return trip;
  }

  async function seat(tripId: string, email = "ines-flyhome@example.com") {
    const party = await createBookingParty(ctx.db, [
      { actor: "staff", shopId: ctx.shop.id, tripId, fullName: "Ines Flyhome", email },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    return party.bookings[0];
  }

  const ask = (
    trip: Awaited<ReturnType<typeof departure>>,
    personId: string,
    participantType: "diver" | "snorkeler" | "rider" = "diver",
  ) =>
    readPlannedFlySafe(ctx.db, {
      shop: { id: ctx.shop.id },
      person: { id: personId },
      participantType,
      detail: { shop: { timezone: ctx.shop.timezone }, trip },
    });

  it("names the single-dive wait from the buffered return for a one-tank boat", async () => {
    const trip = await departure("One tank", base);
    const booking = await seat(trip.id);
    expect(await ask(trip, booking.personId)).toEqual({
      from: new Date(trip.endsAt.getTime() + DEPARTURE_BUFFER_MS + 18 * HOUR_MS),
      reason: "one_dive",
      hours: 18,
    });
  });

  it("takes the repetitive wait when the diver holds a seat the day before, booked or sailed", async () => {
    const yesterday = await departure("Yesterday", new Date(base.getTime() - 24 * HOUR_MS));
    const today = await departure("Today", base);
    await seat(yesterday.id);
    const booking = await seat(today.id);
    expect(await ask(today, booking.personId)).toMatchObject({ reason: "earlier_day", hours: 24 });
  });

  it("yields to the diver's own next seat inside the wait", async () => {
    // Today ends 16:00Z; one tank's wait runs to 11:00Z tomorrow, and the
    // early boat sails at 08:00Z.
    const today = await departure("Today", base);
    const tomorrow = await departure("Tomorrow", new Date(base.getTime() + 20 * HOUR_MS));
    const booking = await seat(today.id);
    await seat(tomorrow.id);
    expect(await ask(today, booking.personId)).toBeNull();
  });

  it("does not yield to another diver's seat", async () => {
    const today = await departure("Today", base);
    const tomorrow = await departure("Tomorrow", new Date(base.getTime() + 20 * HOUR_MS));
    const booking = await seat(today.id);
    await seat(tomorrow.id, "someone-else-flyhome@example.com");
    expect(await ask(today, booking.personId)).not.toBeNull();
  });

  it("says nothing to a snorkeler or a rider, who never goes under", async () => {
    const trip = await departure("One tank", base);
    const booking = await seat(trip.id);
    expect(await ask(trip, booking.personId, "snorkeler")).toBeNull();
    expect(await ask(trip, booking.personId, "rider")).toBeNull();
  });

  it("says nothing past no-decompression limits (H-84)", async () => {
    const trip = await departure("Deco", base);
    const booking = await seat(trip.id);
    await ctx.db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, trip.id));
    expect(await ask(trip, booking.personId)).toBeNull();
  });

  it("reads only this shop's departure", async () => {
    const trip = await departure("One tank", base);
    const booking = await seat(trip.id);
    expect(
      await readPlannedFlySafe(ctx.db, {
        shop: { id: "00000000-0000-4000-8000-000000000000" },
        person: { id: booking.personId },
        participantType: "diver",
        detail: { shop: { timezone: ctx.shop.timezone }, trip },
      }),
    ).toBeNull();
  });
});
