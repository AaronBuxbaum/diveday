import { eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { cancelDeparture } from "./aboard-at-sea";
import type { AppDb } from "./client";
import {
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
  tripStageEvents,
  trips,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **A boat that may be on the water is never called off** (H-20261015-aboard-diver-removal-at): Cancelling
 * then would drop a missing diver off Today and the shore alert, which read
 * scheduled departures only. A weather scrub at the tied-up dock still goes.
 */
describe("cancelDeparture refuses a boat that may be on the water", () => {
  async function departure() {
    const { db, shop } = ctx;
    const reef = (await upcomingTripsWithCounts(db, shop.id)).find(
      (trip) => trip.title === "Two-Tank Reef — Molasses & French",
    );
    if (!reef) throw new Error("expected seeded reef trip missing");
    return { db, shop, reef };
  }

  async function statusOf(db: AppDb, tripId: string) {
    const [row] = await db.select({ status: trips.status }).from(trips).where(eq(trips.id, tripId));
    return row?.status;
  }

  async function startedMinutesAgo(db: AppDb, tripId: string, minutes: number) {
    const startsAt = new Date(nowDate().getTime() - minutes * 60 * 1000);
    await db
      .update(trips)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) })
      .where(eq(trips.id, tripId));
  }

  async function markSeat(
    db: AppDb,
    shopId: string,
    tripId: string,
    status: "boarded" | "not_boarded" | "cleared",
    checkpoint = "departure",
    nth = 0,
  ) {
    const entry = (await getTripRoster(db, shopId, tripId))[nth];
    if (!entry) throw new Error("expected a booking to record a roll call against");
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("expected seeded staff missing");
    await db.insert(rollCallEvents).values({
      shopId,
      tripId,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status,
      checkpoint,
      occurredAt: nowDate(),
    });
  }

  async function everySeatAshore(db: AppDb, shopId: string, tripId: string) {
    const roster = await getTripRoster(db, shopId, tripId);
    for (let nth = 0; nth < roster.length; nth++) {
      await markSeat(db, shopId, tripId, "not_boarded", "departure", nth);
    }
  }

  async function crewMember(db: AppDb, shopId: string, tripId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("expected seeded staff missing");
    await db
      .insert(tripAssignments)
      .values({ tripId, personId: staff.person.id })
      .onConflictDoNothing();
    return staff.person.id;
  }

  async function markCrew(
    db: AppDb,
    shopId: string,
    tripId: string,
    personId: string,
    status: "boarded" | "not_boarded",
    checkpoint = "departure",
  ) {
    await db.insert(rollCallCrewEvents).values({
      shopId,
      tripId,
      personId,
      recordedByPersonId: personId,
      status,
      checkpoint,
      occurredAt: nowDate(),
    });
  }

  async function refused(db: AppDb, shopId: string, tripId: string) {
    expect(await cancelDeparture(db, shopId, tripId, nowDate())).toEqual({
      ok: false,
      reason: "trip_departed",
    });
    expect(await statusOf(db, tripId)).toBe("scheduled");
  }

  async function cancelled(db: AppDb, shopId: string, tripId: string) {
    expect(await cancelDeparture(db, shopId, tripId, nowDate())).toEqual({ ok: true });
    expect(await statusOf(db, tripId)).toBe("cancelled");
  }

  it("calls off a weather scrub at the tied-up dock, roll call taken or not", async () => {
    const { db, shop, reef } = await departure();
    // Counted aboard at the dock, then the call: still tied up, so it goes.
    await markSeat(db, shop.id, reef.id, "boarded");
    await cancelled(db, shop.id, reef.id);
  });

  it("calls off a departure whose dock count is all ashore or undone, before its time", async () => {
    const { db, shop, reef } = await departure();
    await markSeat(db, shop.id, reef.id, "boarded");
    await markSeat(db, shop.id, reef.id, "cleared");
    await markSeat(db, shop.id, reef.id, "not_boarded", "departure", 1);
    await cancelled(db, shop.id, reef.id);
  });

  it("calls off a late boat still at the dock with nobody counted aboard", async () => {
    const { db, shop, reef } = await departure();
    await startedMinutesAgo(db, reef.id, 10);
    await cancelled(db, shop.id, reef.id);
  });

  it("refuses past its time once anybody stands boarded at the dock", async () => {
    const { db, shop, reef } = await departure();
    await startedMinutesAgo(db, reef.id, 10);
    await markSeat(db, shop.id, reef.id, "boarded");
    await refused(db, shop.id, reef.id);
  });

  it("refuses once the late hour has gone by with seats nobody counted", async () => {
    const { db, shop, reef } = await departure();
    await startedMinutesAgo(db, reef.id, 120);
    await refused(db, shop.id, reef.id);
  });

  it("refuses before its time once the crew say a stage past Boarding", async () => {
    const { db, shop, reef } = await departure();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("expected seeded staff missing");
    await db.insert(tripStageEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      stage: "underway",
      recordedByPersonId: staff.person.id,
    });
    await refused(db, shop.id, reef.id);
  });

  it("refuses before its time once anybody has an after-dive result, even everyone ashore at the dock", async () => {
    const { db, shop, reef } = await departure();
    await everySeatAshore(db, shop.id, reef.id);
    const crew = await crewMember(db, shop.id, reef.id);
    await markCrew(db, shop.id, reef.id, crew, "boarded", "after_dive_1");
    await refused(db, shop.id, reef.id);
  });

  it("refuses past its time with a crew member boarded at the dock and every seat ashore", async () => {
    const { db, shop, reef } = await departure();
    await startedMinutesAgo(db, reef.id, 10);
    await everySeatAshore(db, shop.id, reef.id);
    const crew = await crewMember(db, shop.id, reef.id);
    await markCrew(db, shop.id, reef.id, crew, "boarded");
    await refused(db, shop.id, reef.id);
  });

  it("refuses after the late hour while a crew member was never marked ashore", async () => {
    const { db, shop, reef } = await departure();
    await startedMinutesAgo(db, reef.id, 120);
    await everySeatAshore(db, shop.id, reef.id);
    const crew = await crewMember(db, shop.id, reef.id);
    await refused(db, shop.id, reef.id);

    // One crew member marked ashore is not the whole crew.
    await markCrew(db, shop.id, reef.id, crew, "not_boarded");
    const assigned = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, reef.id));
    if (assigned.length > 1) await refused(db, shop.id, reef.id);

    // Every crew member marked ashore too: nobody sailed, so the after-the-fact
    // call-off goes.
    for (const { personId } of assigned) {
      await markCrew(db, shop.id, reef.id, personId, "not_boarded");
    }
    await cancelled(db, shop.id, reef.id);
  });

  it("cancels a departure still to sail that nobody has counted", async () => {
    const { db, shop, reef } = await departure();

    expect(await cancelDeparture(db, shop.id, reef.id, nowDate())).toEqual({ ok: true });
    expect(await statusOf(db, reef.id)).toBe("cancelled");
  });

  it("answers not_found for another shop's departure", async () => {
    const { db, shop, reef } = await departure();
    const [elsewhere] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(ne(shops.id, shop.id))
      .limit(1);
    if (!elsewhere) return;

    expect(await cancelDeparture(db, elsewhere.id, reef.id, nowDate())).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await statusOf(db, reef.id)).toBe("scheduled");
  });
});
