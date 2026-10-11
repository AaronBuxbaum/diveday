import { describe, expect, it } from "vitest";
import type { ReadinessResult } from "./readiness";
import { rosterRowIsBlocked } from "./roster-filters";

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
