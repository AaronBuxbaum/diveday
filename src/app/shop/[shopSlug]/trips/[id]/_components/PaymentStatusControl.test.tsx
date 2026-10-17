// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentStatusControl, type PaymentStatusControlCopy } from "./PaymentStatusControl";

afterEach(cleanup);

const COPY: PaymentStatusControlCopy = {
  prefix: "Payment:",
  label: "Payment status",
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
  amountLabel: "Amount taken",
  methodLabel: "Paid by",
  methods: { cash: "Cash", card: "Card", other: "Other" },
  forgiving: { typedAs: "Typed as {raw}" },
};

const MARK = { amountCents: 12_000, currency: "usd", locale: "en-US" };

/**
 * **The status select stands level with its Update button, in height and in
 * type.** The select was the stacked field's 44px at an appended 14px beside
 * an `sm` Update (44/14); once the appended size went (a control's type is
 * 16px at every size, K-45) it stood a 16px box beside a 14px label, which is
 * the mismatch `controlClass` names: `sm` never matches a control. Every text
 * control is 48px with 16px type, so the button beside it is `md`.
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
        mark={MARK}
        copy={COPY}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Payment status" });
    expect(select).toHaveClass("min-h-12", "text-base");
    expect(select).not.toHaveClass("min-h-11");
    expect(select).not.toHaveClass("text-sm");
    const update = screen.getByRole("button", { name: "Update" });
    expect(update).toHaveClass("min-h-12", "text-base");
    expect(update).not.toHaveClass("text-sm");
  });

  /**
   * **The picker and the button it submits wrap as one.** Label, select and
   * Update were three siblings of one wrapping row, so on a phone a short
   * label ("Payment: Unpaid") kept the select on the first line and sent
   * Update down alone, while a longer one dropped both — the select stood at
   * two different x's down the roster (K-363). Grouped, the pair moves
   * together and the label wraps above it.
   */
  it("keeps the status select and Update in one group of their own inside the row", () => {
    const { container } = render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="unpaid"
        allowedStatuses={["unpaid", "deposit_paid", "paid"]}
        action={vi.fn()}
        sourceNote={null}
        refundNote={null}
        mark={MARK}
        copy={COPY}
      />,
    );
    const form = container.querySelector("form");
    const select = screen.getByRole("combobox");
    const update = screen.getByRole("button", { name: "Update" });
    const group = update.parentElement;
    expect(group).not.toBe(form);
    expect(group?.contains(select)).toBe(true);
    expect(group?.parentElement).toBe(form);
    expect(group).toHaveClass("flex", "items-center", "gap-2");
    // The label is the row's other item, outside the pair.
    expect(group?.contains(screen.getByText(/Payment:/))).toBe(false);
  });
});

describe("PaymentStatusControl Paid mark", () => {
  it("asks how much and how the moment Paid is picked, opening on the seat's balance", () => {
    render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="unpaid"
        allowedStatuses={["unpaid", "deposit_paid", "paid"]}
        action={vi.fn()}
        sourceNote={null}
        refundNote={null}
        mark={MARK}
        copy={COPY}
      />,
    );
    expect(screen.queryByTestId("payment-mark")).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Payment status" }), {
      target: { value: "paid" },
    });

    const mark = screen.getByTestId("payment-mark");
    expect(mark).toBeInTheDocument();
    // No method is picked for the staffer: one nobody chose would be recorded.
    for (const name of ["Cash", "Card", "Other"]) {
      expect(screen.getByRole("radio", { name })).not.toBeChecked();
      expect(screen.getByRole("radio", { name })).toBeRequired();
    }
    expect(mark.querySelector('input[name="amount"]')).toHaveValue("120");
  });

  it("reopens holding the status, amount and method of a mark the server refused", () => {
    render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="unpaid"
        allowedStatuses={["unpaid", "deposit_paid", "paid"]}
        action={vi.fn()}
        sourceNote={null}
        refundNote={null}
        mark={{ ...MARK, retry: { status: "deposit_paid", amountCents: 4_550, method: "card" } }}
        copy={COPY}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Payment status" })).toHaveValue("deposit_paid");
    expect(screen.getByTestId("payment-mark").querySelector('input[name="amount"]')).toHaveValue(
      "45.5",
    );
    expect(screen.getByRole("radio", { name: "Card" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Cash" })).not.toBeChecked();
  });

  it("keeps the balance and an unpicked method when the refusal had neither", () => {
    render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="unpaid"
        allowedStatuses={["unpaid", "deposit_paid", "paid"]}
        action={vi.fn()}
        sourceNote={null}
        refundNote={null}
        mark={{ ...MARK, retry: { status: "paid", amountCents: null, method: null } }}
        copy={COPY}
      />,
    );
    expect(screen.getByTestId("payment-mark").querySelector('input[name="amount"]')).toHaveValue(
      "120",
    );
    for (const name of ["Cash", "Card", "Other"]) {
      expect(screen.getByRole("radio", { name })).not.toBeChecked();
    }
  });

  it("asks nothing when the seat's own status is re-submitted, or a non-money status is picked", () => {
    render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="paid"
        allowedStatuses={["unpaid", "deposit_paid", "paid", "waived"]}
        action={vi.fn()}
        sourceNote={null}
        refundNote={null}
        mark={MARK}
        copy={COPY}
      />,
    );
    expect(screen.queryByTestId("payment-mark")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Payment status" }), {
      target: { value: "waived" },
    });
    expect(screen.queryByTestId("payment-mark")).toBeNull();
  });
});

describe("PaymentStatusControl on a seat whose money came through DiveDay", () => {
  it("offers only the seat's own status, since a hand mark would lose the payment's pointer", () => {
    render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="paid"
        allowedStatuses={["unpaid", "deposit_paid", "paid", "waived", "refunded"]}
        action={vi.fn()}
        sourceNote="Paid online"
        refundNote={null}
        mark={{ ...MARK, handMarkRefused: true }}
        copy={COPY}
      />,
    );
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Paid"]);
  });

  it("names the balance beside the amount on a deposit-paid seat", () => {
    render(
      <PaymentStatusControl
        bookingId="booking-1"
        status="deposit_paid"
        allowedStatuses={["unpaid", "deposit_paid", "paid"]}
        action={vi.fn()}
        sourceNote={null}
        refundNote={null}
        mark={{ ...MARK, amountCents: 7_000, balanceHint: "Balance owed: $70.00" }}
        copy={COPY}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Payment status" }), {
      target: { value: "paid" },
    });
    expect(screen.getByTestId("payment-mark")).toHaveTextContent("Balance owed: $70.00");
  });
});
