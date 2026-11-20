// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedRollCallEvidence } from "@/db/seed-roll-call-evidence";
import { nowMs } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { aboardAtSeaBookingIds } from "./aboard-at-sea";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { diveNotMadeStanding, recordDiveNotMade, undoDiveNotMade } from "./dive-not-made";
import { upsertExecutedDive } from "./executed-dives";
import {
  activityEvents,
  diveNotMadeEvents,
  people,
  shops,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

/**
 * **Recording a planned dive as not made** (issue #4681), the safety contract
 * Aaron accepted 2026-11-19, against a real database. The failure paths come
 * first: who may not record it, when it may not be recorded, and that a
 * refusal writes nothing. Then that the record is append-only, its undo
 * keeps both words, and that it never stands in for a count.
 */
const ctx = fileScopedShopContext();
const HOUR = 60 * 60 * 1000;

async function departure() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  const [crew, other] = await listStaff(db, shop.id);
  if (!crew || !other) throw new Error("seeded staff missing");
  await db.delete(tripAssignments).where(eq(tripAssignments.tripId, trip.id));
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: crew.person.id });
  const seat = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!seat.ok) throw new Error("test seat refused");
  return {
    db,
    shopId: shop.id,
    tripId: trip.id,
    crewId: crew.person.id,
    otherId: other.person.id,
    bookingId: seat.bookingId,
  };
}

async function sail(db: AppDb, tripId: string) {
  const left = new Date(nowMs() - 2 * HOUR);
  await db
    .update(trips)
    .set({ startsAt: left, endsAt: new Date(left.getTime() + 4 * HOUR) })
    .where(eq(trips.id, tripId));
}

async function words(db: AppDb, tripId: string) {
  return db
    .select({
      dive: diveNotMadeEvents.diveNumber,
      word: diveNotMadeEvents.word,
      by: diveNotMadeEvents.recordedByPersonId,
    })
    .from(diveNotMadeEvents)
    .where(eq(diveNotMadeEvents.tripId, tripId))
    .orderBy(diveNotMadeEvents.seq);
}

async function trail(db: AppDb, tripId: string) {
  const rows = await db
    .select({ code: activityEvents.code, params: activityEvents.params })
    .from(activityEvents)
    .where(eq(activityEvents.tripId, tripId))
    .orderBy(activityEvents.seq);
  return rows.filter((row) => row.code.startsWith("dive_not_made"));
}

