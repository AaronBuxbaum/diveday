import { describe, expect, it } from "vitest";
import {
  resolveWeekStart,
  shiftWeek,
  WEEK_PARAM,
  weekDates,
  weekIsWhollyUnpriced,
  weekStartOf,
} from "./week-board";

describe("the ?week= grammar", () => {
  it("names the parameter once, so a second surface cannot spell it differently", () => {
    // Slice 9e (the staffing week) pages the same dates through the same
    // parameter — ADR 20260827-clearwater-surface-language, decision 5.
    expect(WEEK_PARAM).toBe("week");
  });

  it("starts every week on Monday, whichever day it is handed", () => {
    // 2026-07-23 is a Thursday.
    expect(weekStartOf("2026-07-23")).toBe("2026-07-20");
    expect(weekStartOf("2026-07-20")).toBe("2026-07-20");
    // Sunday belongs to the week that has just ended, not the one starting
    // tomorrow: a dive shop's Saturday and Sunday are one weekend.
    expect(weekStartOf("2026-07-26")).toBe("2026-07-20");
  });

  it("crosses a month and a year without arithmetic of its own", () => {
    expect(weekStartOf("2026-03-01")).toBe("2026-02-23");
    expect(shiftWeek("2025-12-29", 1)).toBe("2026-01-05");
    expect(shiftWeek("2026-01-05", -1)).toBe("2025-12-29");
  });

  it("lists the seven days of a week, Monday first", () => {
    expect(weekDates("2026-07-20")).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
  });

  it("normalises any day of a week to that week, so two URLs are one board", () => {
    expect(resolveWeekStart("2026-07-23", "2026-07-21")).toBe("2026-07-20");
    expect(resolveWeekStart("2026-07-20", "2026-07-21")).toBe("2026-07-20");
  });

  it("lands on this week rather than refusing, for anything it cannot read", () => {
    // The parameter is a *reading* of the board, not a lookup: there is no
    // wrong week to land on, only a surprising one. A cursor, a date that
    // does not exist, and an outright injection attempt all resolve the same.
    for (const bad of [undefined, "", "next", "2026-02-31", "2026-13-01", "../../etc"]) {
      expect(resolveWeekStart(bad, "2026-07-23")).toBe("2026-07-20");
    }
  });
});

describe("the week's shared price fact", () => {
  const unpriced = (status: "upcoming" | "sailed" = "upcoming") => ({ status, priceCents: null });
  const priced = (status: "upcoming" | "sailed" = "upcoming") => ({ status, priceCents: 9500 });
  /** An empty seven-day record, the shape `weekBoard()` always returns. */
  const noDays = () => Object.fromEntries(weekDates("2026-08-24").map((iso) => [iso, []]));

  it("counts the spans, not only the day cells", () => {
    // The regression this pins. A multi-day course comes back as a *span* and
    // is never also dropped into the days it covers, so a week whose only
    // upcoming departures are three unpriced courses has no day cells at all.
    // Weighed on `days` alone it reads as nothing to say — no banner, and no
    // mark on the bars either, because they were absent from the very tally
    // that decides whether a mark is needed.
    expect(
      weekIsWhollyUnpriced({ days: noDays(), spans: [unpriced(), unpriced(), unpriced()] }),
    ).toBe(true);
    // Cells and bars are one week: two of one and one of the other is three
    // departures sharing one fact.
    expect(
      weekIsWhollyUnpriced({
        days: { ...noDays(), "2026-08-24": [unpriced(), unpriced()] },
        spans: [unpriced()],
      }),
    ).toBe(true);
    // And a priced course is enough to make it not a shared fact — the marks
    // then stay on the departures that lack a price.
    expect(
      weekIsWhollyUnpriced({
        days: { ...noDays(), "2026-08-24": [unpriced(), unpriced()] },
        spans: [priced()],
      }),
    ).toBe(false);
  });

  it("weighs only what is still to sail, on both sides of the question", () => {
    // A boat already home cannot be booked, so its missing price is nobody's
    // morning — it neither triggers the banner nor keeps it away.
    expect(
      weekIsWhollyUnpriced({
        days: { ...noDays(), "2026-08-24": [unpriced(), unpriced(), unpriced()] },
        spans: [priced("sailed")],
      }),
    ).toBe(true);
    expect(
      weekIsWhollyUnpriced({
        days: { ...noDays(), "2026-08-24": [unpriced(), unpriced()] },
        spans: [unpriced("sailed")],
      }),
    ).toBe(false);
  });

  it("stays quiet under three, where a banner says less than the marks it replaces", () => {
    expect(weekIsWhollyUnpriced({ days: noDays(), spans: [] })).toBe(false);
    expect(weekIsWhollyUnpriced({ days: noDays(), spans: [unpriced()] })).toBe(false);
    expect(
      weekIsWhollyUnpriced({
        days: { ...noDays(), "2026-08-24": [unpriced()] },
        spans: [unpriced()],
      }),
    ).toBe(false);
  });
});
