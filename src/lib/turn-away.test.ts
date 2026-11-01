import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "./clock";
import type { ReadinessBlocker } from "./readiness";
import {
  isTurnAwayReason,
  TURN_AWAY_REASONS,
  type TurnAwayGateInput,
  turnAwayGate,
  turnAwayOffer,
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

const rowAt = (now: Date): Omit<TurnAwayGateInput, "reason"> => ({
  bookingStatus: "booked",
  onTheWater: null,
  tripStatus: "scheduled",
  startsAt: DEPARTURE,
  now,
  readiness: blocked("certification_missing"),
});

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

  /** A stale training mark is the desk's own record, cleared on the Divers tab. */
  it("offers nothing for a training mark that no longer holds", () => {
    expect(turnAwayReasons(blocked("training_mark_invalid"))).toEqual([]);
  });

  /**
   * A held seat (security review 2026-10-16, F1): every blocker but the
   * identity question and the seat's payment is measured against the matched
   * person's record, so offering "medical" would print a stranger's hold on
   * this seat. One allow-list with `heldSeatBlockers`.
   */
  it("offers only identity and payment on a held seat", () => {
    expect(
      turnAwayReasons(
        blocked("identity_unconfirmed", "medical_review", "certification_missing", "payment_due"),
      ),
    ).toEqual(["identity", "payment"]);
    expect(turnAwayReasons(blocked("identity_unconfirmed", "medical_review"))).toEqual([
      "identity",
    ]);
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

  /** H-20261015-who-may-turn-someone: blocked rows only. Readiness clears this diver, so nothing to refuse. */
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

  it("takes a diver who checked in and then went blocked, while the boat is in", () => {
    expect(gate({ bookingStatus: "checked_in" })).toBe("eligible");
  });

  /**
   * Layer 3 review (dde-1 F1): a diver the desk checked in and the boat then
   * left with is, as far as anyone ashore knows, aboard. A refund landing at
   * 09:30 makes the row blocked; it does not bring the diver back to the desk.
   */
  it("refuses an arrived diver once the boat has sailed", () => {
    const sailed = new Date(DEPARTURE.getTime() + 2 * HOUR_MS);
    expect(gate({ bookingStatus: "checked_in", now: sailed })).toBe("sailed");
    expect(
      gate({
        bookingStatus: "checked_in",
        now: sailed,
        readiness: blocked("payment_refunded"),
        reason: "payment",
      }),
    ).toBe("sailed");
  });

  /**
   * Layer 3 re-review (dde-3 #1): the door closes on an arrived diver at the
   * scheduled start, the boundary "Not here" opens on, not an hour later.
   */
  it("refuses an arrived diver from the scheduled start, not the sailing buffer", () => {
    const at = (minutes: number) => new Date(DEPARTURE.getTime() + minutes * MINUTE_MS);
    expect(gate({ bookingStatus: "checked_in", now: at(-1) })).toBe("eligible");
    expect(gate({ bookingStatus: "checked_in", now: at(0) })).toBe("sailed");
    expect(gate({ bookingStatus: "checked_in", now: at(10) })).toBe("sailed");
    expect(gate({ bookingStatus: "checked_in", now: at(59) })).toBe("sailed");
    expect(turnAwayOffer({ ...rowAt(at(10)), bookingStatus: "checked_in" })).toEqual([]);
  });

  /** A booked row after sailing keeps today's behavior (product call, noted). */
  it("still takes a booked row after the boat has sailed", () => {
    expect(gate({ now: new Date(DEPARTURE.getTime() + 2 * HOUR_MS) })).toBe("eligible");
  });

  it("refuses a reason the held seat's own blockers do not show", () => {
    const held = blocked("identity_unconfirmed", "medical_review");
    expect(gate({ readiness: held, reason: "medical" })).toBe("reason_not_blocking");
    expect(gate({ readiness: held, reason: "identity" })).toBe("eligible");
  });
});

/** The desk draws the door from the same predicate the writer runs. */
describe("turnAwayOffer", () => {
  const offer = (overrides: Partial<Omit<TurnAwayGateInput, "reason">> = {}) =>
    turnAwayOffer({
      bookingStatus: "booked",
      onTheWater: null,
      tripStatus: "scheduled",
      startsAt: DEPARTURE,
      now: new Date(DEPARTURE.getTime() - HOUR_MS),
      readiness: blocked("certification_missing", "payment_due"),
      ...overrides,
    });

  it("offers the row's own reasons where the writer would accept each", () => {
    expect(offer()).toEqual(["card", "payment"]);
  });

  it("offers nothing to an arrived diver once the boat has sailed", () => {
    expect(
      offer({ bookingStatus: "checked_in", now: new Date(DEPARTURE.getTime() + 2 * HOUR_MS) }),
    ).toEqual([]);
  });

  it("offers nothing on the water, on a released seat, or on a ready row", () => {
    expect(offer({ onTheWater: "boarded" })).toEqual([]);
    expect(offer({ bookingStatus: "no_show" })).toEqual([]);
    expect(offer({ readiness: { status: "ready", blockers: [] } })).toEqual([]);
  });

  it("offers only identity and payment on a held seat", () => {
    expect(
      offer({ readiness: blocked("identity_unconfirmed", "medical_review", "payment_due") }),
    ).toEqual(["identity", "payment"]);
  });
});
