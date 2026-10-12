import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { CREW_WEEK_LINES, crewWeekFor } from "./crew-week";
import { bookings, people, trips } from "./schema";
import { createTrip, listStaff, setTripCrew } from "./trips";

/** Far past the seeded demo's own crew calendar, so its departures never interleave. */
const OFFSET_MS = 200 * 24 * HOUR_MS;

const ctx = fileScopedShopContext();

async function seatDiver(db: AppDb, shopId: string, tripId: string, tag: string) {
  const [diver] = await db
    .insert(people)
    .values({ shopId, fullName: `Aboard ${tag}`, email: `crew-week-${tag}@example.com` })
    .returning();
  if (!diver) throw new Error("failed to insert diver");
  await db.insert(bookings).values({ bookedAs: "diver", shopId, tripId, personId: diver.id });
}

async function departure(db: AppDb, shopId: string, title: string, hoursIn: number) {
  const startsAt = new Date(nowMs() + OFFSET_MS + hoursIn * HOUR_MS);
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error(`failed to create ${title}`);
  return trip;
}

const window = () => ({
  from: new Date(nowMs() + OFFSET_MS - HOUR_MS),
  to: new Date(nowMs() + OFFSET_MS + 7 * 24 * HOUR_MS),
});

/** "Your week" on a crew member's Today: their next three departures. */
describe("crewWeekFor", () => {
  it("names a crew member's next departures, soonest first, with their job and the gap", async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const captain = staff.find((entry) => entry.roles.includes("captain"));
    if (!captain) throw new Error("seeded captain missing");

    const later = await departure(db, shop.id, "Afternoon wreck", 30);
    const sooner = await departure(db, shop.id, "Morning reef", 2);
    for (const trip of [later, sooner]) {
      expect(
        await setTripCrew(db, shop.id, trip.id, [
          { personId: captain.person.id, tripRole: "captain" },
        ]),
      ).toBe(true);
    }
    // Divers aboard and only a captain: nobody in the water with them.
    await seatDiver(db, shop.id, sooner.id, "sooner");

    const lines = await crewWeekFor(db, {
      shopId: shop.id,
      personId: captain.person.id,
      ...window(),
    });
    expect(lines.map((line) => line.title)).toEqual(["Morning reef", "Afternoon wreck"]);
    expect(lines[0]).toMatchObject({ tripRole: "captain", gap: "uncrewed_departure" });
    // Nobody booked: never short.
    expect(lines[1]?.gap).toBeNull();
  });

  it("stops at three, and leaves out a departure the shop deleted or the reader is not on", async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const [crew, other] = staff.filter((entry) => entry.roles.includes("divemaster"));
    if (!crew) throw new Error("seeded divemaster missing");

    const deleted = await departure(db, shop.id, "Deleted dawn dive", 1);
    await setTripCrew(db, shop.id, deleted.id, [crew.person.id]);
    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, deleted.id));
    for (let i = 0; i < CREW_WEEK_LINES + 1; i++) {
      const trip = await departure(db, shop.id, `Rostered ${i}`, 3 + i * 24);
      await setTripCrew(db, shop.id, trip.id, [crew.person.id]);
    }
    if (other) {
      const theirs = await departure(db, shop.id, "Somebody else's", 2);
      await setTripCrew(db, shop.id, theirs.id, [other.person.id]);
    }

    const lines = await crewWeekFor(db, { shopId: shop.id, personId: crew.person.id, ...window() });
    expect(lines.map((line) => line.title)).toEqual(["Rostered 0", "Rostered 1", "Rostered 2"]);
  });

  it("reads nothing for somebody rostered on nothing", async () => {
    const { db, shop } = ctx;
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Not crew", email: "crew-week-none@example.com" })
      .returning();
    if (!diver) throw new Error("failed to insert person");
    expect(await crewWeekFor(db, { shopId: shop.id, personId: diver.id, ...window() })).toEqual([]);
  });
});
