import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "./calendar-date";
import {
  daysUntilSeasonEvent,
  isSeasonEventLive,
  liveSeasonEvents,
  SEASON_EVENT_NAME_MAX,
  SEASON_EVENT_NOTE_MAX,
  seasonEventIssues,
  seasonEventNeedsReminder,
  seasonEventState,
} from "./season-events";

/** Lobster mini-season 2026: the last Wednesday and Thursday of July. */
const miniSeason = { startsOn: "2026-07-29", endsOn: "2026-07-30" };
/** Turtle nesting, the long window a two-day season sits inside. */
const nesting = { startsOn: "2026-03-01", endsOn: "2026-10-31" };

describe("seasonEventState", () => {
  it("is live on both ends of the window", () => {
    expect(seasonEventState(miniSeason, "2026-07-29")).toBe("live");
    expect(seasonEventState(miniSeason, "2026-07-30")).toBe("live");
  });

  it("is upcoming the day before and over the day after", () => {
    expect(seasonEventState(miniSeason, "2026-07-28")).toBe("upcoming");
    expect(seasonEventState(miniSeason, "2026-07-31")).toBe("over");
  });

  it("treats a one-day derby as a real window", () => {
    const derby = { startsOn: "2026-08-15", endsOn: "2026-08-15" };
    expect(isSeasonEventLive(derby, "2026-08-15")).toBe(true);
    expect(isSeasonEventLive(derby, "2026-08-16")).toBe(false);
  });
});

describe("the shop's own day is the one that decides", () => {
  /**
   * The failure this pins: a Key Largo shop's mini-season closes at midnight in
   * Key Largo, not at 8pm because a UTC server has already rolled over. Same
   * instant, two answers, and only one of them is the one the shop's storefront
   * should be showing.
   */
  it("is still live at 8pm on the last evening in the shop's zone", () => {
    const instant = new Date("2026-07-31T01:30:00.000Z"); // 9:30pm July 30 in Key Largo
    expect(isSeasonEventLive(miniSeason, calendarDateInTimezone(instant, "America/New_York"))).toBe(
      true,
    );
    expect(isSeasonEventLive(miniSeason, calendarDateInTimezone(instant, "UTC"))).toBe(false);
  });
});

describe("the month-out reminder", () => {
  it("fires inside the horizon and stays quiet outside it", () => {
    expect(seasonEventNeedsReminder(miniSeason, "2026-07-05")).toBe(true);
    expect(seasonEventNeedsReminder(miniSeason, "2026-06-01")).toBe(false);
  });

  it("stops the day the season opens", () => {
    expect(seasonEventNeedsReminder(miniSeason, "2026-07-28")).toBe(true);
    expect(seasonEventNeedsReminder(miniSeason, "2026-07-29")).toBe(false);
    expect(seasonEventNeedsReminder(miniSeason, "2026-08-05")).toBe(false);
  });

  it("counts the days to the opening", () => {
    expect(daysUntilSeasonEvent(miniSeason, "2026-07-01")).toBe(28);
    expect(daysUntilSeasonEvent(miniSeason, "2026-07-29")).toBe(0);
  });
});

describe("liveSeasonEvents", () => {
  it("leads with the window that ends soonest", () => {
    const live = liveSeasonEvents([nesting, miniSeason], "2026-07-30");
    expect(live).toEqual([miniSeason, nesting]);
  });

  it("drops the windows today is outside", () => {
    expect(liveSeasonEvents([nesting, miniSeason], "2026-07-01")).toEqual([nesting]);
    expect(liveSeasonEvents([nesting, miniSeason], "2026-12-01")).toEqual([]);
  });
});

describe("seasonEventIssues", () => {
  const good = {
    name: "Lobster mini-season",
    note: "Two days, and the reef is busy. Book early.",
    startsOn: "2026-07-29",
    endsOn: "2026-07-30",
  };

  it("passes a season a shop actually wrote", () => {
    expect(seasonEventIssues(good)).toEqual([]);
  });

  it("refuses a nameless season", () => {
    expect(seasonEventIssues({ ...good, name: "   " })).toEqual(["name_required"]);
  });

  it("refuses words longer than the columns are read at", () => {
    expect(seasonEventIssues({ ...good, name: "x".repeat(SEASON_EVENT_NAME_MAX + 1) })).toEqual([
      "name_too_long",
    ]);
    expect(seasonEventIssues({ ...good, note: "x".repeat(SEASON_EVENT_NOTE_MAX + 1) })).toEqual([
      "note_too_long",
    ]);
  });

  it("refuses a day that is not on the calendar", () => {
    expect(seasonEventIssues({ ...good, startsOn: "2026-02-31" })).toContain("starts_on_invalid");
    expect(seasonEventIssues({ ...good, endsOn: "" })).toContain("ends_on_invalid");
  });

  /**
   * The table's CHECK constraint refuses this too, but a constraint violation
   * reaches a staffer as a 500 rather than as the field turning red.
   */
  it("refuses a window that ends before it starts", () => {
    expect(seasonEventIssues({ ...good, startsOn: "2026-07-30", endsOn: "2026-07-29" })).toEqual([
      "ends_before_starts",
    ]);
  });

  it("says nothing about the order when a date is unreadable", () => {
    expect(seasonEventIssues({ ...good, endsOn: "nope" })).toEqual(["ends_on_invalid"]);
  });
});
