import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { operationalWindow } from "@/lib/operational-window";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { blockedOnNextBoatDay, inHorizonReadiness } from "./blockers";
import { upsertTripRequirements } from "./readiness";
import { countBlockedDiversNextBoatDay } from "./today";
import { upcomingTripsWithCounts } from "./trips";

/**
 * Every case reads the clock the seed is anchored to. `new Date(0)` used to
 * work here because the readiness pass had no horizon at all — it does now
 * (the shared one), and 1970 has no departures inside it.
 */
const NOW = nowDate();

/** Blocked bookings on the shop-day `NOW` falls on, the way the badge counts them. */
function blockedToday(
  evidence: Awaited<ReturnType<typeof inHorizonReadiness>>,
  timeZone: string,
): number {
  const day = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  let blocked = 0;
  for (const trip of evidence.trips) {
    if (day(trip.startsAt) !== day(NOW)) continue;
    for (const row of evidence.readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.status === "blocked") blocked += 1;
    }
  }
  return blocked;
}

describe("in-horizon readiness (in-memory PGlite)", () => {
  it("never inspects a departure outside the shared operational horizon (task 141)", async () => {
    const { db, shop } = await seededShopContext();
    const { from, to } = operationalWindow(NOW);
    const evidence = await inHorizonReadiness(db, shop.id, NOW);

    expect(evidence.trips.length).toBeGreaterThan(0);
    for (const trip of evidence.trips) {
      expect(trip.startsAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(trip.startsAt.getTime()).toBeLessThanOrEqual(to.getTime());
    }
    // The seeded shop schedules well past the horizon, so this is a real cut,
    // not a window that happens to contain everything.
    const all = await upcomingTripsWithCounts(db, shop.id, NOW);
    expect(all.some((trip) => trip.startsAt.getTime() > to.getTime())).toBe(true);
  });

  it("stays inside the horizon rather than flagging the tail as truncated", async () => {
    const { db, shop } = await seededShopContext();
    // The demo shop has far fewer than `OPERATIONAL_MAX_TRIPS` departures in a
    // week, so the work bound never fires: departures beyond the horizon are
    // the window's business, not a truncation.
    expect((await inHorizonReadiness(db, shop.id, NOW)).truncated).toBe(false);
  });

  it("the badge counts today's blocked divers while today's boats are still to sail (nav badge, UX audit item 1)", async () => {
    const { db, shop } = await seededShopContext();
    const expected = blockedToday(await inHorizonReadiness(db, shop.id, NOW), shop.timezone);
    expect(expected).toBeGreaterThan(0);

    const badge = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone, NOW);
    expect(badge.day).toBe("today");
    expect(badge.onDay).toBe(expected);
    expect(badge.total).toBe(expected + badge.aboard);
  });

  it("the badge drops when a departure's blockers are cleared", async () => {
    const { db, shop } = await seededShopContext();
    const before = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone, NOW);
    const trips = await upcomingTripsWithCounts(db, shop.id, NOW);
    const target = trips[0];
    if (!target) throw new Error("expected an upcoming trip");
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: target.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });

    const after = await countBlockedDiversNextBoatDay(db, shop.id, shop.timezone, NOW);
    expect(after.onDay).toBeLessThanOrEqual(before.onDay);
    expect(after.onDay).toBe(
      blockedToday(await inHorizonReadiness(db, shop.id, NOW), shop.timezone),
    );
  });
});

describe("blockedOnNextBoatDay", () => {
  // 2026-10-07 in Key Largo (UTC-4): 4 PM local is 20:00Z.
  const zone = "America/New_York";
  const at = (iso: string) => new Date(iso);
  const trip = (id: string, startsAt: string) => ({ id, startsAt: at(startsAt) });
  const rows = (blocked: number, ready = 0) => [
    ...Array.from({ length: blocked }, () => ({ readiness: { status: "blocked" } })),
    ...Array.from({ length: ready }, () => ({ readiness: { status: "ready" } })),
  ];
  function evidence(entries: [ReturnType<typeof trip>, ReturnType<typeof rows>][]) {
    return {
      trips: entries.map(([t]) => t),
      readinessByTrip: new Map(entries.map(([t, r]) => [t.id, r])),
    } as unknown as Parameters<typeof blockedOnNextBoatDay>[0];
  }

  it("counts today's boats while one is still inside the horizon, not tomorrow's", () => {
    const counted = blockedOnNextBoatDay(
      evidence([
        [trip("noon", "2026-10-07T16:00:00Z"), rows(2, 3)],
        [trip("dawn", "2026-10-08T11:00:00Z"), rows(5)],
      ]),
      zone,
      at("2026-10-07T15:00:00Z"),
    );
    expect(counted).toEqual({ day: "today", onDay: 2, aboard: 0, total: 2 });
  });

  it("at 4 PM with today's boats in, counts tomorrow's dawn boat instead of reading 0", () => {
    const counted = blockedOnNextBoatDay(
      evidence([
        [trip("dawn", "2026-10-08T11:00:00Z"), rows(1)],
        [trip("noon-tomorrow", "2026-10-08T16:00:00Z"), rows(2)],
        [trip("thursday", "2026-10-09T11:00:00Z"), rows(7)],
      ]),
      zone,
      at("2026-10-07T20:00:00Z"),
    );
    expect(counted).toEqual({ day: "tomorrow", onDay: 3, aboard: 0, total: 3 });
  });

  it("adds divers blocked aboard a boat still out, whichever day it counts", () => {
    const tomorrowOnly = evidence([[trip("dawn", "2026-10-08T11:00:00Z"), rows(1)]]);
    expect(blockedOnNextBoatDay(tomorrowOnly, zone, at("2026-10-07T20:00:00Z"), 2)).toEqual({
      day: "tomorrow",
      onDay: 1,
      aboard: 2,
      total: 3,
    });
    expect(blockedOnNextBoatDay(evidence([]), zone, at("2026-10-07T20:00:00Z"), 1).total).toBe(1);
  });

  it("reads the day in the shop's zone, not UTC", () => {
    // 01:00Z on the 8th is 9 PM on the 7th in New York: still today.
    const counted = blockedOnNextBoatDay(
      evidence([[trip("night", "2026-10-08T01:00:00Z"), rows(1)]]),
      zone,
      at("2026-10-07T23:30:00Z"),
    );
    expect(counted.day).toBe("today");
    expect(counted.onDay).toBe(1);
  });
});
