import { describe, expect, it } from "vitest";
import { readyCopyKeepUntil } from "./ready-offline";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Security review of layer 8, D2: the phone's copy ends with the trip, not two weeks on. */
describe("readyCopyKeepUntil", () => {
  it("is a day after the boat is due back, or after it leaves when no return is set", () => {
    const startsAt = new Date("2026-10-20T13:00:00Z");
    const endsAt = new Date("2026-10-20T17:00:00Z");
    expect(readyCopyKeepUntil({ startsAt, endsAt })).toBe(endsAt.getTime() + DAY_MS);
    expect(readyCopyKeepUntil({ startsAt, endsAt: null })).toBe(startsAt.getTime() + DAY_MS);
  });
});
