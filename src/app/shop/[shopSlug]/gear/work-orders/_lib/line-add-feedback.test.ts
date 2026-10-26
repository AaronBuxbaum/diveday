import { describe, expect, it } from "vitest";
import { isLineAddRefusal } from "./line-add-feedback";

describe("add-line refusal attribution", () => {
  it("routes add validation locally while the same edit refusal stays global", () => {
    expect(isLineAddRefusal("invalid-amount", "line-add")).toBe(true);
    expect(isLineAddRefusal("invalid-amount", undefined)).toBe(false);
    expect(isLineAddRefusal("invalid-quantity", "line-add")).toBe(true);
    expect(isLineAddRefusal("empty-description", "line-add")).toBe(true);
  });
  it("never moves gate, missing-ticket or unrecognized outcomes into a field", () => {
    for (const notice of [
      "not-found",
      "not-authorized",
      "closed",
      "invalid",
      "line-added",
      undefined,
    ]) {
      expect(isLineAddRefusal(notice, "line-add")).toBe(false);
    }
  });
});

it("keeps an add validation refusal global after the ticket was deleted", () => {
  expect(isLineAddRefusal("invalid-amount", "line-add", true)).toBe(false);
  expect(isLineAddRefusal("invalid-quantity", "line-add", true)).toBe(false);
});
