import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "./clock";
import { TRIP_REMINDER_CADENCES } from "./reminders";
import { canSayRunningLate, RUNNING_LATE_LEAD_MS, runningLateShown } from "./running-late";
import { DEPARTURE_BUFFER_MS } from "./trips";

const startsAt = new Date("2026-10-09T12:00:00Z");
const at = (msBefore: number) => new Date(startsAt.getTime() - msBefore);
const seat = (overrides: Partial<Parameters<typeof canSayRunningLate>[0]> = {}) => ({
  bookingStatus: "booked",
  tripStatus: "scheduled",
  startsAt,
  now: at(30 * MINUTE_MS),
  ...overrides,
});

describe("canSayRunningLate", () => {
  it("is open for a booked seat in the hours before the boat leaves", () => {
    expect(canSayRunningLate(seat())).toBe(true);
    expect(canSayRunningLate(seat({ now: at(RUNNING_LATE_LEAD_MS) }))).toBe(true);
    expect(canSayRunningLate(seat({ now: at(1) }))).toBe(true);
  });

  it("is closed before the window opens", () => {
    expect(canSayRunningLate(seat({ now: at(RUNNING_LATE_LEAD_MS + 1) }))).toBe(false);
    expect(canSayRunningLate(seat({ now: at(3 * 24 * HOUR_MS) }))).toBe(false);
  });

  it("opens when the day-before reminder that teaches LATE goes out", () => {
    const dayBefore = TRIP_REMINDER_CADENCES.find((c) => c.kind === "trip_reminder_24h");
    expect(RUNNING_LATE_LEAD_MS).toBe((dayBefore?.hoursBefore ?? 0) * HOUR_MS);
  });

  it("stays open past the scheduled time until the boat has sailed", () => {
    expect(canSayRunningLate(seat({ now: startsAt }))).toBe(true);
    expect(canSayRunningLate(seat({ now: at(-10 * MINUTE_MS) }))).toBe(true);
    expect(canSayRunningLate(seat({ now: at(-(DEPARTURE_BUFFER_MS - 1)) }))).toBe(true);
    expect(canSayRunningLate(seat({ now: at(-DEPARTURE_BUFFER_MS) }))).toBe(false);
    expect(canSayRunningLate(seat({ now: at(-3 * HOUR_MS) }))).toBe(false);
  });

  it("is closed for a seat that has arrived, been released or cancelled", () => {
    for (const bookingStatus of ["checked_in", "no_show", "cancelled", "pending_payment"]) {
      expect(canSayRunningLate(seat({ bookingStatus }))).toBe(false);
    }
  });

  it("is closed on a departure the shop called off", () => {
    expect(canSayRunningLate(seat({ tripStatus: "cancelled" }))).toBe(false);
  });
});

describe("runningLateShown", () => {
  const said = new Date("2026-10-09T11:42:00Z");

  it("shows the statement on a seat still to arrive", () => {
    expect(runningLateShown({ bookingStatus: "booked", runningLateAt: said })).toBe(said);
  });

  it("clears from view once the diver is checked in or released", () => {
    expect(runningLateShown({ bookingStatus: "checked_in", runningLateAt: said })).toBeNull();
    expect(runningLateShown({ bookingStatus: "no_show", runningLateAt: said })).toBeNull();
  });

  it("is nothing when the diver said nothing", () => {
    expect(runningLateShown({ bookingStatus: "booked", runningLateAt: null })).toBeNull();
  });
});
