import { describe, expect, it } from "vitest";
import { dueReminder, MAX_REMINDER_LEAD_HOURS } from "./reminders";

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
