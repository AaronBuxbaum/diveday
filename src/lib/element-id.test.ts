import { describe, expect, it } from "vitest";
import { scopedHash, scopedId } from "./element-id";

describe("scopedId", () => {
  it("leaves an id alone when there is no prefix", () => {
    // The standalone manifest and prep routes, and every e2e selector and
    // visual baseline pinned to them, depend on this exact behaviour.
    expect(scopedId(undefined, "roll-call-list")).toBe("roll-call-list");
    expect(scopedId("", "roll-call-list")).toBe("roll-call-list");
  });

  it("scopes an id to one departure when a document holds several", () => {
    const tripId = "6f1d0c2e-1111-4aaa-8bbb-000000000001";
    expect(scopedId(tripId, "roll-call-list")).toBe(`${tripId}-roll-call-list`);
    expect(scopedHash(tripId, "roll-call-list")).toBe(`#${tripId}-roll-call-list`);
  });

  it("gives two departures two different ids for the same section", () => {
    const first = scopedId("6f1d0c2e-1111-4aaa-8bbb-000000000001", "pre-departure-check-heading");
    const second = scopedId("6f1d0c2e-1111-4aaa-8bbb-000000000002", "pre-departure-check-heading");
    expect(first).not.toBe(second);
  });
});
