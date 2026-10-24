import { describe, expect, it } from "vitest";
import {
  digestWeeks,
  isWeeklyDigestDue,
  mondayOnOrBefore,
  NO_EMERGENCY_READS,
  NO_SAFETY,
  noMoney,
  overdueTodayActions,
  seatFillPercent,
  WEEKLY_DIGEST_CRON_CRONTAB,
  type WeeklyDigestFacts,
  weakestDeparture,
  weeklyDigestGrade,
  weeklyDigestMayBeDueSomewhere,
  weeklyDigestSections,
  weeklyDigestWanted,
} from "./weekly-digest";

const EMERGENCY_READ = {
  diver: "Ana Ruiz",
  departureTitle: "Dawn Two-Tank",
  departureStartsAt: new Date("2026-07-15T11:00:00.000Z"),
  reader: "Sal Captain",
  at: new Date("2026-07-15T12:40:00.000Z"),
};

const QUIET: WeeklyDigestFacts = {
  lastWeek: { bookingsMade: 0, departures: 0, seatsFilled: 0, seats: 0 },
  thisWeek: { departures: 0, seatsFilled: 0, seats: 0, weakest: null },
  waiversOutstanding: { divers: 0, departures: 0 },
  reviews: { received: 0, awaitingModeration: 0 },
  dateRequestsWaiting: 0,
  overdueTodayItems: 0,
  money: {
    revenueCents: 0,
    lastYearRevenueCents: null,
    tipsCents: 0,
    owed: { orderCents: 0, orderCount: 0, seatCents: 0, seatCount: 0 },
    currency: "usd",
  },
  gearServiceDue: 0,
  safety: NO_SAFETY,
  emergencyReads: NO_EMERGENCY_READS,
};

const ONE_READ = {
  total: 1,
  byReader: [{ reader: "Sal Captain", count: 1 }],
  listed: [EMERGENCY_READ],
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

describe("weeklyDigestMayBeDueSomewhere", () => {
  it("opens when the earliest zone reaches Monday 08:00 and closes when the latest leaves 20:00", () => {
    // Monday 08:00 at UTC+14 is Sunday 18:00 UTC; Monday 20:00 at UTC−12 is
    // Tuesday 08:00 UTC.
    expect(weeklyDigestMayBeDueSomewhere(new Date("2026-10-11T17:59:00Z"))).toBe(false);
    expect(weeklyDigestMayBeDueSomewhere(new Date("2026-10-11T18:00:00Z"))).toBe(true);
    expect(weeklyDigestMayBeDueSomewhere(new Date("2026-10-12T12:00:00Z"))).toBe(true);
    expect(weeklyDigestMayBeDueSomewhere(new Date("2026-10-13T07:59:00Z"))).toBe(true);
    expect(weeklyDigestMayBeDueSomewhere(new Date("2026-10-13T08:00:00Z"))).toBe(false);
  });

  it("is false on the four days no zone is in its Monday", () => {
    for (const iso of [
      "2026-10-14T12:00:00Z",
      "2026-10-15T00:00:00Z",
      "2026-10-16T23:00:00Z",
      "2026-10-17T12:00:00Z",
    ]) {
      expect(weeklyDigestMayBeDueSomewhere(new Date(iso))).toBe(false);
    }
  });

  /**
   * The property the route's skip rests on: whenever a shop in any zone is due,
   * the gate is open. Swept hour by hour over a week, across zones from the
   * earliest to the latest offset in use.
   */
  it("is never closed while some shop is due", () => {
    const zones = [
      "Pacific/Kiritimati",
      "Pacific/Auckland",
      "Australia/Sydney",
      "Asia/Singapore",
      "Europe/London",
      "America/New_York",
      "America/Los_Angeles",
      "Pacific/Honolulu",
      "Pacific/Pago_Pago",
      "Etc/GMT+12",
    ];
    const start = Date.parse("2026-10-10T00:00:00Z");
    for (let hour = 0; hour < 24 * 8; hour += 1) {
      const now = new Date(start + hour * 3_600_000);
      if (zones.some((zone) => isWeeklyDigestDue(now, zone))) {
        expect(weeklyDigestMayBeDueSomewhere(now), now.toISOString()).toBe(true);
      }
    }
  });

  it("is scheduled only on the UTC days the gate can open", () => {
    // Sunday to Tuesday, UTC: the span above, and nothing wider.
    expect(WEEKLY_DIGEST_CRON_CRONTAB.split(" ")[4]).toBe("0-2");
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
      thisWeek: { departures: 1, seatsFilled: 0, seats: 8, weakest: null },
    });
    expect(sections).toEqual([
      { kind: "this_week", departures: 1, seatsFilled: 0, seats: 8, weakest: null },
    ]);
  });

  it("orders every section when every one has something", () => {
    const sections = weeklyDigestSections({
      lastWeek: { bookingsMade: 1, departures: 1, seatsFilled: 1, seats: 1 },
      thisWeek: { departures: 1, seatsFilled: 1, seats: 2, weakest: null },
      waiversOutstanding: { divers: 3, departures: 1 },
      reviews: { received: 2, awaitingModeration: 0 },
      dateRequestsWaiting: 2,
      overdueTodayItems: 5,
      money: {
        revenueCents: 412_000,
        lastYearRevenueCents: null,
        tipsCents: 39_500,
        owed: { orderCents: 128_300, orderCount: 2, seatCents: 0, seatCount: 0 },
        currency: "usd",
      },
      gearServiceDue: 2,
      safety: { openRollCalls: 1, uncrewed: 0, incidents: 0 },
      emergencyReads: ONE_READ,
    });
    expect(sections.map((section) => section.kind)).toEqual([
      "last_week",
      "money",
      "this_week",
      "waivers",
      "safety",
      "emergency_reads",
      "reviews",
      "date_requests",
      "overdue",
      "gear_service",
    ]);
  });
});

