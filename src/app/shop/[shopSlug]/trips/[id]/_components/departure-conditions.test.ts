import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { departureConditionReads } from "./departure-conditions";

const t = staffTranslator("en-US");

type Input = Parameters<typeof departureConditionReads>[0];

describe("departureConditionReads", () => {
  it("starts nothing on the Divers tab", async () => {
    const reads = departureConditionReads({
      showDetails: false,
      trip: { startsAt: new Date("2026-07-25T12:00:00Z") } as Input["trip"],
      tripDiveList: [],
      scheduleDayCount: 1,
      shop: { timezone: "America/New_York" } as Input["shop"],
      locale: "en-US",
      t,
    });
    expect(await reads.automatedForecast).toBeNull();
    expect(await reads.tideLines).toEqual([]);
  });

  it("reads no tide for a departure with no stationed site", async () => {
    const reads = departureConditionReads({
      showDetails: true,
      trip: {
        startsAt: new Date("2026-07-25T12:00:00Z"),
        plannedDives: 1,
        diveMode: "boat",
      } as Input["trip"],
      tripDiveList: [],
      scheduleDayCount: 1,
      shop: { timezone: "America/New_York" } as Input["shop"],
      locale: "en-US",
      t,
    });
    expect(await reads.automatedForecast).toBeNull();
    expect(await reads.tideLines).toEqual([]);
  });
});
