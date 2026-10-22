// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RecordPaymentForm } from "./CounterPayment";

// The forms post to server actions whose module reaches the database.
vi.mock("../counter-actions", () => ({
  recordPaymentAction: vi.fn(),
  voidCounterAction: vi.fn(),
}));

afterEach(cleanup);

const t = staffTranslator("en-US");
const ORDER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * **Record payment on a demo order** (market sheet 2026-10-22, item 6): the
 * counter's two ways are live buttons; the room charge, which a demo does not
 * record, is not offered at all.
 */
describe("RecordPaymentForm", () => {
  it("offers cash, the card machine and a room charge on a real shop", () => {
    render(<RecordPaymentForm orderId={ORDER_ID} t={t} />);
    expect(screen.getByRole("button", { name: "Cash" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Card machine" })).toBeEnabled();
    expect(screen.getByText(t("orders.detail.recordPayment.roomCharge"))).toBeInTheDocument();
  });

  it("offers only cash and the card machine on a demo shop, both live", () => {
    const { container } = render(<RecordPaymentForm orderId={ORDER_ID} t={t} roomCharge={false} />);
    expect(screen.getByRole("button", { name: "Cash" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Card machine" })).toBeEnabled();
    expect(screen.queryByText(t("orders.detail.recordPayment.roomCharge"))).toBeNull();
    const posted = [...container.querySelectorAll('input[name="collection"]')].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(posted).toEqual(["cash", "card_machine"]);
  });
});
