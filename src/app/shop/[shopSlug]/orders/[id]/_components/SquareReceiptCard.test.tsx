// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { SquareReceiptCard } from "./SquareReceiptCard";

afterEach(cleanup);

vi.mock("../square-actions", () => ({
  linkSquareReceiptAction: vi.fn(),
  releaseSquareReceiptAction: vi.fn(),
}));
const base = { orderId: "purchase", t: staffTranslator("en-US"), locale: "en-US", timezone: "UTC" };
const evidence = {
  environment: "sandbox" as const,
  merchantId: "merchant",
  paymentId: "payment-id",
  locationId: "location",
  currency: "usd",
  totalCents: 10000,
  tipCents: 0,
  refundedCents: 0,
  receiptNumber: "ABCD",
};
describe("Square receipt card", () => {
  it("stays out of the way until connected", () => {
    const { container } = render(
      <SquareReceiptCard {...base} state={{ connected: false, link: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("does not offer matching for an unpaid purchase", () => {
    const { container } = render(
      <SquareReceiptCard {...base} matchable={false} state={{ connected: true, link: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("offers payment ID matching, never payment collection", () => {
    render(<SquareReceiptCard {...base} state={{ connected: true, link: null }} />);
    expect(screen.getByLabelText("Square payment ID")).toBeRequired();
    expect(screen.getByRole("button", { name: "Match receipt" })).toBeEnabled();
    expect(screen.getByText(/does not take payment/)).toBeInTheDocument();
  });
  it("keeps the receipt readable after disconnect, with a disabled recheck and correction door", () => {
    render(
      <SquareReceiptCard
        {...base}
        state={{
          connected: false,
          link: {
            evidence,
            checkedAt: new Date("2026-11-11T12:00:00Z"),
            lastError: "refund_mismatch",
          },
        }}
      />,
    );
    expect(screen.getByText("payment-id")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete receipt link" })).toBeEnabled();
    expect(screen.getByText(/Square receipt and this purchase differ/)).toBeInTheDocument();
  });
});