/**
 * **What the week made, for whoever may read the money** (third UX review,
 * item 33). The Monday email carried bookings and seats and never a dollar;
 * the money section is built from the Reports grade's facts only, and the
 * staff grade's are zero, so a crew member's email never has it.
 */
describe("the money section", () => {
  it("says what last week took, the tips to pass on and what the shop is owed", () => {
    const money = {
      revenueCents: 412_000,
      lastYearRevenueCents: 358_000,
      tipsCents: 39_500,
      owed: { orderCents: 128_300, orderCount: 2, seatCents: 0, seatCount: 0 },
      currency: "usd",
    };
    const sections = weeklyDigestSections({ ...QUIET, money });
    expect(sections).toEqual([{ kind: "money", ...money }]);
  });

  it("is built from what is owed alone in a week nothing sailed", () => {
    const sections = weeklyDigestSections({
      ...QUIET,
      money: {
        revenueCents: 0,
        lastYearRevenueCents: null,
        tipsCents: 0,
        owed: { orderCents: 0, orderCount: 0, seatCents: 9_500, seatCount: 1 },
        currency: "usd",
      },
    });
    expect(sections.map((section) => section.kind)).toEqual(["money"]);
  });

  it("is never built from the staff grade's money", () => {
    expect(weeklyDigestSections({ ...QUIET, money: noMoney("usd") })).toEqual([]);
  });
});

/**
 * **The owner's gear line and safety sentence** (fourth UX review, item 24):
 * each only when it has something to say, and never from the staff grade,
 * whose facts are zero.
 */
describe("the gear and safety sections", () => {
  it("says how many units are due for service", () => {
    expect(weeklyDigestSections({ ...QUIET, gearServiceDue: 2 })).toEqual([
      { kind: "gear_service", due: 2 },
    ]);
  });

  it("carries roll calls left open, boats with no crew and incidents filed", () => {
    const safety = { openRollCalls: 0, uncrewed: 2, incidents: 1 };
    expect(weeklyDigestSections({ ...QUIET, safety })).toEqual([{ kind: "safety", ...safety }]);
  });

  it("says nothing when the week was safe and the gear is in date", () => {
    expect(weeklyDigestSections({ ...QUIET, safety: NO_SAFETY, gearServiceDue: 0 })).toEqual([]);
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

describe("weeklyDigestGrade", () => {
  it("gives the Reports-grade week only to someone Reports' gate admits", () => {
    expect(weeklyDigestGrade(["owner"])).toBe("reports");
    expect(weeklyDigestGrade(["manager"])).toBe("reports");
    expect(weeklyDigestGrade(["captain"])).toBe("staff");
    expect(weeklyDigestGrade(["instructor", "divemaster"])).toBe("staff");
    expect(weeklyDigestGrade([])).toBe("staff");
  });
});

/**
 * **The boat worth a deal** (fifth loop, item 29): the Monday email names
 * this week's emptiest departure no deal has gone out for.
 */
describe("weakestDeparture", () => {
  const NOW = new Date("2026-10-05T12:00:00Z");
  const boat = (id: string, startsAt: string, booked: number, capacity = 8) => ({
    id,
    title: id,
    startsAt: new Date(startsAt),
    booked,
    capacity,
  });

  it("picks the smallest share booked, earliest on a tie", () => {
    const trips = [
      boat("thu", "2026-10-08T12:00:00Z", 1),
      boat("tue", "2026-10-06T12:00:00Z", 1),
      boat("wed", "2026-10-07T12:00:00Z", 3),
    ];
    const weakest = weakestDeparture(trips, new Set(["thu", "tue", "wed"]), NOW);
    expect(weakest?.tripId).toBe("tue");
    expect(weakest).toMatchObject({ booked: 1, capacity: 8 });
  });

  it("skips a boat that had its deal, one at least half full, and one already gone", () => {
    const trips = [
      boat("dealt", "2026-10-06T12:00:00Z", 0),
      boat("half", "2026-10-07T12:00:00Z", 4),
      boat("gone", "2026-10-05T11:00:00Z", 0),
    ];
    expect(weakestDeparture(trips, new Set(["half", "gone"]), NOW)).toBeNull();
  });
});

/**
 * **Last week's emergency reads of a medical alert** (issue #2990): the
 * owner's email lists each one, and a week with none says nothing.
 */
describe("the emergency reads section", () => {
  it("carries the total, the count per reader, and the reads listed, in the order they happened", () => {
    const later = { ...EMERGENCY_READ, diver: "Ben Ito", at: new Date("2026-07-16T09:00:00Z") };
    const reads = {
      total: 61,
      byReader: [
        { reader: "Sal Captain", count: 60 },
        { reader: "Kai Divemaster", count: 1 },
      ],
      listed: [EMERGENCY_READ, later],
    };
    expect(weeklyDigestSections({ ...QUIET, emergencyReads: reads })).toEqual([
      {
        kind: "emergency_reads",
        total: 61,
        byReader: reads.byReader,
        reads: [EMERGENCY_READ, later],
      },
    ]);
  });

  it("names nothing when there were none", () => {
    expect(weeklyDigestSections({ ...QUIET, emergencyReads: NO_EMERGENCY_READS })).toEqual([]);
  });
});
