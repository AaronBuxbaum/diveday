import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings, rollCallEvents, trips } from "@/db/schema";
import { seedRollCallEvidence } from "@/db/seed/roll-call-evidence";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { readSafetyRecord } from "./safety-record";

const ctx = fileScopedShopContext();

/** Every seeded departure, long over: the clock sits a day past the last one. */
async function fixture() {
  const { db, shop } = ctx;
  const all = await db
    .select({
      id: trips.id,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      dives: trips.plannedDives,
    })
    .from(trips)
    .where(eq(trips.shopId, shop.id));
  const now = new Date(Math.max(...all.map((trip) => trip.endsAt.getTime())) + 24 * HOUR_MS);
  const seats = await db
    .select({ id: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), eq(bookings.status, "booked")));
  const byTrip = new Map<string, string[]>();
  for (const seat of seats) byTrip.set(seat.tripId, [...(byTrip.get(seat.tripId) ?? []), seat.id]);
  const withSeats = all
    .filter((trip) => (byTrip.get(trip.id)?.length ?? 0) > 0)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  // A clean slate: the test writes every roll call it asks about.
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
  return { db, shop, now, withSeats, byTrip };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Counts every seat of a departure aboard at the dock and at each dive. */
async function countEveryone(
  f: Fixture,
  trip: Fixture["withSeats"][number],
  readiness: "ready" | "blocked" | null = "ready",
) {
  const recorder = await recorderId(f);
  for (const bookingId of f.byTrip.get(trip.id) ?? []) {
    for (const checkpoint of [
      "departure",
      ...Array.from({ length: trip.dives }, (_, i) => `after_dive_${i + 1}`),
    ]) {
      await seedRollCallEvidence(f.db, {
        shopId: f.shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: recorder,
        status: "boarded",
        checkpoint,
        source: "live",
        readinessStatus: checkpoint === "departure" ? readiness : null,
        occurredAt: trip.startsAt,
      });
    }
  }
}

async function recorderId(f: Fixture) {
  const { people } = await import("@/db/schema");
  const [person] = await f.db.select({ id: people.id }).from(people).limit(1);
  if (!person) throw new Error("fixture missing a person");
  return person.id;
}

