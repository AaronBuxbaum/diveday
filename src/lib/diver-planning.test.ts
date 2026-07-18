import { describe, expect, it } from "vitest";
import { dockDayTimeline, fitMessage, packingChecklist } from "./diver-planning";

describe("diver planning", () => {
  it("adds a cooler-water item without pretending to reserve gear", () => {
    expect(packingChecklist(23, "Gentle chop")).toEqual(
      expect.arrayContaining([
        "Exposure protection suited to cooler water",
        "Secure any loose gear for the boat ride",
      ]),
    );
  });

  it("gives dock times relative to the trip start", () => {
    const start = new Date("2026-07-18T12:00:00Z");
    expect(dockDayTimeline(start)[0]?.at.toISOString()).toBe("2026-07-18T11:30:00.000Z");
  });

  it("keeps the fit explanation factual", () => {
    expect(fitMessage("beginner", "6–12 m", "Little current expected")).toBe(
      "Beginner · 6–12 m · Little current expected",
    );
  });
});
