import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { people, tripAssignments, tripStageEvents } from "./schema";
import { demoStageTaps } from "./seed-trip-stage";

/**
 * **The demo's taps sit where a crew would have made them, relative to the
 * departure** (UX review 2026-10-10, item 4). The seed used to stamp
 * "boarding" at the instant it ran, so a 6:30 PM boat read "Boarding since
 * 1:18 PM" all afternoon and the trip header said Aboard five hours early.
 */
describe("demoStageTaps", () => {
  const startsAt = new Date("2026-07-21T22:30:00.000Z"); // 6:30 PM EDT
  const endsAt = new Date("2026-07-22T02:00:00.000Z"); // 10:00 PM EDT
  const words = (now: Date) => demoStageTaps(startsAt, endsAt, now).map((tap) => tap.stage);

  it("says nothing about a boat whose boarding has not opened", () => {
    // Five hours out: nobody has tapped anything yet, so the demo must not.
    expect(demoStageTaps(startsAt, endsAt, new Date("2026-07-21T17:18:00.000Z"))).toEqual([]);
    // One minute before boarding opens.
    expect(words(new Date(startsAt.getTime() - 31 * MINUTE_MS))).toEqual([]);
  });

  it("opens boarding thirty minutes before the lines come off", () => {
    const now = new Date(startsAt.getTime() - 10 * MINUTE_MS);
    expect(demoStageTaps(startsAt, endsAt, now)).toEqual([
      { stage: "boarding", recordedAt: new Date(startsAt.getTime() - 30 * MINUTE_MS) },
    ]);
  });

  it("is underway from the moment she leaves, never stamped in the future", () => {
    const now = new Date(startsAt.getTime() + 45 * MINUTE_MS);
    const taps = demoStageTaps(startsAt, endsAt, now);
    expect(taps.map((tap) => tap.stage)).toEqual(["boarding", "underway"]);
    expect(taps[1]?.recordedAt.getTime()).toBe(startsAt.getTime());
    for (const tap of taps) expect(tap.recordedAt.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("brings a finished boat home after her return, not before", () => {
    const now = new Date(endsAt.getTime() + 120 * MINUTE_MS);
    const taps = demoStageTaps(startsAt, endsAt, now);
    expect(taps.map((tap) => tap.stage)).toEqual(["boarding", "underway", "home"]);
    const home = taps[2];
    expect(home?.recordedAt.getTime()).toBeGreaterThan(endsAt.getTime());
    expect(home?.recordedAt.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("keeps every tap in the order the crew would have made them", () => {
    const taps = demoStageTaps(startsAt, endsAt, new Date(endsAt.getTime() + 60 * MINUTE_MS));
    const times = taps.map((tap) => tap.recordedAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

/**
 * A tap is recorded by somebody on that boat (dive-domain review of the demo
 * layer): the seed stamped the shop's one captain on every departure, whoever
 * crewed it.
 */
describe("seedTripStage", () => {
  it("stamps each tap with a crew member of that departure", async () => {
    const { db, shop } = await seededShopContext();
    const taps = await db
      .select({ tripId: tripStageEvents.tripId, by: tripStageEvents.recordedByPersonId })
      .from(tripStageEvents)
      .where(eq(tripStageEvents.shopId, shop.id));
    expect(taps.length).toBeGreaterThan(0);
    for (const tap of taps) {
      const crew = await db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, tap.tripId));
      if (crew.length === 0) continue;
      expect(crew.map((member) => member.personId)).toContain(tap.by);
    }
  });

  it("picks the same recorder every time a departure has no captain", async () => {
    // Person ids are random, so a crew with nobody in the captain's role must
    // be read in name order or two seeds of the same shop disagree about who
    // tapped (the export snapshot did, run to run).
    const { db, shop } = await seededShopContext();
    const taps = await db
      .select({
        tripId: tripStageEvents.tripId,
        by: tripStageEvents.recordedByPersonId,
        seq: tripStageEvents.seq,
      })
      .from(tripStageEvents)
      .where(eq(tripStageEvents.shopId, shop.id));
    expect(taps.length).toBeGreaterThan(0);
    for (const tap of taps) {
      const crew = await db
        .select({
          personId: tripAssignments.personId,
          tripRole: tripAssignments.tripRole,
          fullName: people.fullName,
        })
        .from(tripAssignments)
        .innerJoin(people, eq(people.id, tripAssignments.personId))
        .where(eq(tripAssignments.tripId, tap.tripId));
      if (crew.length === 0) continue;
      const expected =
        crew.find((member) => member.tripRole === "captain") ??
        [...crew].sort((a, b) => (a.fullName < b.fullName ? -1 : 1))[0];
      expect(tap.by).toBe(expected?.personId);
    }
  });

  it("names the departure's captain on every stamp, never a deckhand", async () => {
    // A demo visitor reads "Home · Keiko Tanaka" on a boat whose captain is
    // Sal Moretti as a deckhand confirming the boat is home (issue #2503).
    const { db, shop } = await seededShopContext();
    const taps = await db
      .select({ tripId: tripStageEvents.tripId, by: tripStageEvents.recordedByPersonId })
      .from(tripStageEvents)
      .where(eq(tripStageEvents.shopId, shop.id));
    expect(taps.length).toBeGreaterThan(0);
    for (const tap of taps) {
      const crew = await db
        .select({ personId: tripAssignments.personId, tripRole: tripAssignments.tripRole })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, tap.tripId));
      // No crew at all is the one case the writer falls back to the shop's captain.
      if (crew.length === 0) continue;
      const captains = crew.filter((member) => member.tripRole === "captain");
      expect(
        captains.map((member) => member.personId),
        `trip ${tap.tripId}`,
      ).toContain(tap.by);
    }
  });
});
