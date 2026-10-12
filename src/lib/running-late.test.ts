import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "./clock";
import { TRIP_REMINDER_CADENCES } from "./reminders";
import {
  canSayRunningLate,
  RUNNING_LATE_LEAD_MS,
  runningLateOnManifest,
  runningLateShown,
} from "./running-late";
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

/**
 * **The captain's half** (#2319): the same statement on the manifest and its
 * offline copy, so the rail does not call missing a diver who said they are on
 * the way. A quiet line and nothing more — every case below that answers null
 * is a row where the line would now be wrong or a distraction.
 */
describe("runningLateOnManifest", () => {
  const saidAt = new Date("2026-10-09T11:42:00Z");
  const row = (overrides: Partial<Parameters<typeof runningLateOnManifest>[0]> = {}) => ({
    checkpoint: "departure",
    runningLateAt: saidAt,
    rollCallState: undefined,
    checkedIn: false,
    notHere: false,
    ...overrides,
  });

  it("shows on a dock row nobody has called yet", () => {
    expect(runningLateOnManifest(row())).toEqual(saidAt);
  });

  it("stays on a row the crew recorded as not boarded, which is when it is the context", () => {
    expect(runningLateOnManifest(row({ rollCallState: "not_boarded" }))).toEqual(saidAt);
  });

  it("disappears the moment the diver is boarded", () => {
    expect(runningLateOnManifest(row({ rollCallState: "boarded" }))).toBeNull();
  });

  it("disappears once the counter has them, and on a seat the desk released", () => {
    expect(runningLateOnManifest(row({ checkedIn: true }))).toBeNull();
    expect(runningLateOnManifest(row({ notHere: true }))).toBeNull();
  });

  it("never shows after a dive, where the question is who came back", () => {
    for (const rollCallState of [undefined, "boarded", "not_boarded"]) {
      expect(runningLateOnManifest(row({ checkpoint: "after_dive_1", rollCallState }))).toBeNull();
    }
  });

  it("is nothing when the diver said nothing, or a copy saved before the field", () => {
    expect(runningLateOnManifest(row({ runningLateAt: null }))).toBeNull();
    expect(runningLateOnManifest(row({ runningLateAt: undefined }))).toBeNull();
  });
});
