import { describe, expect, it } from "vitest";
import type { ExecutedDive } from "@/db/schema";
import { t } from "./diver-roll-call-test-fixtures";
import { executedDiveLabels, executedDiveLogView, executedDiveSummary } from "./executed-dive-copy";

const recorded = {
  executed: {
    diveNumber: 1,
    maxDepthMeters: 18,
    notRecorded: [],
    enteredAt: new Date("2026-09-11T12:05:00.000Z"),
    exitedAt: new Date("2026-09-11T12:47:00.000Z"),
  } as unknown as ExecutedDive,
  actualSite: { id: "site-reef", name: "Molasses Reef" },
};

describe("executedDiveSummary", () => {
  it("says a dive nobody recorded is not recorded yet", () => {
    expect(
      executedDiveSummary({
        diveLabel: "Dive 1",
        locale: "en-US",
        timeZone: "America/New_York",
        depthUnit: "meters",
        t,
      }),
    ).toBe(t("manifest.executedDive.summaryNotRecorded", { dive: "Dive 1" }));
  });

  it("joins the site, the depth in the shop's unit and the times", () => {
    const line = executedDiveSummary({
      diveLabel: "Dive 1",
      row: recorded,
      locale: "en-US",
      timeZone: "America/New_York",
      depthUnit: "feet",
      t,
    });
    expect(line).toContain("Molasses Reef");
    expect(line).toContain("ft");
    expect(line).toContain("8:05");
  });
});

describe("executedDiveLogView", () => {
  it("hands the dive log its plan, its sites and its words", () => {
    const view = executedDiveLogView({
      plannedDives: [
        { dive: { diveNumber: 1 }, diveSite: { id: "site-reef", name: "Molasses Reef" } },
      ] as never,
      executedDives: [recorded],
      liveDiveSites: [{ id: "site-reef", name: "Molasses Reef", extra: true } as never],
      catalogSpecies: [],
      speciesBySite: {},
      locale: "en-US",
      timeZone: "America/New_York",
      depthUnit: "meters",
      t,
    });
    expect(view.planned).toHaveLength(1);
    expect(view.planned[0]?.diveLabel).toBe(t("manifest.executedDive.dive", { number: 1 }));
    expect(view.liveDiveSites).toEqual([{ id: "site-reef", name: "Molasses Reef" }]);
    expect(view.labels).toEqual(executedDiveLabels(t, "meters"));
  });
});
