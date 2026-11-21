import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingParty } from "@/db/bookings";
import { bookings, executedDives, trips } from "@/db/schema";
import { createTrip, listStaff, listTripDives } from "@/db/trips";
import { recordDiveParticipation } from "@/features/after-the-dive/dive-participation";
import { fileScopedShopContext } from "@/test/db";
import { getRecapPageData } from "./store";
import { recapFixtureContext } from "./store.test-support";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();
const recapContext = () => recapFixtureContext(ctx);

describe("a dive the crew said this diver sat out (issue #4307)", () => {
  it("names no site from it, and changes nothing else", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("no staff");
    const dives = await listTripDives(db, shop.id, reef.id);
    const siteOf = (n: number) => dives.find(({ dive }) => dive.diveNumber === n)?.diveSite?.name;
    const first = siteOf(1);
    const second = siteOf(2);
    if (!first || !second || first === second) throw new Error("the reef needs two named sites");
    const before = await getRecapPageData(db, bookingId);
    expect(before?.sites.map((site) => site.name)).toEqual([first, second]);

    // Unknown and dived both keep the dive: only "sat out" takes it off.
    const note = { shopId: shop.id, tripId: reef.id, bookingId, diveNumber: 2 };
    await recordDiveParticipation(db, {
      ...note,
      participation: "dived",
      recordedByPersonId: staff.person.id,
    });
    expect((await getRecapPageData(db, bookingId))?.sites.map((s) => s.name)).toEqual([
      first,
      second,
    ]);
    await recordDiveParticipation(db, {
      ...note,
      participation: "sat_out",
      recordedByPersonId: staff.person.id,
    });
    const after = await getRecapPageData(db, bookingId);
    expect(after?.sites.map((site) => site.name)).toEqual([first]);
    expect(after?.fieldGuide.map((guide) => guide.siteName)).not.toContain(second);
    // The day, the count and when they may fly are not this note's to move.
    expect(after?.flySafe).toEqual(before?.flySafe);
    expect(after?.visitCount).toBe(before?.visitCount);
    expect(after?.trip.plannedDives).toBe(before?.trip.plannedDives);

    // Corrected back to unknown, the record names the whole day again.
    await recordDiveParticipation(db, {
      ...note,
      participation: "unknown",
      recordedByPersonId: staff.person.id,
    });
    expect((await getRecapPageData(db, bookingId))?.sites.map((s) => s.name)).toEqual([
      first,
      second,
    ]);
  });

  it("still counts a day the diver sat out every dive of as a dive day", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("no staff");
    // The same diver held a seat on another departure, a day before the reef.
    const dayAfter = new Date(reef.startsAt.getTime() + 24 * 60 * 60 * 1000);
    const other = await createTrip(db, {
      shopId: shop.id,
      title: "First-Timer Two-Tank",
      startsAt: dayAfter,
      endsAt: new Date(dayAfter.getTime() + 3 * 60 * 60 * 1000),
      capacity: 12,
      plannedDives: 2,
    });
    if (!other) throw new Error("test setup: the second departure could not be created");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: other.id,
        fullName: "Rae Recap",
        email: "recap-rae@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const dayBefore = new Date(reef.startsAt.getTime() - 24 * 60 * 60 * 1000);
    await db
      .update(trips)
      .set({ startsAt: dayBefore, endsAt: new Date(dayBefore.getTime() + 3 * 60 * 60 * 1000) })
      .where(eq(trips.id, other.id));
    const otherSeat = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, other.id), eq(bookings.shopId, shop.id)));
    const otherBooking = otherSeat[0]?.id;
    if (!otherBooking) throw new Error("test setup: no seat on the other day");
    expect((await getRecapPageData(db, bookingId))?.visitCount).toBe(2);

    // Sat out both dives of the earlier day, and every dive of the reef day itself.
    for (const [tripId, seat, dives] of [
      [other.id, otherBooking, [1, 2]],
      [reef.id, bookingId, [1, 2]],
    ] as const) {
      for (const diveNumber of dives) {
        await recordDiveParticipation(db, {
          shopId: shop.id,
          tripId,
          bookingId: seat,
          diveNumber,
          participation: "sat_out",
          recordedByPersonId: staff.person.id,
        });
      }
    }
    const after = await getRecapPageData(db, bookingId);
    expect(after?.sites).toEqual([]);
    expect(after?.visitCount).toBe(2);
  });

  it("names no species the crew logged on a dive this diver sat out", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("no staff");
    await db.insert(executedDives).values([
      { shopId: shop.id, tripId: reef.id, diveNumber: 1, observedSpeciesSlug: "green-sea-turtle" },
      { shopId: shop.id, tripId: reef.id, diveNumber: 2, observedSpeciesSlug: "nurse-shark" },
    ]);
    const note = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      recordedByPersonId: staff.person.id,
    };
    const before = await getRecapPageData(db, bookingId);
    expect(before?.observedSpecies).toEqual(["green-sea-turtle", "nurse-shark"]);
    await recordDiveParticipation(db, { ...note, diveNumber: 2, participation: "sat_out" });
    expect((await getRecapPageData(db, bookingId))?.observedSpecies).toEqual(["green-sea-turtle"]);
  });
});
