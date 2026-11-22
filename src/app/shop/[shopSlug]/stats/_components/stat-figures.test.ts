import { describe, expect, it } from "vitest";
import type { OwnerStats } from "@/features/reports/owner-stats";
import { staffTranslator } from "@/i18n/staff-messages";
import { statFigures, statsAreEmpty } from "./stat-figures";

const empty: OwnerStats = {
  repeat: { divers: 0, repeat: 0 },
  courses: [],
  medical: { cleared: 0, medianHours: null, waiting: 0 },
  waivers: { seats: 0, signedByDeparture: 0 },
  departures: { counted: 0, ready: 0 },
};

describe("statFigures", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    const t = staffTranslator(locale);

    it(`${locale}: reads dashes with no detail when nothing was counted`, () => {
      const figures = statFigures(empty, t);
      expect(figures.map((f) => f.value)).toEqual(["—", "—", "—", "—"]);
      expect(figures.every((f) => f.detail === undefined)).toBe(true);
      expect(statsAreEmpty(empty)).toBe(true);
    });

    it(`${locale}: reads zero percent as a real answer when seats were counted`, () => {
      const figures = statFigures(
        {
          ...empty,
          repeat: { divers: 4, repeat: 0 },
          waivers: { seats: 4, signedByDeparture: 0 },
        },
        t,
      );
      expect(figures[0]?.value).toBe("0%");
      expect(figures[1]?.value).toBe("0%");
    });
  }

  it("says hours under two days and days past them", () => {
    const t = staffTranslator("en-US");
    const read = (medianHours: number) =>
      statFigures({ ...empty, medical: { cleared: 3, medianHours, waiting: 0 } }, t)[3]?.value;
    expect(read(0.2)).toBe("1 hour");
    expect(read(16)).toBe("16 hours");
    expect(read(72)).toBe("3 days");
  });

  it("is not empty with only a medical review still open", () => {
    expect(
      statsAreEmpty({ ...empty, medical: { cleared: 0, medianHours: null, waiting: 1 } }),
    ).toBe(false);
  });
});
