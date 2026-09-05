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
