import { expect, it } from "vitest";
import {
  causalScopeAllowsObservation,
  foldRollCallEvidence,
  type RollCallEvidence,
} from "./roll-call-causality";

it.each(["departure", "after_dive_1"])(
  "holds an untargeted withdrawal awaiting at %s without inventing an aboard statement",
  (checkpoint) => {
    const evidence: RollCallEvidence[] = [
      { id: "positive", status: "boarded", observed: [] },
      { id: "undo", status: "cleared" },
    ];
    expect(foldRollCallEvidence(evidence, checkpoint)).toMatchObject({
      status: "cleared",
      conflict: false,
      accountedFor: false,
      frontier: ["positive", "undo"],
    });
    expect(
      foldRollCallEvidence(
        [...evidence, { id: "confirmed", status: "boarded", observed: ["positive", "undo"] }],
        checkpoint,
      ),
    ).toMatchObject({
      status: "boarded",
      conflict: false,
      accountedFor: true,
      frontier: ["confirmed"],
    });
  },
);

it("preserves real missing and actual conflict across a targetless withdrawal", () => {
  const missing: RollCallEvidence = { id: "missing", status: "not_boarded" };
  const undo: RollCallEvidence = { id: "undo", status: "cleared" };
  expect(foldRollCallEvidence([missing, undo], "after_dive_1")).toMatchObject({
    status: "not_boarded",
    conflict: false,
    accountedFor: false,
  });
  expect(
    foldRollCallEvidence([missing, undo, { id: "aboard", status: "boarded" }], "after_dive_1"),
  ).toMatchObject({ status: "not_boarded", conflict: true });
});

it("allows observing unknown-day neutral uncertainty without reusing unknown-day positive attendance", () => {
  const undo: RollCallEvidence = { id: "undo", status: "cleared" };
  expect(causalScopeAllowsObservation(1, -1, "cleared", "departure")).toBe(true);
  expect(causalScopeAllowsObservation(1, -1, "boarded", "departure")).toBe(false);
  const confirmation: RollCallEvidence = {
    id: "confirmed",
    status: "not_boarded",
    observed: ["undo"],
  };
  expect(foldRollCallEvidence([undo, confirmation], "departure")).toMatchObject({
    status: "not_boarded",
    conflict: false,
    frontier: ["confirmed"],
  });
});

it("does not mistake an unknown exact target for a proven withdrawal", () => {
  expect(
    foldRollCallEvidence(
      [
        { id: "positive", status: "not_boarded" },
        { id: "undo", status: "cleared", retracts: "absent" },
      ],
      "departure",
    ),
  ).toMatchObject({ status: "cleared", conflict: false, frontier: ["positive", "undo"] });
});
