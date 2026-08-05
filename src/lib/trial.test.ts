import { describe, expect, it } from "vitest";
import { isTrialExpired, TRIAL_DURATION_DAYS, trialDaysRemaining, trialEndsAt } from "./trial";

const CREATED_AT = new Date("2026-08-04T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("trial timing", () => {
  it("runs for three weeks", () => {
    expect(TRIAL_DURATION_DAYS).toBe(21);
  });

  it("ends exactly TRIAL_DURATION_DAYS after the shop was created", () => {
    expect(trialEndsAt(CREATED_AT).getTime()).toBe(CREATED_AT.getTime() + 21 * DAY_MS);
  });

  it("reads as the full window on day one", () => {
    expect(trialDaysRemaining(CREATED_AT, CREATED_AT)).toBe(21);
    expect(isTrialExpired(CREATED_AT, CREATED_AT)).toBe(false);
  });

  it("counts down as the trial runs", () => {
    const midway = new Date(CREATED_AT.getTime() + 10 * DAY_MS);
    expect(trialDaysRemaining(CREATED_AT, midway)).toBe(11);
    expect(isTrialExpired(CREATED_AT, midway)).toBe(false);
  });

  it("rounds a partial day left up rather than reading as expired", () => {
    const sixHoursBeforeEnd = new Date(trialEndsAt(CREATED_AT).getTime() - 6 * 60 * 60 * 1000);
    expect(trialDaysRemaining(CREATED_AT, sixHoursBeforeEnd)).toBe(1);
    expect(isTrialExpired(CREATED_AT, sixHoursBeforeEnd)).toBe(false);
  });

  it("is expired at the exact instant the window elapses, with nothing left to show", () => {
    const end = trialEndsAt(CREATED_AT);
    expect(isTrialExpired(CREATED_AT, end)).toBe(true);
    expect(trialDaysRemaining(CREATED_AT, end)).toBe(0);
  });

  it("never reads a negative day count once the trial is well past over", () => {
    const wellAfter = new Date(trialEndsAt(CREATED_AT).getTime() + 30 * DAY_MS);
    expect(isTrialExpired(CREATED_AT, wellAfter)).toBe(true);
    expect(trialDaysRemaining(CREATED_AT, wellAfter)).toBe(0);
  });
});
