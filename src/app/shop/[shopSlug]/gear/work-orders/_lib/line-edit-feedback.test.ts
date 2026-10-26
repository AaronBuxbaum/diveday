import { expect, it } from "vitest";
import { lineEditFeedback } from "./line-edit-feedback";

const own = "00000000-0000-4000-8000-000000000001";
const foreign = "00000000-0000-4000-8000-000000000002";
it("attributes only a validated existing ticket line's refusal or successful correction", () => {
  expect(lineEditFeedback("invalid-amount", "line-edit", own, [{ id: own }])).toEqual({
    lineId: own,
    notice: "invalid-amount",
  });
  expect(lineEditFeedback("line-saved", "line-edit", own, [{ id: own }])).toEqual({
    lineId: own,
    notice: "line-saved",
  });
  for (const id of [foreign, "broken", undefined])
    expect(lineEditFeedback("invalid-amount", "line-edit", id, [{ id: own }])).toBeUndefined();
  expect(lineEditFeedback("not-found", "line-edit", own, [{ id: own }])).toBeUndefined();
  expect(lineEditFeedback("not-authorized", "line-edit", own, [{ id: own }])).toBeUndefined();
  expect(lineEditFeedback("invalid-amount", "line-add", own, [{ id: own }])).toBeUndefined();
});
