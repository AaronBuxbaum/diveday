import { describe, expect, it } from "vitest";
import {
  digestWeeks,
  isWeeklyDigestDue,
  mondayOnOrBefore,
  overdueTodayActions,
  seatFillPercent,
  type WeeklyDigestFacts,
  weeklyDigestSections,
  weeklyDigestWanted,
} from "./weekly-digest";

const QUIET: WeeklyDigestFacts = {
  lastWeek: { bookingsMade: 0, departures: 0, seatsFilled: 0, seats: 0 },
  thisWeek: { departures: 0, seatsFilled: 0, seats: 0 },
  waiversOutstanding: { divers: 0, departures: 0 },
  reviews: { received: 0, awaitingModeration: 0 },
  dateRequestsWaiting: 0,
  overdueTodayItems: 0,
};

describe("mondayOnOrBefore", () => {
  it("keeps a Monday and walks every other day back to its own week's Monday", () => {
    expect(mondayOnOrBefore("2026-10-05")).toBe("2026-10-05");
    expect(mondayOnOrBefore("2026-10-07")).toBe("2026-10-05");
    // Sunday closes the week that began six days earlier, not the next one.
    expect(mondayOnOrBefore("2026-10-11")).toBe("2026-10-05");
    expect(mondayOnOrBefore("2026-10-12")).toBe("2026-10-12");
  });

  it("rolls across a month and a year", () => {
    expect(mondayOnOrBefore("2026-11-01")).toBe("2026-10-26");
    expect(mondayOnOrBefore("2027-01-01")).toBe("2026-12-28");
  });
});

