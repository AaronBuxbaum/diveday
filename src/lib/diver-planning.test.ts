import { describe, expect, it } from "vitest";
import { dockDayTimeline } from "./diver-planning";

describe("diver planning", () => {
  it("gives dock times relative to the trip start", () => {
    const start = new Date("2026-07-18T12:00:00Z");
    expect(dockDayTimeline(start)[0]?.at.toISOString()).toBe("2026-07-18T11:30:00.000Z");
  });

  it("uses the shop's dock call time for the arrival step", () => {
    const start = new Date("2026-07-18T12:00:00Z");
    const timeline = dockDayTimeline(start, 45);
    expect(timeline[0]?.at.toISOString()).toBe("2026-07-18T11:15:00.000Z");
    // The briefing never lands before the arrival, even for a short call time.
    const short = dockDayTimeline(start, 10);
    expect(short[1]?.at.getTime()).toBeGreaterThanOrEqual(short[0]?.at.getTime() ?? 0);
  });
});
