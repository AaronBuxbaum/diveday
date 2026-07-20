import { describe, expect, it } from "vitest";
import { dockDayTimeline } from "./diver-planning";

describe("diver planning", () => {
  it("gives dock times relative to the trip start", () => {
    const start = new Date("2026-07-18T12:00:00Z");
    expect(dockDayTimeline(start)[0]?.at.toISOString()).toBe("2026-07-18T11:30:00.000Z");
  });
});
