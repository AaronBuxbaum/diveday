// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PartyClaimPanel, type PartyClaimSeat } from "./PartyClaimPanel";

afterEach(cleanup);

const seat = (over: Partial<PartyClaimSeat>): PartyClaimSeat => ({
  bookingId: "seat-1",
  seatName: "Maya Alvarez",
  claimed: false,
  waiverSigned: false,
  claimUrl: "/claim/seat-1",
  payable: true,
  ...over,
});

/** Issue #2474: the lead pays for a seat they added, one seat per button. */
describe("PartyClaimPanel pay line", () => {
  it("draws a pay button for each payable unclaimed seat, carrying that seat's id", () => {
    const { container } = render(
      <PartyClaimPanel
        locale="en-US"
        payAction={async () => {}}
        seats={[seat({}), seat({ bookingId: "seat-2", seatName: "Noah Chen" })]}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Pay for this seat" })).toHaveLength(2);
    const ids = [...container.querySelectorAll<HTMLInputElement>('input[name="seatBookingId"]')];
    expect(ids.map((input) => input.value)).toEqual(["seat-1", "seat-2"]);
  });

  it("draws none for a paid, claimed, or unmarked seat, or where the page takes no payment", () => {
    const { rerender } = render(
      <PartyClaimPanel
        locale="en-US"
        payAction={async () => {}}
        seats={[
          seat({ payable: false }),
          seat({ bookingId: "seat-2", claimed: true, claimUrl: null }),
          seat({ bookingId: "seat-3", payable: undefined }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Pay for this seat" })).toBeNull();
    rerender(<PartyClaimPanel locale="en-US" payAction={null} seats={[seat({})]} />);
    expect(screen.queryByRole("button", { name: "Pay for this seat" })).toBeNull();
  });

  it("counts paid and covered seats while keeping expired seats in the ledger", () => {
    render(
      <PartyClaimPanel
        locale="en-US"
        organizerSettled={false}
        seats={[
          seat({ paymentStatus: "paid", payable: false }),
          seat({ bookingId: "seat-2", paymentStatus: "waived", payable: false }),
          seat({
            bookingId: "seat-3",
            paymentStatus: "unpaid",
            groupHoldExpired: true,
            claimUrl: null,
            payable: false,
          }),
        ]}
      />,
    );
    expect(screen.getByText("2 of 4 paid or covered")).toBeInTheDocument();
    expect(screen.getByText("Hold expired. This seat is back on sale.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay for this seat" })).toBeNull();
  });

  it("keeps the expired organizer ledger focused on payment, without stale link instructions", () => {
    render(
      <PartyClaimPanel
        readOnly
        locale="en-US"
        organizerSettled={false}
        seats={[seat({ paymentStatus: "paid", claimUrl: null, payable: false })]}
      />,
    );
    expect(screen.getByText("1 of 2 paid or covered")).toBeInTheDocument();
    expect(screen.queryByText(/Send each diver their own link/)).toBeNull();
    expect(screen.queryByText("Waiver still needed")).toBeNull();
  });

  it("speaks Spanish", () => {
    render(<PartyClaimPanel locale="es-ES" payAction={async () => {}} seats={[seat({})]} />);
    expect(screen.getByRole("button", { name: "Pagar esta plaza" })).toBeInTheDocument();
  });
});

it("reassures an at-shop group without claiming an unpaid seat is paid", () => {
  render(
    <PartyClaimPanel
      locale="en-US"
      paymentsAtShop
      organizerSettled={false}
      seats={[
        seat({ paymentStatus: "unpaid" }),
        seat({ bookingId: "paid-seat", paymentStatus: "paid" }),
      ]}
    />,
  );
  expect(screen.getByText("Payment is due at the shop.")).toBeInTheDocument();
  expect(screen.getByText("Pays at the shop")).toBeInTheDocument();
  expect(screen.queryByText("Payment needed")).toBeNull();
  expect(screen.queryByText("1 of 3 paid or covered")).toBeNull();
});

it("keeps the paid summary once every at-shop seat is covered", () => {
  render(
    <PartyClaimPanel
      locale="en-US"
      paymentsAtShop
      organizerSettled
      seats={[seat({ paymentStatus: "paid" })]}
    />,
  );
  expect(screen.getByText("2 of 2 paid or covered")).toBeInTheDocument();
  expect(screen.queryByText("Payment is due at the shop.")).toBeNull();
});

it("keeps an unpaid hold deadline explicit even if online collection becomes unavailable", () => {
  render(
    <PartyClaimPanel
      locale="en-US"
      paymentsAtShop
      organizerSettled={false}
      seats={[seat({ paymentStatus: "unpaid", groupHoldUntil: new Date("2030-06-01T12:00:00Z") })]}
    />,
  );
  expect(screen.getByText("Payment needed")).toBeInTheDocument();
  expect(screen.queryByText("Pays at the shop")).toBeNull();
});

it.each([null, 0])(
  "does not imply charges for an unpriced or free group (%s)",
  (seatPriceCents) => {
    render(
      <PartyClaimPanel
        locale="en-US"
        paymentsAtShop
        organizerSettled={false}
        organizerPriceCents={seatPriceCents}
        seats={[seat({ paymentStatus: "unpaid", seatPriceCents })]}
      />,
    );
    expect(screen.getByText("Maya Alvarez")).toBeInTheDocument();
    expect(screen.queryByText("Payment is due at the shop.")).toBeNull();
    expect(screen.queryByText("Pays at the shop")).toBeNull();
  },
);
