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
  seasonLensForDay,
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

/**
 * The write-side reader (issue #1492). Its own tests rather than leaning on
 * `liveSeasonEvents`': that helper's ordering was written for the storefront
 * band, and if a later change re-orders it for the band, the *default a
 * departure is created with* must fail loudly here rather than change in
 * silence.
 */
describe("seasonLensForDay", () => {
  const window = (startsOn: string, endsOn: string, lensId: string | null) => ({
    startsOn,
    endsOn,
    lens: lensId === null ? null : { id: lensId },
  });

  it("answers the live season's kind of day, on either edge of the window", () => {
    const seasons = [window("2026-07-01", "2026-07-31", "after-dark")];
    expect(seasonLensForDay(seasons, "2026-07-01")).toBe("after-dark");
    expect(seasonLensForDay(seasons, "2026-07-15")).toBe("after-dark");
    expect(seasonLensForDay(seasons, "2026-07-31")).toBe("after-dark");
  });

  it("answers null on a day no season covers", () => {
    const seasons = [window("2026-07-01", "2026-07-31", "after-dark")];
    expect(seasonLensForDay(seasons, "2026-06-30")).toBeNull();
    expect(seasonLensForDay(seasons, "2026-08-01")).toBeNull();
  });

  it("is not shadowed by a live season that names no kind of day", () => {
    // The case `[0]` gets wrong, and it is the demo shop's own calendar: a
    // lensless "Coral spawning" ending in two days sits ahead of a
    // lens-carrying "Turtle nesting" in soonest-to-end order, so reading the
    // first live season would default every departure to null on the very data
    // the feature ships with.
    const seasons = [
      window("2026-07-01", "2026-07-03", null),
      window("2026-06-01", "2026-09-10", "after-dark"),
    ];
    expect(seasonLensForDay(seasons, "2026-07-02")).toBe("after-dark");
  });

  it("takes the soonest to end among the seasons that answer", () => {
    const seasons = [
      window("2026-06-01", "2026-09-10", "easygoing-reef"),
      window("2026-07-01", "2026-07-20", "after-dark"),
    ];
    expect(seasonLensForDay(seasons, "2026-07-02")).toBe("after-dark");
  });

  it("answers null when the only covering season's kind of day was deleted", () => {
    // Deleting a kind of day is soft and leaves a live id in
    // `season_events.lens_id`; the joined read is what reports it as gone. A
    // default off the raw column would label a departure with a word the
    // public rail no longer renders.
    expect(seasonLensForDay([window("2026-07-01", "2026-07-31", null)], "2026-07-15")).toBeNull();
  });
});
