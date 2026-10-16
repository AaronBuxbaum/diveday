import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "./clock";
import type { ReadinessBlocker } from "./readiness";
import {
  isTurnAwayReason,
  TURN_AWAY_REASONS,
  type TurnAwayGateInput,
  turnAwayGate,
  turnAwayReasons,
} from "./turn-away";

const DEPARTURE = new Date("2026-10-16T14:00:00.000Z");

const blocked = (...codes: ReadinessBlocker["code"][]) => ({
  status: "blocked" as const,
  blockers: codes.map((code) => ({ code })),
});

function gate(overrides: Partial<TurnAwayGateInput> = {}) {
  return turnAwayGate({
    bookingStatus: "booked",
    onTheWater: null,
    tripStatus: "scheduled",
    startsAt: DEPARTURE,
    // An hour before the boat: "Not here" is still closed here.
    now: new Date(DEPARTURE.getTime() - HOUR_MS),
    readiness: blocked("certification_missing"),
    reason: "card",
    ...overrides,
  });
}

describe("turnAwayReasons", () => {
  it("offers each of the row's own categories once, in a fixed order", () => {
    expect(
      turnAwayReasons(
        blocked("payment_due", "certification_pending", "medical_review", "nitrox_missing"),
      ),
    ).toEqual(["medical", "card", "payment"]);
  });

  it("files a minor's missing co-signature and a course form under the waiver", () => {
    expect(turnAwayReasons(blocked("guardian_signature_missing"))).toEqual(["waiver"]);
    expect(turnAwayReasons(blocked("course_form_unsigned"))).toEqual(["waiver"]);
  });

  it("keeps a refused medical evaluation as medical, not as a waiver", () => {
    expect(turnAwayReasons(blocked("medical_not_cleared"))).toEqual(["medical"]);
  });

  it("offers nothing for a ready row", () => {
    expect(turnAwayReasons({ status: "ready", blockers: [] })).toEqual([]);
  });

  /** Shop setup and a failed lookup say nothing about the person at the desk. */
  it("offers nothing for a row blocked only by shop setup or a failed lookup", () => {
    expect(turnAwayReasons(blocked("requirements_not_configured"))).toEqual([]);
    expect(turnAwayReasons(blocked("readiness_unavailable"))).toEqual([]);
  });

  it("accepts only the enum's own words", () => {
    for (const reason of TURN_AWAY_REASONS) expect(isTurnAwayReason(reason)).toBe(true);
    expect(isTurnAwayReason("diabetes")).toBe(false);
    expect(isTurnAwayReason("")).toBe(false);
  });
});

describe("turnAwayGate", () => {
  it("opens before the boat leaves, unlike Not here", () => {
    expect(gate()).toBe("eligible");
    expect(gate({ now: new Date(DEPARTURE.getTime() + 10 * MINUTE_MS) })).toBe("eligible");
  });

  it("stays inside the counter's own reach", () => {
    expect(gate({ now: new Date(DEPARTURE.getTime() - 37 * HOUR_MS) })).toBe("outside_window");
    expect(gate({ now: new Date(DEPARTURE.getTime() + 6 * HOUR_MS + MINUTE_MS) })).toBe(
      "outside_window",
    );
  });

  /** H-124: blocked rows only. Readiness clears this diver, so nothing to refuse. */
  it("refuses a row readiness clears", () => {
    expect(gate({ readiness: { status: "ready", blockers: [] } })).toBe("not_blocked");
  });

  it("refuses a reason that is not among the row's own blockers", () => {
    expect(gate({ reason: "medical" })).toBe("reason_not_blocking");
    expect(gate({ readiness: blocked("readiness_unavailable"), reason: "card" })).toBe(
      "reason_not_blocking",
    );
  });

  /** The same refusal as `noShowGate`, ahead of everything so nothing masks it. */
  it("refuses a diver the crew's roll call puts on the water, whatever else is true", () => {
    expect(gate({ onTheWater: "boarded", bookingStatus: "no_show" })).toBe("already_boarded");
    expect(
      gate({ onTheWater: "missing_after_dive", readiness: { status: "ready", blockers: [] } }),
    ).toBe("already_missing_after_dive");
  });

  it("frees a seat once: a released seat is already marked", () => {
    expect(gate({ bookingStatus: "no_show" })).toBe("already_marked");
  });

  it("refuses a seat given up, and a boat that is not going", () => {
    expect(gate({ bookingStatus: "cancelled" })).toBe("not_booked");
    expect(gate({ tripStatus: "cancelled" })).toBe("trip_cancelled");
  });

  it("takes a diver who checked in and then went blocked", () => {
    expect(gate({ bookingStatus: "checked_in" })).toBe("eligible");
  });
});
