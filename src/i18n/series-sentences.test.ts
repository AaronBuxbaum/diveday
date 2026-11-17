import { describe, expect, it } from "vitest";
import { repeatsRowText } from "./series-sentences";
import { staffTranslator } from "./staff-messages";

const SATURDAYS = 1 << 6;
const run = {
  intervalWeeks: 1,
  weekdayMask: SATURDAYS as never,
  endsOn: null,
  futureScheduledCount: 4,
  yardLine: null,
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

describe("repeatsRowText: the yard line, issues 3988 and 4010", () => {
  const withYard = (leftOff: string[], onBoard: string[] = []) => ({
    ...run,
    standingCrewNames: [],
    yardLine: {
      boat: "Reef Runner",
      from: "2031-01-06",
      until: "2031-01-31",
      leftOff,
      onBoard,
    } as never,
  });

  it("says nothing when the run has no yard line", () => {
    const text = repeatsRowText(staffTranslator("en-US"), "en-US", {
      ...run,
      standingCrewNames: [],
    });
    expect(text).not.toMatch(/yard/);
  });

  it("names the hull, the window's last day and the dates kept off the board", () => {
    const text = repeatsRowText(
      staffTranslator("en-US"),
      "en-US",
      withYard(["2031-01-08", "2031-01-15"]),
    );
    expect(text).toMatch(
      /Reef Runner is in the yard from Jan\s6,\s2031 through Jan\s31,\s2031\. Left off the board: Jan\s8,\s2031 and Jan\s15,\s2031\./,
    );
    expect(text).not.toContain("Still on the board");
  });

  it("names the weeks still on the board inside the window, and what to do", () => {
    const text = repeatsRowText(staffTranslator("en-US"), "en-US", withYard([], ["2031-01-22"]));
    expect(text).toMatch(
      /Reef Runner is in the yard from Jan\s6,\s2031 through Jan\s31,\s2031\. Still on the board: Jan\s22,\s2031\. Move them or pick another boat\./,
    );
    expect(text).not.toContain("Left off");
  });

  it("names the first three and counts the rest", () => {
    const text = repeatsRowText(
      staffTranslator("en-US"),
      "en-US",
      withYard(["2031-01-08", "2031-01-15", "2031-01-22", "2031-01-29", "2031-02-05"]),
    );
    expect(text).toMatch(/Jan\s22,\s2031, and 2 more\./);
  });

  it("says it in Spanish", () => {
    const text = repeatsRowText(
      staffTranslator("es-ES"),
      "es-ES",
      withYard(["2031-01-08"], ["2031-01-22"]),
    );
    expect(text).toContain("Reef Runner está en el astillero del");
    expect(text).toContain("Fuera del calendario:");
    expect(text).toContain("Aún en el calendario:");
  });
});