describe("recordDiveNotMade refuses, and writes nothing", () => {
  it("refuses a staffer who is not on this departure's crew", async () => {
    const { db, shopId, tripId, otherId } = await departure();
    await sail(db, tripId);
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: otherId }),
    ).toEqual({ ok: false, reason: "not_crew" });
    expect(await words(db, tripId)).toEqual([]);
  });

  it("refuses crew whose staff account is no longer active", async () => {
    const { db, shopId, tripId } = await departure();
    await sail(db, tripId);
    // A diver on the crew list is not staff at this shop.
    const [diver] = await db.insert(people).values({ shopId, fullName: "Not Staff" }).returning();
    if (!diver) throw new Error("test person insert failed");
    await db.insert(tripAssignments).values({ tripId, personId: diver.id });
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: diver.id }),
    ).toEqual({ ok: false, reason: "not_crew" });
    expect(await words(db, tripId)).toEqual([]);
  });

  it("refuses while the boat has not left the dock", async () => {
    const { db, shopId, tripId, crewId } = await departure();
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: crewId }),
    ).toEqual({ ok: false, reason: "boat_not_left" });
    expect(await words(db, tripId)).toEqual([]);
  });

  it("refuses a dive the departure does not plan", async () => {
    const { db, shopId, tripId, crewId } = await departure();
    await sail(db, tripId);
    const [{ planned } = { planned: 0 }] = await db
      .select({ planned: trips.plannedDives })
      .from(trips)
      .where(eq(trips.id, tripId));
    for (const diveNumber of [0, -1, planned + 1, 1.5]) {
      expect(await recordDiveNotMade(db, { shopId, tripId, diveNumber, personId: crewId })).toEqual(
        { ok: false, reason: "dive_not_planned" },
      );
    }
    expect(await words(db, tripId)).toEqual([]);
  });

  it("refuses a dive whose count has begun, even when that result was undone", async () => {
    const { db, shopId, tripId, crewId, bookingId } = await departure();
    await sail(db, tripId);
    const base = { shopId, tripId, bookingId, recordedByPersonId: crewId };
    await seedRollCallEvidence(db, {
      ...base,
      status: "boarded",
      checkpoint: "after_dive_2",
      occurredAt: new Date(nowMs() - 10 * 60 * 1000),
    });
    await seedRollCallEvidence(
      db,
      {
        ...base,
        status: "cleared",
        checkpoint: "after_dive_2",
        occurredAt: new Date(nowMs() - 5 * 60 * 1000),
      },
      { observesPrevious: true },
    );
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: crewId }),
    ).toEqual({ ok: false, reason: "dive_counted" });
    expect(await words(db, tripId)).toEqual([]);
  });

  it("refuses a dive somebody logged, even with nobody counted", async () => {
    const { db, shopId, tripId, crewId } = await departure();
    await sail(db, tripId);
    const logged = await upsertExecutedDive(db, {
      shopId,
      tripId,
      diveNumber: 2,
      enteredAt: new Date(nowMs() - 60 * 60 * 1000),
      exitedAt: new Date(nowMs() - 15 * 60 * 1000),
      maxDepthMeters: null,
      recordedByPersonId: crewId,
    });
    if (!logged.ok) throw new Error(`test log refused: ${logged.reason}`);
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: crewId }),
    ).toEqual({ ok: false, reason: "dive_logged" });
    expect(await words(db, tripId)).toEqual([]);
  });

  it("refuses a cancelled departure and another shop's", async () => {
    const { db, shopId, tripId, crewId } = await departure();
    await sail(db, tripId);
    const [elsewhere] = await db
      .insert(shops)
      .values({ name: "Elsewhere", slug: "elsewhere-not-made", timezone: "UTC" })
      .returning();
    if (!elsewhere) throw new Error("test shop insert failed");
    expect(
      await recordDiveNotMade(db, {
        shopId: elsewhere.id,
        tripId,
        diveNumber: 2,
        personId: crewId,
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: crewId }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
    expect(await words(db, tripId)).toEqual([]);
  });
});

describe("the not-made record", () => {
  it("records who and when, on the departure's trail, for that dive only", async () => {
    const { db, shopId, tripId, crewId } = await departure();
    await sail(db, tripId);
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: crewId }),
    ).toEqual({ ok: true });
    const standing = await diveNotMadeStanding(db, shopId, tripId);
    expect([...standing.keys()]).toEqual([2]);
    expect(standing.get(2)).toMatchObject({ by: expect.any(String), at: expect.any(Date) });
    expect(await trail(db, tripId)).toEqual([
      { code: "dive_not_made", params: expect.objectContaining({ dive: "2" }) },
    ]);
    // Said once: a second tap is refused, not a second row.
    expect(
      await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: crewId }),
    ).toEqual({ ok: false, reason: "already_not_made" });
    expect(await words(db, tripId)).toHaveLength(1);
  });

  it("is undone by appending, so the record and its undo both stay", async () => {
    const { db, shopId, tripId, crewId } = await departure();
    await sail(db, tripId);
    const input = { shopId, tripId, diveNumber: 2, personId: crewId };
    await recordDiveNotMade(db, input);
    advanceClock(1000);
    expect(await undoDiveNotMade(db, input)).toEqual({ ok: true });
    expect(await diveNotMadeStanding(db, shopId, tripId)).toEqual(new Map());
    expect(await words(db, tripId)).toEqual([
      { dive: 2, word: "not_made", by: crewId },
      { dive: 2, word: "undone", by: crewId },
    ]);
    expect((await trail(db, tripId)).map((line) => line.code)).toEqual([
      "dive_not_made",
      "dive_not_made_undone",
    ]);
    // Nothing standing to undo.
    expect(await undoDiveNotMade(db, input)).toEqual({ ok: false, reason: "not_recorded" });
    // And it may be recorded again after the correction.
    advanceClock(1000);
    expect(await recordDiveNotMade(db, input)).toEqual({ ok: true });
    expect(await words(db, tripId)).toHaveLength(3);
  });

  it("refuses an undo by a staffer not on the crew", async () => {
    const { db, shopId, tripId, crewId, otherId } = await departure();
    await sail(db, tripId);
    await recordDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: crewId });
    expect(await undoDiveNotMade(db, { shopId, tripId, diveNumber: 2, personId: otherId })).toEqual(
      { ok: false, reason: "not_crew" },
    );
    expect(await diveNotMadeStanding(db, shopId, tripId)).toHaveProperty("size", 1);
  });

  it("never stands in for a count: a seat nobody counted is still held as at sea", async () => {
    const { db, shopId, tripId, crewId, bookingId } = await departure();
    await sail(db, tripId);
    for (const diveNumber of [1, 2]) {
      expect(await recordDiveNotMade(db, { shopId, tripId, diveNumber, personId: crewId })).toEqual(
        { ok: true },
      );
    }
    const held = await aboardAtSeaBookingIds(db, { shopId, tripId, now: new Date(nowMs()) });
    expect(held.get(bookingId)).toBe("uncounted");
    // Nor does it touch the roll call.
    const marks = await db
      .select({ id: diveNotMadeEvents.id })
      .from(diveNotMadeEvents)
      .where(and(eq(diveNotMadeEvents.tripId, tripId), eq(diveNotMadeEvents.shopId, shopId)));
    expect(marks).toHaveLength(2);
  });
});

