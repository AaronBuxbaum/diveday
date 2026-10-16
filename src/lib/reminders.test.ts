import { describe, expect, it } from "vitest";
import type { ChecklistState } from "./readiness-summary";
import {
  dueReminder,
  MAX_REMINDER_LEAD_HOURS,
  reminderEarnsItsSend,
  TRIP_REMINDER_CADENCES,
  TRIP_REMINDER_RHYTHM,
} from "./reminders";

const startsAt = new Date("2026-08-01T12:00:00.000Z");
const none: ReadonlySet<string> = new Set();
const h = (n: number) => new Date(startsAt.getTime() - n * 60 * 60 * 1000);

describe("dueReminder", () => {
  it("is nothing before any cadence opens", () => {
    expect(dueReminder({ startsAt, now: h(200), sentKinds: none })).toBeNull();
  });

  it("returns the 7-day reminder inside its bucket (T-168h .. T-24h)", () => {
    expect(dueReminder({ startsAt, now: h(168), sentKinds: none })?.kind).toBe("trip_reminder_7d");
    expect(dueReminder({ startsAt, now: h(48), sentKinds: none })?.kind).toBe("trip_reminder_7d");
  });

  it("returns only the 24-hour reminder once inside T-24h, never the stale weekly one", () => {
    expect(dueReminder({ startsAt, now: h(24), sentKinds: none })?.kind).toBe("trip_reminder_24h");
    expect(dueReminder({ startsAt, now: h(2), sentKinds: none })?.kind).toBe("trip_reminder_24h");
  });

  it("skips a cadence already sent", () => {
    const sent = new Set(["trip_reminder_7d"]);
    expect(dueReminder({ startsAt, now: h(48), sentKinds: sent })).toBeNull();
  });

  it("still sends the 24-hour reminder even if the 7-day one was never sent (late booking)", () => {
    // A booking made 3h out only ever gets the accurate reminder for its bucket.
    expect(dueReminder({ startsAt, now: h(3), sentKinds: new Set() })?.kind).toBe(
      "trip_reminder_24h",
    );
  });

  it("stops once the trip has departed", () => {
    expect(dueReminder({ startsAt, now: startsAt, sentKinds: none })).toBeNull();
    expect(dueReminder({ startsAt, now: h(-1), sentKinds: none })).toBeNull();
  });

  it("exposes the widest lead time for scan windows", () => {
    expect(MAX_REMINDER_LEAD_HOURS).toBe(168);
  });
});

/**
 * The rhythm rule table, one case per row (issue #1177). This is a suppression,
 * so the cases that matter most are the ones proving a message still goes out.
 */
describe("reminderEarnsItsSend", () => {
  const items = (...states: ChecklistState[]) => states.map((state) => ({ state }));

  it("sends the 7-day nudge when the diver still has something to do", () => {
    expect(reminderEarnsItsSend("trip_reminder_7d", items("done", "action"))).toBe(true);
  });

  it("sends the 7-day nudge when the only blocker is the shop's own", () => {
    // A medical answer under review or a waiver nobody has sent yet: the diver
    // can do nothing about it, and a week out is exactly when somebody should
    // hear from us.
    expect(reminderEarnsItsSend("trip_reminder_7d", items("done", "waiting"))).toBe(true);
  });

  it("holds the 7-day nudge when nothing is left undone", () => {
    expect(reminderEarnsItsSend("trip_reminder_7d", items("done", "done"))).toBe(false);
  });

  it("sends the 7-day nudge to a ready student whose learning materials are not done", () => {
    // ADR 20261008-course-learning-materials: the eLearning is a to-do of its own.
    expect(
      reminderEarnsItsSend("trip_reminder_7d", items("done", "done"), {
        courseMaterialsDue: true,
      }),
    ).toBe(true);
  });

  it("stops nagging once a staffer ticks the materials done", () => {
    expect(
      reminderEarnsItsSend("trip_reminder_7d", items("done", "done"), {
        courseMaterialsDue: false,
      }),
    ).toBe(false);
  });

  it("sends the 24-hour reminder to a fully ready diver anyway", () => {
    // Its utility is the dock call and the conditions, never the to-do list.
    expect(reminderEarnsItsSend("trip_reminder_24h", items("done", "done"))).toBe(true);
  });

  it("sends whatever the cadence when there is no readiness evidence at all", () => {
    // Null is "we do not know", which is not the same answer as "nothing is
    // outstanding" — and the safe reading of not knowing is to send.
    expect(reminderEarnsItsSend("trip_reminder_7d", null)).toBe(true);
    expect(reminderEarnsItsSend("trip_reminder_24h", null)).toBe(true);
  });

  it("sends when a trip gates on nothing, so an empty checklist never means silence", () => {
    expect(reminderEarnsItsSend("trip_reminder_7d", [])).toBe(true);
  });

  it("has a rule for every cadence, so a new one cannot arrive ruleless", () => {
    for (const cadence of TRIP_REMINDER_CADENCES) {
      expect(TRIP_REMINDER_RHYTHM[cadence.kind]?.kind).toBe(cadence.kind);
      expect(TRIP_REMINDER_RHYTHM[cadence.kind].why.length).toBeGreaterThan(0);
    }
    expect(Object.keys(TRIP_REMINDER_RHYTHM).sort()).toEqual(
      TRIP_REMINDER_CADENCES.map((cadence) => cadence.kind).sort(),
    );
  });
});

