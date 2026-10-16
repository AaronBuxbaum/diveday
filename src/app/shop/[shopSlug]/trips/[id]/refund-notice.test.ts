import { describe, expect, it } from "vitest";
import { refundNotice } from "./refund-notice";

describe("refundNotice", () => {
  /**
   * Layer 3 review (dde-2 #2): Remove on a seat the desk turned away is not a
   * refund owed by hand for a counter payment, and not a forfeit. It says
   * nothing was refunded, and why, in its own words.
   */
  it("gives a removed turned-away seat its own notice", () => {
    expect(refundNotice({ status: "manual", reason: "turned_away" })).toBe(
      "booking-removed-turned-away",
    );
  });

  it("keeps the other manual refusals where they were", () => {
    expect(refundNotice({ status: "manual", reason: "not_stripe" })).toBe(
      "booking-removed-refund-manual",
    );
    expect(refundNotice({ status: "manual", reason: "not_refundable" })).toBe(
      "booking-removed-refund-review",
    );
    expect(refundNotice({ status: "forfeit" })).toBe("booking-removed-forfeit");
  });
});