/**
 * **A departure that meets on two days** (a liveaboard, a two-day course):
 * the record belongs to the meeting day it was said on, as roll call does. Day
 * one's "dive 2 not made" says nothing about day two's dive 2.
 */
describe("a departure that meets on two days", () => {
  const DAY = 24 * HOUR;
  async function twoDays(db: AppDb, tripId: string) {
    const base = nowMs();
    const starts = [base - DAY - 2 * HOUR, base - 2 * HOUR];
    await db
      .update(trips)
      .set({ startsAt: new Date(base - DAY - 2 * HOUR), endsAt: new Date(base + 2 * HOUR) })
      .where(eq(trips.id, tripId));
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, tripId));
    await db.insert(tripScheduleDays).values(
      starts.map((start, index) => ({
        tripId,
        dayNumber: index + 1,
        startsAt: new Date(start),
        endsAt: new Date(start + 4 * HOUR),
      })),
    );
    return { dayOne: new Date(base - DAY), dayTwo: new Date(base) };
  }

  it("keeps day one's record to day one", async () => {
    const { db, shopId, tripId, crewId } = await departure();
    const { dayOne, dayTwo } = await twoDays(db, tripId);
    const input = { shopId, tripId, diveNumber: 2, personId: crewId };
    expect(await recordDiveNotMade(db, input, dayOne)).toEqual({ ok: true });
    expect([...(await diveNotMadeStanding(db, shopId, tripId, dayOne)).keys()]).toEqual([2]);
    // Day two's dive 2 is its own: nothing stands, nothing to undo, and it
    // may be said again.
    expect(await diveNotMadeStanding(db, shopId, tripId, dayTwo)).toEqual(new Map());
    expect(await undoDiveNotMade(db, input, dayTwo)).toEqual({
      ok: false,
      reason: "not_recorded",
    });
    expect(await recordDiveNotMade(db, input, dayTwo)).toEqual({ ok: true });
    // Undoing day two's leaves day one's standing.
    expect(await undoDiveNotMade(db, input, new Date(dayTwo.getTime() + 1000))).toEqual({
      ok: true,
    });
    expect(await diveNotMadeStanding(db, shopId, tripId, dayTwo)).toEqual(new Map());
    expect([...(await diveNotMadeStanding(db, shopId, tripId, dayOne)).keys()]).toEqual([2]);
    expect(
      await db
        .select({ day: diveNotMadeEvents.meetingDay, word: diveNotMadeEvents.word })
        .from(diveNotMadeEvents)
        .where(eq(diveNotMadeEvents.tripId, tripId))
        .orderBy(diveNotMadeEvents.seq),
    ).toEqual([
      { day: 0, word: "not_made" },
      { day: 1, word: "not_made" },
      { day: 1, word: "undone" },
    ]);
  });
});