describe("digestWeeks", () => {
  it("bounds last week and this week at the shop's own midnights", () => {
    // 08:00 Monday Oct 5 in New York (EDT, UTC-4).
    const weeks = digestWeeks(new Date("2026-10-05T12:00:00Z"), "America/New_York");
    expect(weeks.weekOf).toBe("2026-10-05");
    expect(weeks.lastWeek.from).toBe("2026-09-28");
    expect(weeks.lastWeek.to).toBe("2026-10-04");
    expect(weeks.lastWeek.startUtc.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(weeks.lastWeek.endUtc.toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(weeks.thisWeek.to).toBe("2026-10-11");
    expect(weeks.thisWeek.endUtc.toISOString()).toBe("2026-10-12T04:00:00.000Z");
  });

  it("files the week by the shop's calendar, not UTC's", () => {
    // Monday 01:00 UTC is still Sunday evening in New York: last week's Monday is
    // the week of, not today's.
    const weeks = digestWeeks(new Date("2026-10-12T01:00:00Z"), "America/New_York");
    expect(weeks.weekOf).toBe("2026-10-05");
    // And it is already Monday in Sydney.
    expect(digestWeeks(new Date("2026-10-11T20:00:00Z"), "Australia/Sydney").weekOf).toBe(
      "2026-10-12",
    );
  });

  it("keeps a week whose Sunday changes the clocks", () => {
    // Nov 1 2026 is the US fall-back Sunday; the week is 7 days and 1 hour long.
    const weeks = digestWeeks(new Date("2026-11-02T14:00:00Z"), "America/New_York");
    expect(weeks.lastWeek.startUtc.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(weeks.lastWeek.endUtc.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("isWeeklyDigestDue", () => {
  it("is due on a Monday inside the shop's sending hours", () => {
    expect(isWeeklyDigestDue(new Date("2026-10-05T12:00:00Z"), "America/New_York")).toBe(true);
    expect(isWeeklyDigestDue(new Date("2026-10-05T23:00:00Z"), "America/New_York")).toBe(true);
  });

  it("waits for 08:00 and stops at 20:00, shop time", () => {
    // 07:00 EDT and 20:00 EDT.
    expect(isWeeklyDigestDue(new Date("2026-10-05T11:00:00Z"), "America/New_York")).toBe(false);
    expect(isWeeklyDigestDue(new Date("2026-10-06T00:00:00Z"), "America/New_York")).toBe(false);
  });

  it("is never due on another day", () => {
    expect(isWeeklyDigestDue(new Date("2026-10-06T14:00:00Z"), "America/New_York")).toBe(false);
    expect(isWeeklyDigestDue(new Date("2026-10-04T14:00:00Z"), "America/New_York")).toBe(false);
  });

  it("reads Monday off the shop's calendar", () => {
    // Sunday 23:00 UTC is Monday 10:00 in Sydney (AEDT, UTC+11).
    expect(isWeeklyDigestDue(new Date("2026-10-11T23:00:00Z"), "Australia/Sydney")).toBe(true);
    expect(isWeeklyDigestDue(new Date("2026-10-11T23:00:00Z"), "America/New_York")).toBe(false);
  });
});

describe("weeklyDigestWanted", () => {
  it("defaults an owner on and everyone else off", () => {
    expect(weeklyDigestWanted(null, ["owner"])).toBe(true);
    expect(weeklyDigestWanted(null, ["manager", "owner"])).toBe(true);
    expect(weeklyDigestWanted(null, ["manager"])).toBe(false);
    expect(weeklyDigestWanted(null, ["divemaster"])).toBe(false);
    expect(weeklyDigestWanted(null, [])).toBe(false);
  });

  it("lets the person's own answer win over the default, both ways", () => {
    expect(weeklyDigestWanted(false, ["owner"])).toBe(false);
    expect(weeklyDigestWanted(true, ["captain"])).toBe(true);
  });
});

describe("overdueTodayActions", () => {
  const now = new Date("2026-10-05T12:00:00Z");

  it("counts work hanging off a departure that already left", () => {
    expect(
      overdueTodayActions(
        [
          { kind: "roll_call_departure_open", dueAt: new Date("2026-10-04T12:00:00Z") },
          { kind: "waiver", dueAt: new Date("2026-10-06T12:00:00Z") },
        ],
        now,
      ),
    ).toBe(1);
  });

  it("counts the kinds that are late by definition, with or without a date", () => {
    expect(
      overdueTodayActions(
        [
          { kind: "gear_overdue", dueAt: null },
          { kind: "owed_refund", dueAt: null },
          { kind: "stuck_payment_operation", dueAt: null },
          { kind: "failed_photo_deletion", dueAt: null },
        ],
        now,
      ),
    ).toBe(4);
  });

  it("leaves undated, not-yet-due work alone", () => {
    expect(
      overdueTodayActions(
        [
          { kind: "reviews_pending", dueAt: null },
          { kind: "unanswered_messages", dueAt: null },
          { kind: "gear_due_back", dueAt: null },
        ],
        now,
      ),
    ).toBe(0);
  });
});

describe("weeklyDigestSections", () => {
  it("says nothing for a shop with no activity and nothing coming up", () => {
    expect(weeklyDigestSections(QUIET)).toEqual([]);
  });

  it("keeps the reading order and only the sections with something to say", () => {
    const sections = weeklyDigestSections({
      ...QUIET,
      lastWeek: { bookingsMade: 4, departures: 2, seatsFilled: 9, seats: 12 },
      reviews: { received: 0, awaitingModeration: 2 },
      overdueTodayItems: 1,
    });
    expect(sections.map((section) => section.kind)).toEqual(["last_week", "reviews", "overdue"]);
    expect(sections[0]).toEqual({
      kind: "last_week",
      bookingsMade: 4,
      departures: 2,
      seatsFilled: 9,
      seats: 12,
    });
  });

  it("reports last week when bookings came in even though nothing sailed", () => {
    const sections = weeklyDigestSections({
      ...QUIET,
      lastWeek: { bookingsMade: 3, departures: 0, seatsFilled: 0, seats: 0 },
    });
    expect(sections.map((section) => section.kind)).toEqual(["last_week"]);
  });

  it("speaks for an off-season week with only the coming week on the board", () => {
    const sections = weeklyDigestSections({
      ...QUIET,
      thisWeek: { departures: 1, seatsFilled: 0, seats: 8 },
    });
    expect(sections).toEqual([{ kind: "this_week", departures: 1, seatsFilled: 0, seats: 8 }]);
  });

  it("orders every section when every one has something", () => {
    const sections = weeklyDigestSections({
      lastWeek: { bookingsMade: 1, departures: 1, seatsFilled: 1, seats: 1 },
      thisWeek: { departures: 1, seatsFilled: 1, seats: 2 },
      waiversOutstanding: { divers: 3, departures: 1 },
      reviews: { received: 2, awaitingModeration: 0 },
      dateRequestsWaiting: 2,
      overdueTodayItems: 5,
    });
    expect(sections.map((section) => section.kind)).toEqual([
      "last_week",
      "this_week",
      "waivers",
      "reviews",
      "date_requests",
      "overdue",
    ]);
  });
});

describe("seatFillPercent", () => {
  it("rounds to a whole percent", () => {
    expect(seatFillPercent(9, 12)).toBe(75);
    expect(seatFillPercent(1, 3)).toBe(33);
    expect(seatFillPercent(0, 8)).toBe(0);
  });

  it("has no percentage for a week with no seats", () => {
    expect(seatFillPercent(0, 0)).toBeNull();
  });
});
