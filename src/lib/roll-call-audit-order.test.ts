import { describe, expect, it } from "vitest";
import { compareAuditMarkOrder, compareMarkOrder, rollCallCheckpointOrdinal } from "./roll-call";

const mark = (capture: number, stored: number, seq: number) => ({
  occurredAt: new Date(capture),
  createdAt: new Date(stored),
  seq,
});

describe("audit chronology does not establish roll-call supersession", () => {
  it("displays an earlier captured statement first despite later receipt", () => {
    const delayed = mark(100, 600, 2);
    const live = mark(500, 500, 1);
    expect(compareAuditMarkOrder(delayed, live)).toBeLessThan(0);
    expect(compareMarkOrder(delayed, live)).toBeGreaterThan(0);
  });

  it("uses receipt and then sequence only to make equal audit times deterministic", () => {
    expect(compareAuditMarkOrder(mark(100, 200, 9), mark(100, 300, 1))).toBeLessThan(0);
    expect(compareAuditMarkOrder(mark(100, 200, 2), mark(100, 200, 1))).toBeGreaterThan(0);
    expect(compareAuditMarkOrder(mark(100, 200, 1), mark(100, 200, 1))).toBe(0);
  });

  it("does not mistake a non-finite retained checkpoint for the dock", () => {
    expect(rollCallCheckpointOrdinal("after_dive_NaN" as `after_dive_${number}`)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
