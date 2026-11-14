import { expect, it } from "vitest";
import { rollCallCompleteness } from "./manifests";

it("keeps a checkpoint open for unattributed retained safety evidence", () => {
  const base = {
    checkpoint: "after_dive_1" as const,
    totalDivers: 6,
    awaiting: 0,
    notBackAboard: 0,
    crew: [{ rollCall: { state: "boarded" as const, implied: false } }],
  };
  expect(rollCallCompleteness(base).complete).toBe(true);
  expect(rollCallCompleteness({ ...base, retainedSafetyUnresolved: true })).toMatchObject({
    complete: false,
    reason: "retained_safety_unresolved",
    retainedSafetyUnresolved: true,
  });
  expect(
    rollCallCompleteness({ ...base, notBackAboard: 1, retainedSafetyUnresolved: true }),
  ).toMatchObject({
    complete: false,
    reason: "divers_not_back_aboard",
    retainedSafetyUnresolved: true,
  });
});
