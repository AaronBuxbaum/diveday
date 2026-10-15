import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "./clock";
import {
  isMissingReason,
  isStaleRollCallReason,
  STALE_ROLL_CALL_AFTER_MS,
  STALE_ROLL_CALL_LOOKBACK_MS,
  staleRollCallAlertDue,
} from "./roll-call-alerts";

const END = new Date("2026-10-14T16:00:00Z");
const past = (ms: number) => new Date(END.getTime() + ms);

/** Batch 6, item 6: an after-dive count still open after the boat should be home. */
describe("staleRollCallAlertDue", () => {
  it("waits half an hour past the end, then is due", () => {
    expect(staleRollCallAlertDue({ endsAt: END, alertedAt: null, now: past(29 * MINUTE_MS) })).toBe(
      false,
    );
    expect(
      staleRollCallAlertDue({ endsAt: END, alertedAt: null, now: past(STALE_ROLL_CALL_AFTER_MS) }),
    ).toBe(true);
  });

  it("goes once: a departure already alerted is never due again", () => {
    expect(
      staleRollCallAlertDue({
        endsAt: END,
        alertedAt: past(31 * MINUTE_MS),
        now: past(3 * 60 * MINUTE_MS),
      }),
    ).toBe(false);
  });

  it("does not alert about a boat that tied up longer ago than the look-back", () => {
    expect(
      staleRollCallAlertDue({
        endsAt: END,
        alertedAt: null,
        now: past(STALE_ROLL_CALL_LOOKBACK_MS + MINUTE_MS),
      }),
    ).toBe(false);
  });

  it("is never due before the boat was due back", () => {
    expect(staleRollCallAlertDue({ endsAt: END, alertedAt: null, now: past(-MINUTE_MS) })).toBe(
      false,
    );
  });
});

describe("which open counts alert", () => {
  it("alerts on the four after-dive reasons and never on dock paperwork", () => {
    for (const reason of [
      "missing_diver",
      "missing_crew",
      "after_dive_uncounted",
      "crew_uncounted",
    ] as const) {
      expect(isStaleRollCallReason(reason)).toBe(true);
    }
    expect(isStaleRollCallReason("departure_uncounted")).toBe(false);
    expect(isStaleRollCallReason("no_roll_call")).toBe(false);
  });

  it("tells a stated missing person from an unfinished count", () => {
    expect(isMissingReason("missing_diver")).toBe(true);
    expect(isMissingReason("missing_crew")).toBe(true);
    expect(isMissingReason("after_dive_uncounted")).toBe(false);
  });
});
