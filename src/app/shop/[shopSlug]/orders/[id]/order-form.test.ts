import { describe, expect, it } from "vitest";
import { postedOrderId, postedRefundAmount } from "./order-form";

const ORDER = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("the order page's posted fields (security review of issue 2233)", () => {
  it("reads a typed amount, and an empty box as the whole remaining balance", () => {
    expect(
      postedRefundAmount(
        form([
          ["orderId", ORDER],
          ["amountMajor", " 12.50 "],
        ]),
      ),
    ).toBe("12.50");
    expect(
      postedRefundAmount(
        form([
          ["orderId", ORDER],
          ["amountMajor", ""],
        ]),
      ),
    ).toBe("");
    expect(postedRefundAmount(form([["orderId", ORDER]]))).toBe("");
  });

  /**
   * "" means "refund everything that is left", so a form that does not read
   * must never become "": a repeated amount (one says 5, one says 500) is a
   * refusal, not a full refund.
   */
  it("refuses a repeated amount or order id rather than reading it as a full refund", () => {
    expect(
      postedRefundAmount(
        form([
          ["orderId", ORDER],
          ["amountMajor", "5"],
          ["amountMajor", "500"],
        ]),
      ),
    ).toBeNull();
    expect(
      postedRefundAmount(
        form([
          ["orderId", ORDER],
          ["orderId", ORDER],
          ["amountMajor", ""],
        ]),
      ),
    ).toBeNull();
  });

  it("refuses a figure that is not a finite number", () => {
    for (const amount of ["abc", "Infinity", "1e999"]) {
      expect(
        postedRefundAmount(
          form([
            ["orderId", ORDER],
            ["amountMajor", amount],
          ]),
        ),
      ).toBeNull();
    }
  });

  it("narrows the order id to a uuid, and anything else to none", () => {
    expect(postedOrderId(form([["orderId", ORDER]]))).toBe(ORDER);
    expect(postedOrderId(form([["orderId", "abc"]]))).toBe("");
    expect(
      postedOrderId(
        form([
          ["orderId", ORDER],
          ["orderId", ORDER],
        ]),
      ),
    ).toBe("");
  });
});