/**
 * **Autumn fall-back day, America/New_York, 2026-11-01** (issue #2614): 01:00 to
 * 02:00 happens twice, so the day is 25 hours long. The reminder windows are
 * measured in elapsed hours, so a departure on that morning gets its brief 24
 * elapsed hours ahead, which is 25 hours of wall clock, never a wall-clock
 * day ahead.
 */
describe("dueReminder on the fall-back day", () => {
  // 01:30 EST, the second pass through the 01:00 hour.
  const sails = new Date("2026-11-01T06:30:00.000Z");
  const ahead = (ms: number) => new Date(sails.getTime() - ms);
  const HOUR = 60 * 60 * 1000;

  it("opens the 24-hour brief exactly 24 elapsed hours ahead, not a wall-clock day", () => {
    // 24 elapsed hours before 01:30 EST is 02:30 EDT on 31 October.
    expect(dueReminder({ startsAt: sails, now: ahead(24 * HOUR), sentKinds: none })?.kind).toBe(
      "trip_reminder_24h",
    );
    // A wall-clock day ahead (01:30 EDT on 31 October) is 25 elapsed hours out:
    // still the weekly reminder, not the day-before one an hour early.
    expect(dueReminder({ startsAt: sails, now: ahead(25 * HOUR), sentKinds: none })?.kind).toBe(
      "trip_reminder_7d",
    );
    expect(dueReminder({ startsAt: sails, now: ahead(24 * HOUR + 1), sentKinds: none })?.kind).toBe(
      "trip_reminder_7d",
    );
  });

  it("gives a departure in the first pass through the hour the same window", () => {
    const firstPass = new Date("2026-11-01T05:30:00.000Z"); // 01:30 EDT
    expect(
      dueReminder({
        startsAt: firstPass,
        now: new Date(firstPass.getTime() - 24 * HOUR),
        sentKinds: none,
      })?.kind,
    ).toBe("trip_reminder_24h");
    expect(
      dueReminder({
        startsAt: firstPass,
        now: new Date(firstPass.getTime() - 24 * HOUR - 1),
        sentKinds: none,
      })?.kind,
    ).toBe("trip_reminder_7d");
  });

  it("opens the weekly reminder 168 elapsed hours ahead of a departure after the change", () => {
    // 08:00 EST on 2 November; a wall-clock week back is 08:00 EDT on 26
    // October, an hour before the elapsed week (09:00 EDT).
    const monday = new Date("2026-11-02T13:00:00.000Z");
    const elapsedWeek = new Date(monday.getTime() - 168 * HOUR);
    expect(elapsedWeek.toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(
      dueReminder({
        startsAt: monday,
        now: new Date(elapsedWeek.getTime() - 1),
        sentKinds: none,
      }),
    ).toBeNull();
    expect(dueReminder({ startsAt: monday, now: elapsedWeek, sentKinds: none })?.kind).toBe(
      "trip_reminder_7d",
    );
  });
});
