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

/**
 * **Autumn fall-back day, America/New_York, 2026-11-01** (issue #2614): the
 * stale-count alert is measured in elapsed milliseconds from the boat's end, so
 * a count left open across the repeated 01:00 hour is alerted after the same
 * 30 elapsed minutes as on an ordinary day, and the look-back is 24 elapsed
 * hours (25 wall-clock hours on this date), never a calendar day.
 */
describe("staleRollCallAlertDue on the fall-back day", () => {
  const MIN = MINUTE_MS;
  // The boat is due back at 01:15 EDT, the first pass through the 01:00 hour.
  const dueBack = new Date("2026-11-01T05:15:00.000Z");
  const plus = (from: Date, ms: number) => new Date(from.getTime() + ms);

  it("alerts 30 elapsed minutes after a 01:15 EDT end, as on any other day", () => {
    expect(
      staleRollCallAlertDue({ endsAt: dueBack, alertedAt: null, now: plus(dueBack, 29 * MIN) }),
    ).toBe(false);
    expect(
      staleRollCallAlertDue({ endsAt: dueBack, alertedAt: null, now: plus(dueBack, 30 * MIN) }),
    ).toBe(true);
  });

  it("alerts a count that stays open across the repeated hour after the same elapsed wait", () => {
    // Due back 01:45 EDT; 30 elapsed minutes later the wall clock reads 01:15
    // EST. A wall-clock reading (an end of 01:45 and a now of 01:15) would call
    // that 30 minutes *before* the end and never fire; elapsed time fires it.
    const lateEnd = new Date("2026-11-01T05:45:00.000Z");
    expect(
      staleRollCallAlertDue({ endsAt: lateEnd, alertedAt: null, now: plus(lateEnd, 29 * MIN) }),
    ).toBe(false);
    const firesAt = plus(lateEnd, 30 * MIN);
    expect(firesAt.toISOString()).toBe("2026-11-01T06:15:00.000Z");
    expect(staleRollCallAlertDue({ endsAt: lateEnd, alertedAt: null, now: firesAt })).toBe(true);
  });

  it("measures the look-back in 24 elapsed hours across the 25-hour day", () => {
    const edge = plus(dueBack, STALE_ROLL_CALL_LOOKBACK_MS);
    // 24 elapsed hours after 01:15 EDT is 00:15 EST the next day.
    expect(edge.toISOString()).toBe("2026-11-02T05:15:00.000Z");
    expect(staleRollCallAlertDue({ endsAt: dueBack, alertedAt: null, now: edge })).toBe(true);
    expect(staleRollCallAlertDue({ endsAt: dueBack, alertedAt: null, now: plus(edge, 1) })).toBe(
      false,
    );
  });
});
