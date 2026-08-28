import { describe, expect, it } from "vitest";
import { resolveWeekStart, shiftWeek, WEEK_PARAM, weekDates, weekStartOf } from "./week-board";

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
