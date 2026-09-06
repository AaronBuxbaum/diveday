import { describe, expect, it } from "vitest";
import { type WeekdayDeparture, weekdayPattern } from "./weekday-pattern";

const SATURDAYS = [
  "2026-07-18",
  "2026-07-25",
  "2026-08-01",
  "2026-08-08",
  "2026-08-15",
  "2026-08-22",
];

function reef(date: string, overrides: Partial<WeekdayDeparture> = {}): WeekdayDeparture {
  return {
    date,
    startTime: "07:00",
    endTime: "10:30",
    title: "Two-Tank Reef — Molasses & French",
    diveSiteId: "site-molasses",
    boatId: "boat-mantis",
    capacity: 12,
    priceCents: 9500,
    lensId: "lens-easygoing",
    diveMode: "boat",
    crewPersonIds: ["keiko", "sal"],
    ...overrides,
  };
}

function wreck(date: string): WeekdayDeparture {
  return reef(date, {
    startTime: "13:00",
    endTime: "17:00",
    title: "Wreck Trip — Spiegel Grove",
    diveSiteId: "site-spiegel",
    capacity: 10,
    priceCents: 14500,
    lensId: null,
  });
}

/** ADR 20260906-before-you-ask, decision 3: the add panel already knows the weekday. */
describe("weekdayPattern", () => {
  it("reads the six Saturdays the canvas drew: the 7:00 reef with its crew, and the wreck as one row", () => {
    const rows = [
      ...SATURDAYS.map((date) => reef(date)),
      ...SATURDAYS.slice(0, 4).map((date) => wreck(date)),
    ];
    expect(weekdayPattern(rows)).toEqual({
      sampledDays: 6,
      days: 6,
      startTime: "07:00",
      endTime: "10:30",
      title: "Two-Tank Reef — Molasses & French",
      diveSiteId: "site-molasses",
      boatId: "boat-mantis",
      capacity: 12,
      priceCents: 9500,
      lensId: "lens-easygoing",
      diveMode: "boat",
      crewPersonIds: ["keiko", "sal"],
      alsoUsual: {
        startTime: "13:00",
        days: 4,
        endTime: "17:00",
        title: "Wreck Trip — Spiegel Grove",
        diveSiteId: "site-spiegel",
        boatId: "boat-mantis",
        capacity: 10,
        priceCents: 14500,
        lensId: null,
        diveMode: "boat",
        crewPersonIds: ["keiko", "sal"],
      },
    });
  });

  it("is nothing on a shop with fewer than three such days", () => {
    expect(weekdayPattern(SATURDAYS.slice(0, 2).map((date) => reef(date)))).toBeNull();
    expect(weekdayPattern([])).toBeNull();
  });

  it("leaves a field empty when the days disagree, and never guesses", () => {
    const rows = SATURDAYS.map((date, index) =>
      reef(date, {
        priceCents: [9500, 9500, 11000, 11000, 12000, 12500][index] ?? null,
        crewPersonIds: index < 2 ? ["keiko", "sal"] : ["keiko"],
      }),
    );
    const pattern = weekdayPattern(rows);
    expect(pattern?.priceCents).toBeNull();
    expect(pattern?.title).toBe("Two-Tank Reef — Molasses & French");
    // Keiko ran every one; Sal only two, so Sal is not offered.
    expect(pattern?.crewPersonIds).toEqual(["keiko"]);
  });

  it("offers no second boat when it ran on fewer than three of the days", () => {
    const rows = [
      ...SATURDAYS.map((date) => reef(date)),
      wreck(SATURDAYS[0] ?? ""),
      wreck(SATURDAYS[1] ?? ""),
    ];
    expect(weekdayPattern(rows)?.alsoUsual).toBeNull();
  });

  it("takes the start time most days carried, not the earliest", () => {
    const rows = [
      ...SATURDAYS.slice(0, 3).map((date) => reef(date)),
      ...SATURDAYS.map((date) => wreck(date)),
    ];
    const pattern = weekdayPattern(rows);
    expect(pattern?.startTime).toBe("13:00");
    expect(pattern?.alsoUsual?.startTime).toBe("07:00");
    expect(pattern?.alsoUsual?.days).toBe(3);
  });
});
