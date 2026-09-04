import { describe, expect, it } from "vitest";
import type { ReadinessResult } from "./readiness";
import { rosterRowIsBlocked, rosterRowNeedsWaiver } from "./roster-filters";
import type { WaiverState } from "./waivers";

const ready: ReadinessResult = { status: "ready", blockers: [] };
const blocked: ReadinessResult = {
  status: "blocked",
  blockers: [{ code: "waiver_not_sent" }],
};

describe("the roster's blocked chip", () => {
  it("counts a blocked booking and not a ready one", () => {
    expect(rosterRowIsBlocked(blocked)).toBe(true);
    expect(rosterRowIsBlocked(ready)).toBe(false);
  });

  it("does not count a booking with no readiness row at all (regression)", () => {
    // The old rule was `status !== "ready"`, which reads the same and is not:
    // `undefined !== "ready"`, so a booking the batched readiness pass returned
    // nothing for was counted as blocked on the roster while being absent from
    // the queue, the nav badge, and Today — all of which require
    // `status === "blocked"`.
    expect(rosterRowIsBlocked(undefined)).toBe(false);
  });

  it("agrees with the blocker queue's rule on every status it can be handed", () => {
    // The rule the queue applies, stated independently: whatever else changes,
    // these two must keep answering the same question.
    const queueRule = (readiness: ReadinessResult | undefined) => readiness?.status === "blocked";
    for (const readiness of [ready, blocked, undefined]) {
      expect(rosterRowIsBlocked(readiness)).toBe(queueRule(readiness));
    }
  });
});

describe("the roster's needs-waiver chip", () => {
  it("counts every state a send or resend would actually act on", () => {
    expect(rosterRowNeedsWaiver("not_sent")).toBe(true);
    expect(rosterRowNeedsWaiver("awaiting_signature")).toBe(true);
    expect(rosterRowNeedsWaiver("expired")).toBe(true);
  });

  it("does not count a signed waiver", () => {
    expect(rosterRowNeedsWaiver("complete")).toBe(false);
  });

  it("does not count a diver in medical review (regression)", () => {
    // Their waiver *is* signed; it is waiting on a human to read a medical
    // answer. The bulk send button already excludes them — it offers no
    // checkbox — so the old `!== "complete"` chip promised work the surface
    // beside it refused to let anyone do.
    expect(rosterRowNeedsWaiver("medical_review")).toBe(false);
  });

  it("matches the bulk send button's own definition on every waiver state", () => {
    // `WAIVER_CONTROL_KEYS` (RosterSection.tsx) gives `medical_review` and
    // `complete` a null action and every other state a send/resend. The chip
    // and the button must never disagree about which divers are sendable.
    const sendable: Record<WaiverState, boolean> = {
      not_sent: true,
      awaiting_signature: true,
      expired: true,
      complete: false,
      medical_review: false,
      medical_not_cleared: false,
    };
    for (const [state, expected] of Object.entries(sendable)) {
      expect(rosterRowNeedsWaiver(state as WaiverState)).toBe(expected);
    }
  });
});
