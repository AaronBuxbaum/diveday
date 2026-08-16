import { describe, expect, it } from "vitest";
import { RECAP_MINIMUM_DELAY_HOURS, recapEligibleAt, recapIsEligible } from "./recap-schedule";

describe("recap schedule", () => {
  it("never makes a recap eligible before four hours after the departure ends", () => {
    const endedAt = new Date("2026-08-16T12:00:00.000Z");
    expect(recapEligibleAt(endedAt)).toEqual(new Date("2026-08-16T16:00:00.000Z"));
    expect(recapIsEligible(endedAt, new Date("2026-08-16T15:59:59.999Z"))).toBe(false);
    expect(recapIsEligible(endedAt, new Date("2026-08-16T16:00:00.000Z"))).toBe(true);
    expect(RECAP_MINIMUM_DELAY_HOURS).toBe(4);
  });
});
