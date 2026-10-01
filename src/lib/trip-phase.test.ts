import { describe, expect, it } from "vitest";
import { TRIP_PHASES, tripPhaseOf } from "./trip-phase";
import type { TripStage } from "./trip-stages";

const ZONE = "America/New_York";
// 07:00 local on Tue Jul 21 2026, back at 12:00.
const startsAt = new Date("2026-07-21T11:00:00.000Z");
const endsAt = new Date("2026-07-21T16:00:00.000Z");

function phaseAt(
  now: string,
  stage: TripStage | null = null,
  cancelled = false,
  // By default the crew tapped at 10:30 local on the departure's own day.
  recordedAt = "2026-07-21T14:30:00.000Z",
) {
  return tripPhaseOf({
    startsAt,
    endsAt,
    now: new Date(now),
    timeZone: ZONE,
    stage: stage ? { stage, recordedAt: new Date(recordedAt) } : null,
    cancelled,
  });
}

describe("tripPhaseOf", () => {
  it("names the four phases in the order a departure moves through them", () => {
    expect(TRIP_PHASES).toEqual(["prep", "checkin", "aboard", "back"]);
  });

  it("is Prep on any day before the departure's own", () => {
    expect(phaseAt("2026-07-20T22:00:00.000Z")).toBe("prep");
    // 23:59 local the night before is still the day before.
    expect(phaseAt("2026-07-21T03:59:00.000Z")).toBe("prep");
  });

  it("is Check-in from local midnight on the day until the boat leaves", () => {
    expect(phaseAt("2026-07-21T04:00:00.000Z")).toBe("checkin");
    expect(phaseAt("2026-07-21T10:59:00.000Z")).toBe("checkin");
  });

  it("is Aboard from the scheduled departure until an hour past the scheduled return", () => {
    expect(phaseAt("2026-07-21T11:00:00.000Z")).toBe("aboard");
    expect(phaseAt("2026-07-21T16:59:00.000Z")).toBe("aboard");
  });

  it("is Back once the departure is an hour past its scheduled return", () => {
    expect(phaseAt("2026-07-21T17:00:00.000Z")).toBe("back");
    expect(phaseAt("2026-07-25T12:00:00.000Z")).toBe("back");
  });

  it("takes the crew's word over the clock while a boat runs late", () => {
    // Two hours past the buffer, but the crew has said nothing about tying up.
    expect(phaseAt("2026-07-21T19:00:00.000Z", "heading_in")).toBe("aboard");
    expect(phaseAt("2026-07-21T19:00:00.000Z", "underway")).toBe("aboard");
  });

  it("keeps a late boat Aboard past the window a stage is published for", () => {
    // Five hours past the scheduled return: `liveStageOf` would have dropped
    // this tap, and the page must not turn Back because of it.
    expect(phaseAt("2026-07-21T21:00:00.000Z", "heading_in")).toBe("aboard");
  });

  it("stops holding Aboard once the return day is over", () => {
    // 00:30 local the next day, and nobody ever said home.
    expect(phaseAt("2026-07-22T04:30:00.000Z", "underway")).toBe("back");
  });

  it("is Aboard the moment the crew starts boarding, even before the hour", () => {
    expect(phaseAt("2026-07-21T10:30:00.000Z", "boarding", false, "2026-07-21T10:20:00.000Z")).toBe(
      "aboard",
    );
  });

  it("ignores a tap from before the departure's own day", () => {
    // Yesterday's `home`, left on the record by the last sailing.
    expect(phaseAt("2026-07-21T09:00:00.000Z", "home", false, "2026-07-20T20:00:00.000Z")).toBe(
      "checkin",
    );
  });

  it("is Back the moment the crew says home, even before the scheduled return", () => {
    expect(phaseAt("2026-07-21T14:00:00.000Z", "home")).toBe("back");
  });

  it("names no phase for a cancelled departure", () => {
    expect(phaseAt("2026-07-21T10:00:00.000Z", null, true)).toBeNull();
    expect(phaseAt("2026-07-21T12:00:00.000Z", "underway", true)).toBeNull();
  });
});
