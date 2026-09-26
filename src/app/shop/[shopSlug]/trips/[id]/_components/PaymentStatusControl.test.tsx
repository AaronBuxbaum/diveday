// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentStatusControl, type PaymentStatusControlCopy } from "./PaymentStatusControl";

afterEach(cleanup);

const COPY: PaymentStatusControlCopy = {
  prefix: "Payment:",
  statuses: {
    unpaid: "Unpaid",
    deposit_paid: "Deposit paid",
    paid: "Paid",
    partly_refunded: "Partly refunded",
    waived: "Waived",
    refunded: "Refunded",
  },
  update: "Update",
  updating: "Updating…",
};

/**
 * **The status select stands level with its Update button, in height and in
 * type.** The select was the stacked field's 44px at an appended 14px beside
 * an `sm` Update (44/14); once the appended size went (a control's type is
 * 16px at every size, K-45) it stood a 16px box beside a 14px label, which is
 * the mismatch `controlSizes` names: `sm` never matches a control. A row with
 * a text control in it is an `md` row — 48px, 16px, both of them.
 */
describe("PaymentStatusControl control row", () => {
  it("draws the status select and its Update button at md", () => {
    render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="unpaid"
        allowedStatuses={["unpaid", "deposit_paid", "paid"]}
        action={vi.fn()}
        sourceNote={null}
        refundNote={null}
        copy={COPY}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveClass("min-h-12", "text-base");
    expect(select).not.toHaveClass("min-h-11");
    expect(select).not.toHaveClass("text-sm");
    const update = screen.getByRole("button", { name: "Update" });
    expect(update).toHaveClass("min-h-12", "text-base");
    expect(update).not.toHaveClass("text-sm");
  });
});
