import { describe, expect, it } from "vitest";
import { upcomingTripsWithCounts } from "../../db/trips";
import { nowDate } from "../../lib/clock";
import { operationalWindow } from "../../lib/operational-window";
import { fileScopedShopContext } from "../../test/db";
import { blockedOnNextBoatDay, inHorizonReadiness } from "./store";

const ctx = fileScopedShopContext();

/**
 * Every case reads the clock the seed is anchored to. `new Date(0)` used to
 * work here because the readiness pass had no horizon at all — it does now
 * (the shared one), and 1970 has no departures inside it.
 */
const NOW = nowDate();

describe("in-horizon readiness (in-memory PGlite)", () => {
  it("never inspects a departure outside the shared operational horizon (task 141)", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
    // The demo shop has far fewer than `OPERATIONAL_MAX_TRIPS` departures in a
    // week, so the work bound never fires: departures beyond the horizon are
    // the window's business, not a truncation.
    expect((await inHorizonReadiness(db, shop.id, NOW)).truncated).toBe(false);
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

  it("counts a course on the day one of its later days falls on, and not on the days between (issue #2557)", () => {
    const course = trip("course", "2026-10-03T13:00:00Z"); // Saturday, day one
    const withDays = (entries: Parameters<typeof evidence>[0]) =>
      ({
        ...evidence(entries),
        meetingDays: new Map([
          [
            "course",
            [{ startsAt: at("2026-10-03T13:00:00Z") }, { startsAt: at("2026-10-17T13:00:00Z") }],
          ],
        ]),
      }) as unknown as Parameters<typeof blockedOnNextBoatDay>[0];
    // The second Saturday: today's boat, its blocked divers counted.
    expect(
      blockedOnNextBoatDay(withDays([[course, rows(2)]]), zone, at("2026-10-17T12:00:00Z")),
    ).toEqual({ day: "today", onDay: 2, aboard: 0, total: 2 });
    // A day between: nobody's boat today, and tomorrow is not a meeting day either.
    expect(
      blockedOnNextBoatDay(withDays([[course, rows(2)]]), zone, at("2026-10-10T12:00:00Z")),
    ).toEqual({ day: "tomorrow", onDay: 0, aboard: 0, total: 0 });
    // The eve of the second Saturday counts it as tomorrow's.
    expect(
      blockedOnNextBoatDay(withDays([[course, rows(2)]]), zone, at("2026-10-16T20:00:00Z")),
    ).toEqual({ day: "tomorrow", onDay: 2, aboard: 0, total: 2 });
  });

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
