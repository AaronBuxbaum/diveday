import { describe, expect, it } from "vitest";
import {
  RECAP_AUTOMATIC_DELAY_HOURS,
  recapAutoSendAt,
  recapAutoSendIsDue,
  unpauseRecapAutoSendAt,
} from "./recap-schedule";

describe("recapAutoSendAt", () => {
  it("defaults to 4 hours after endsAt", () => {
    const endsAt = new Date("2026-08-16T12:00:00.000Z");
    const autoSendAt = recapAutoSendAt(endsAt);
    expect(autoSendAt).toEqual(
      new Date(endsAt.getTime() + RECAP_AUTOMATIC_DELAY_HOURS * 60 * 60 * 1000),
    );
    expect(autoSendAt?.toISOString()).toBe("2026-08-16T16:00:00.000Z");
  });

  it("returns null if there is no scheduled return time", () => {
    const fixedNow = new Date("2026-08-16T12:00:00.000Z");
    expect(recapAutoSendAt(null)).toBeNull();
    expect(recapAutoSendAt(undefined)).toBeNull();
    expect(unpauseRecapAutoSendAt(null, fixedNow)).toBeNull();
    expect(recapAutoSendIsDue({ endsAt: null, now: fixedNow })).toBe(false);
  });

  it("respects custom autoSendAt if provided", () => {
    const endsAt = new Date("2026-08-16T12:00:00.000Z");
    const custom = new Date("2026-08-16T18:00:00.000Z");
    expect(recapAutoSendAt(endsAt, custom)).toEqual(custom);
  });
});

describe("unpauseRecapAutoSendAt", () => {
  it("sets the automatic sending to the original sending time if unpause is early enough", () => {
    const endsAt = new Date("2026-08-16T12:00:00.000Z"); // original send: 16:00
    const unpausedAt = new Date("2026-08-16T13:00:00.000Z"); // 1h after click: 14:00
    // later of (16:00, 14:00) = 16:00
    const result = unpauseRecapAutoSendAt(endsAt, unpausedAt);
    expect(result?.toISOString()).toBe("2026-08-16T16:00:00.000Z");
  });

  it("sets the automatic sending to 1 hour after unpause if unpaused near or after the original sending time", () => {
    const endsAt = new Date("2026-08-16T12:00:00.000Z"); // original send: 16:00
    const unpausedAt = new Date("2026-08-16T15:30:00.000Z"); // 1h after click: 16:30
    // later of (16:00, 16:30) = 16:30
    const result = unpauseRecapAutoSendAt(endsAt, unpausedAt);
    expect(result?.toISOString()).toBe("2026-08-16T16:30:00.000Z");

    const unpausedLate = new Date("2026-08-16T17:00:00.000Z"); // 1h after click: 18:00
    // later of (16:00, 18:00) = 18:00
    const resultLate = unpauseRecapAutoSendAt(endsAt, unpausedLate);
    expect(resultLate?.toISOString()).toBe("2026-08-16T18:00:00.000Z");
  });
});

describe("recapAutoSendIsDue", () => {
  const endsAt = new Date("2026-08-16T12:00:00.000Z");

  it("is false when paused even after target send time", () => {
    const now = new Date("2026-08-16T17:00:00.000Z");
    expect(recapAutoSendIsDue({ endsAt, paused: true, now })).toBe(false);
  });

  it("is false before default 4 hours have passed", () => {
    const now = new Date("2026-08-16T15:59:59.000Z");
    expect(recapAutoSendIsDue({ endsAt, paused: false, now })).toBe(false);
  });

  it("is true at or after default 4 hours have passed", () => {
    const atDue = new Date("2026-08-16T16:00:00.000Z");
    expect(recapAutoSendIsDue({ endsAt, paused: false, now: atDue })).toBe(true);

    const afterDue = new Date("2026-08-16T16:05:00.000Z");
    expect(recapAutoSendIsDue({ endsAt, paused: false, now: afterDue })).toBe(true);
  });

  it("respects custom autoSendAt timestamp when provided", () => {
    const customAutoSendAt = new Date("2026-08-16T17:00:00.000Z");
    const beforeCustom = new Date("2026-08-16T16:30:00.000Z");
    expect(
      recapAutoSendIsDue({
        endsAt,
        autoSendAt: customAutoSendAt,
        paused: false,
        now: beforeCustom,
      }),
    ).toBe(false);

    const afterCustom = new Date("2026-08-16T17:01:00.000Z");
    expect(
      recapAutoSendIsDue({ endsAt, autoSendAt: customAutoSendAt, paused: false, now: afterCustom }),
    ).toBe(true);
  });
});
