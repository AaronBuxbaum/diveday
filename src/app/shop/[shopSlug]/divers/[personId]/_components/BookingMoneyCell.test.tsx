// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { BookingMoneyCell } from "./BookingMoneyCell";
import type { DiverProfile } from "./shared";

const t = staffTranslator("en-US");

function renderCell(diver: Partial<DiverProfile>, paymentsConnected = true) {
  return render(
    <BookingMoneyCell
      diver={{ orders: [], bookingPayments: [], ...diver } as unknown as DiverProfile}
      bookingId="booking-1"
      shopSlug="reef-shop"
      personId="person-1"
      paymentsConnected={paymentsConnected}
      t={t}
    />,
  );
}

afterEach(cleanup);

describe("BookingMoneyCell", () => {
  it("reads an order's status when one has been raised", () => {
    renderCell({
      orders: [{ order: { id: "order-1", bookingId: "booking-1", status: "paid" } }],
    } as unknown as Partial<DiverProfile>);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open payment" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/orders/order-1",
    );
  });

  it("falls back to the booking's own payment status when there is no order", () => {
    renderCell({
      bookingPayments: [{ booking: { id: "booking-1" }, payment: { status: "deposit_paid" } }],
    } as unknown as Partial<DiverProfile>);
    expect(screen.getByText("Deposit paid")).toBeInTheDocument();
  });

  it("prefers the order over the booking payment — the order is the billing record", () => {
    renderCell({
      orders: [{ order: { id: "order-1", bookingId: "booking-1", status: "refunded" } }],
      bookingPayments: [{ booking: { id: "booking-1" }, payment: { status: "paid" } }],
    } as unknown as Partial<DiverProfile>);
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  });

  it("offers the per-booking billing door when nothing has been raised", () => {
    renderCell({});
    // `orders/new` takes the booking as a query param and has no picker of its
    // own, so this link is the only way to bill a specific trip.
    expect(screen.getByRole("link", { name: "Create order" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/orders/new?personId=person-1&bookingId=booking-1",
    );
  });

  it("offers no billing door at all when the shop cannot take money", () => {
    renderCell({}, false);
    // Not a "Connect payments" link per row: with no payable account that
    // button is the same on every row, and the Payments header already has it.
    expect(screen.queryByRole("link", { name: "Create order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect payments" })).not.toBeInTheDocument();
    // The status still shows — what is owed does not depend on Stripe.
    expect(screen.getByText("No order")).toBeInTheDocument();
  });

  it("never reads another booking's money onto this row", () => {
    renderCell({
      orders: [{ order: { id: "order-2", bookingId: "booking-2", status: "paid" } }],
    } as unknown as Partial<DiverProfile>);
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create order" })).toBeInTheDocument();
  });
});
