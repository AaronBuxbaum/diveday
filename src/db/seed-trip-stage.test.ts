import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
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
