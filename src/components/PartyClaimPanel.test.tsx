// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PartyClaimPanel } from "./PartyClaimPanel";

afterEach(cleanup);

describe("PartyClaimPanel", () => {
  it("shows claim progress, waiver state, and a copyable reminder", () => {
    render(
      <PartyClaimPanel
        locale="en-US"
        seats={[
          {
            bookingId: "seat-1",
            seatName: "Maya Alvarez",
            claimed: false,
            waiverSigned: false,
            claimUrl: "/claim/seat-1",
          },
          {
            bookingId: "seat-2",
            seatName: "Noah Chen",
            claimed: true,
            waiverSigned: false,
            claimUrl: null,
          },
          {
            bookingId: "seat-3",
            seatName: "Iris Cole",
            claimed: true,
            waiverSigned: true,
            claimUrl: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Copy reminder link" })).toBeInTheDocument();
    expect(screen.getAllByText("Waiver still needed")).toHaveLength(2);
    expect(screen.getByText("Waiver complete")).toBeInTheDocument();
    expect(
      screen.getByText("Ask them to finish their waiver from their own link."),
    ).toBeInTheDocument();
  });
});
