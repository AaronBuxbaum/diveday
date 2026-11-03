import { describe, expect, it } from "vitest";
import {
  ATTEMPT_RULES,
  DERIVED_STATES,
  LEDGER_STATES,
  ledgerStatuses,
  PAYMENT_CLAIM_STALE_AFTER_MS,
  raisedOnTodayBefore,
  stuckBefore,
  UNFINISHED_KINDS,
  unfinishedStatuses,
} from "./attempts";
import { DAY_MS, MINUTE_MS } from "./clock";

const NOW = new Date("2026-11-03T12:00:00Z");

describe("the attempt grammar", () => {
  it("gives every kind a rule and a state, either from its ledger or fixed", () => {
    for (const kind of UNFINISHED_KINDS) {
      expect(ATTEMPT_RULES[kind]).toBeDefined();
      expect(kind in LEDGER_STATES || kind in DERIVED_STATES).toBe(true);
    }
  });

  it("never lists a done row", () => {
    for (const kind of UNFINISHED_KINDS) {
      expect(ATTEMPT_RULES[kind].unfinished).not.toContain("done");
    }
  });

  it("never lets Today raise a row before the kind's own queue lists it", () => {
    for (const kind of UNFINISHED_KINDS) {
      expect(ATTEMPT_RULES[kind].todayAfterMs).toBeGreaterThanOrEqual(
        ATTEMPT_RULES[kind].stuckAfterMs,
      );
    }
  });

  it("lists a payment operation only while it is still started, never once Stripe said no", () => {
    expect(unfinishedStatuses("payment_operation")).toEqual({ windowed: ["started"], always: [] });
  });

  it("lists a media delete that failed at once and one still pending after its window", () => {
    expect(unfinishedStatuses("media_deletion")).toEqual({
      windowed: ["pending"],
      always: ["failed"],
    });
  });

  it("lists every owed erasure at any age, and never a discharged one", () => {
    expect(unfinishedStatuses("processor_erasure")).toEqual({ windowed: [], always: ["owed"] });
    expect(ledgerStatuses("processor_erasure", ["done"])).toEqual(["discharged"]);
  });

  it("keeps the five-minute payment window the claims read", () => {
    expect(PAYMENT_CLAIM_STALE_AFTER_MS).toBe(5 * MINUTE_MS);
    expect(stuckBefore("payment_operation", NOW)).toEqual(new Date(NOW.getTime() - 5 * MINUTE_MS));
    expect(stuckBefore("media_deletion", NOW)).toEqual(new Date(NOW.getTime() - 5 * MINUTE_MS));
  });

  it("has no window for work owed from the moment it exists", () => {
    expect(stuckBefore("processor_erasure", NOW)).toBeNull();
    expect(stuckBefore("shop_cancellation_refund", NOW)).toBeNull();
    expect(stuckBefore("failed_refund", NOW)).toBeNull();
  });

  it("raises an owed shop-cancellation refund on Today after a day", () => {
    expect(raisedOnTodayBefore("shop_cancellation_refund", NOW)).toEqual(
      new Date(NOW.getTime() - DAY_MS),
    );
  });
});

describe("every ledger kind lists at least one status", () => {
  it("so the reader's filter is never empty", () => {
    for (const kind of Object.keys(LEDGER_STATES) as (keyof typeof LEDGER_STATES)[]) {
      const { windowed, always } = unfinishedStatuses(kind);
      expect(windowed.length + always.length).toBeGreaterThan(0);
    }
  });
});

describe("a kind with a call in flight", () => {
  it("always has a window, so a call made seconds ago never reads as stuck", () => {
    for (const kind of Object.keys(LEDGER_STATES) as (keyof typeof LEDGER_STATES)[]) {
      if (unfinishedStatuses(kind).windowed.length === 0) continue;
      expect(ATTEMPT_RULES[kind].stuckAfterMs).toBeGreaterThan(0);
      expect(ATTEMPT_RULES[kind].todayAfterMs).toBeGreaterThan(0);
    }
  });
});