describe("the safety record", () => {
  it("is nothing for a shop that has run no departure", async () => {
    const f = await fixture();
    expect(await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, new Date(0))).toBeNull();
  });

  it("counts a departure nobody called the roll on as run, and as nothing else", async () => {
    const f = await fixture();
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record).toMatchObject({
      departures: f.withSeats.length,
      boardings: 0,
      rollCallsCompleted: 0,
      readinessCompleted: 0,
    });
  });

  it("leaves out a departure where every diver the crew counted stayed ashore", async () => {
    const f = await fixture();
    const [trip] = f.withSeats;
    if (!trip) throw new Error("fixture missing a departure");
    const base = (await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now))?.departures;
    const recorder = await recorderId(f);
    for (const bookingId of f.byTrip.get(trip.id) ?? []) {
      await seedRollCallEvidence(f.db, {
        shopId: f.shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: recorder,
        status: "not_boarded",
        checkpoint: "departure",
        source: "live",
        occurredAt: trip.startsAt,
      });
    }
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record?.departures).toBe((base ?? 0) - 1);
    expect(record?.rollCallsCompleted).toBe(0);
    expect(record?.boardings).toBe(0);
  });

  it("counts no snorkeler or rider as a boarding", async () => {
    const f = await fixture();
    const [trip] = f.withSeats;
    if (!trip) throw new Error("fixture missing a departure");
    await countEveryone(f, trip);
    const seats = f.byTrip.get(trip.id) ?? [];
    const [guest] = seats;
    if (!guest) throw new Error("fixture missing a seat");
    await f.db.update(bookings).set({ participantType: "snorkeler" }).where(eq(bookings.id, guest));
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record?.boardings).toBe(seats.length - 1);
  });

  it("counts one fully counted, fully ready departure as one of each, with its day as the range", async () => {
    const f = await fixture();
    const [trip] = f.withSeats;
    if (!trip) throw new Error("fixture missing a departure");
    await countEveryone(f, trip);
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record).toMatchObject({
      boardings: f.byTrip.get(trip.id)?.length,
      rollCallsCompleted: 1,
      readinessCompleted: 1,
    });
    const last = f.withSeats[f.withSeats.length - 1];
    expect(record?.startsOn).toBe(calendarDateInTimezone(trip.startsAt, f.shop.timezone));
    expect(record?.endsOn).toBe(
      calendarDateInTimezone(last?.startsAt ?? trip.startsAt, f.shop.timezone),
    );
  });

  it("does not count a departure's roll call complete while a diver counted aboard is still unaccounted for", async () => {
    const f = await fixture();
    const trip = f.withSeats.find((candidate) => candidate.dives > 0);
    if (!trip) throw new Error("fixture missing a departure with dives");
    await countEveryone(f, trip);
    const [seat] = f.byTrip.get(trip.id) ?? [];
    if (!seat) throw new Error("fixture missing a seat");
    // The last word on the first dive is "not back aboard": somebody may be in the water.
    await seedRollCallEvidence(f.db, {
      shopId: f.shop.id,
      tripId: trip.id,
      bookingId: seat,
      recordedByPersonId: await recorderId(f),
      status: "not_boarded",
      checkpoint: "after_dive_1",
      source: "live",
      occurredAt: trip.endsAt,
    });
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record?.rollCallsCompleted).toBe(0);
    expect(record?.boardings).toBe(f.byTrip.get(trip.id)?.length);
  });

  it("does not count readiness complete for a diver counted aboard while blocked, or with no readiness recorded", async () => {
    const f = await fixture();
    const [a, b] = f.withSeats;
    if (!a || !b) throw new Error("fixture needs two departures");
    await countEveryone(f, a, "blocked");
    await countEveryone(f, b, null);
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record?.readinessCompleted).toBe(0);
    expect(record?.rollCallsCompleted).toBe(2);
  });

  it("leaves out a boat still out, a cancelled departure, a rehearsal and an empty one", async () => {
    const f = await fixture();
    const [trip, second, third, fourth] = f.withSeats;
    if (!trip || !second || !third || !fourth) throw new Error("fixture needs four departures");
    const base = (await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now))?.departures;
    await f.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    await f.db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true })
      .where(eq(trips.id, second.id));
    await f.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(inArray(bookings.id, f.byTrip.get(third.id) ?? []));
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record?.departures).toBe((base ?? 0) - 3);
    // The fourth is home an hour before its return window closes: not counted yet.
    const early = new Date(fourth.endsAt.getTime() + HOUR_MS - 1);
    const sooner = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, early);
    expect(sooner?.departures ?? 0).toBeLessThan(record?.departures ?? 0);
  });

  it("does not count a diver whose seat was cancelled after the boat left", async () => {
    const f = await fixture();
    const [trip] = f.withSeats;
    if (!trip) throw new Error("fixture missing a departure");
    await countEveryone(f, trip);
    const seats = f.byTrip.get(trip.id) ?? [];
    const [gone] = seats;
    if (!gone) throw new Error("fixture missing a seat");
    await f.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, gone));
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record?.boardings).toBe(seats.length - 1);
  });

  it("counts a diver the crew un-counted at the dock as nobody", async () => {
    const f = await fixture();
    const [trip] = f.withSeats;
    if (!trip) throw new Error("fixture missing a departure");
    await countEveryone(f, trip);
    const [seat] = f.byTrip.get(trip.id) ?? [];
    if (!seat) throw new Error("fixture missing a seat");
    await seedRollCallEvidence(
      f.db,
      {
        shopId: f.shop.id,
        tripId: trip.id,
        bookingId: seat,
        recordedByPersonId: await recorderId(f),
        status: "cleared",
        checkpoint: "departure",
        source: "live",
        occurredAt: trip.startsAt,
      },
      { observesPrevious: true },
    );
    const record = await readSafetyRecord(f.db, f.shop.id, f.shop.timezone, f.now);
    expect(record?.boardings).toBe((f.byTrip.get(trip.id)?.length ?? 0) - 1);
  });
});
