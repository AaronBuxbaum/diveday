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
