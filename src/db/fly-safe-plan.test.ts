import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { readPlannedFlySafe, readReminderFlySafeHours } from "./fly-safe-plan";
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

  it("says nothing past no-decompression limits (H-20260916-may-diveday-assert-about)", async () => {
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

  /** Ux-delight sheet 2026-10-22, item 1 (H-20261022-reminder-fly-safe-in): the night-before reminder's hours. */
  describe("readReminderFlySafeHours", () => {
    const hoursFor = (trip: Awaited<ReturnType<typeof departure>>, personId: string) =>
      readReminderFlySafeHours(ctx.db, {
        shop: { id: ctx.shop.id },
        person: { id: personId },
        participantType: "diver",
        detail: { shop: { timezone: ctx.shop.timezone }, trip },
      });

    it("says the hours on the diver's last boat, the repetitive wait for a two-tank plan", async () => {
      const one = await departure("One tank", base);
      const two = await departure("Two tank", new Date(base.getTime() - 96 * HOUR_MS), 2);
      const onePerson = (await seat(one.id)).personId;
      const twoPerson = (await seat(two.id, "two-tank-flyhome@example.com")).personId;
      expect(await hoursFor(one, onePerson)).toBe(18);
      expect(await hoursFor(two, twoPerson)).toBe(24);
    });

    it("says nothing when the diver has any later boat, even one after the wait", async () => {
      const today = await departure("Today", base);
      const nextWeek = await departure("Next week", new Date(base.getTime() + 7 * 24 * HOUR_MS));
      const booking = await seat(today.id);
      await seat(nextWeek.id);
      // The plan itself still stands on /ready; the reminder waits for the last boat.
      expect(await ask(today, booking.personId)).not.toBeNull();
      expect(await hoursFor(today, booking.personId)).toBeNull();
      expect(await hoursFor(nextWeek, booking.personId)).toBe(18);
    });

    it("falls silent where the recap does, past no-decompression limits (H-20260916-may-diveday-assert-about)", async () => {
      const deco = await departure("Deco", base);
      const decoPerson = (await seat(deco.id)).personId;
      await ctx.db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, deco.id));
      expect(await hoursFor(deco, decoPerson)).toBeNull();
    });

    it("says nothing to a snorkeler", async () => {
      const trip = await departure("One tank", base);
      const booking = await seat(trip.id);
      expect(
        await readReminderFlySafeHours(ctx.db, {
          shop: { id: ctx.shop.id },
          person: { id: booking.personId },
          participantType: "snorkeler",
          detail: { shop: { timezone: ctx.shop.timezone }, trip },
        }),
      ).toBeNull();
    });
  });
});
