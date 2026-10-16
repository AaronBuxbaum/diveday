import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { repeatsRowText } from "./details-rows";

const SATURDAYS = 1 << 6;
const run = {
  intervalWeeks: 1,
  weekdayMask: SATURDAYS as never,
  endsOn: null,
  futureScheduledCount: 4,
};

describe("repeatsRowText: a run's standing crew", () => {
  it("names two crew in the locale's list and says they crew every date", () => {
    const text = repeatsRowText(staffTranslator("en-US"), "en-US", {
      ...run,
      standingCrewNames: ["Dana", "Luis"],
    });
    expect(text).toContain("Dana and Luis crew every date.");
  });

  it("agrees with a single crew member, in Spanish too", () => {
    expect(
      repeatsRowText(staffTranslator("en-US"), "en-US", { ...run, standingCrewNames: ["Dana"] }),
    ).toContain("Dana crews every date.");
    expect(
      repeatsRowText(staffTranslator("es-ES"), "es-ES", {
        ...run,
        standingCrewNames: ["Dana", "Luis"],
      }),
    ).toContain("Dana y Luis tripulan todas las fechas.");
  });

  it("says nothing about crew when the run has none", () => {
    const text = repeatsRowText(staffTranslator("en-US"), "en-US", {
      ...run,
      standingCrewNames: [],
    });
    expect(text).not.toMatch(/crew/i);
  });
});
