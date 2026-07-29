import { describe, expect, it } from "vitest";
import {
  conditionsChangedSinceBooking,
  dockDayTimeline,
  packingConfidence,
  siteFit,
} from "./diver-planning";

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

  it("ends a full dock-day timeline at the expected return", () => {
    const start = new Date("2026-07-18T12:00:00Z");
    const end = new Date("2026-07-18T17:00:00Z");
    const timeline = dockDayTimeline(start, 30, end);
    expect(timeline.map(({ label }) => label)).toContain("Surface interval and second briefing");
    expect(timeline.at(-1)?.at).toEqual(end);
  });
});

describe("booking delight planning", () => {
  it("explains site fit from evidence without turning it into a gate", () => {
    expect(
      siteFit({ difficulty: "advanced", depthRange: "25–30 m", currentNote: "strong current" })
        .label,
    ).toBe("Best with recent experience");
    expect(
      siteFit({ difficulty: "beginner", depthRange: "8–12 m", currentNote: "gentle" }).label,
    ).toBe("Welcoming dive");
  });

  it("separates what a diver brings from requested rental gear", () => {
    const plan = packingConfidence(
      ["Swimsuit", "Certification card"],
      { rentsBcd: true, rentsWetsuit: false },
      18,
    );
    expect(plan.bring).toContain("Swimsuit");
    expect(plan.rented).toEqual(["BCD"]);
    expect(plan.temperatureTip).toContain("18°C");
  });

  it("only calls a newer crew briefing a change", () => {
    const booked = new Date("2026-07-18T10:00:00Z");
    expect(conditionsChangedSinceBooking(new Date("2026-07-18T11:00:00Z"), booked)).toBe(true);
    expect(conditionsChangedSinceBooking(booked, booked)).toBe(false);
  });
});
