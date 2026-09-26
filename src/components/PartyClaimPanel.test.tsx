// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rendersFlush } from "@/test/button-flush";
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

    // The copy button starts its line, so its word sits on the seat's name
    // and waiver line above it, not 12px inside them (TOKEN-2-08, K-06).
    expect(
      rendersFlush(screen.getByRole("button", { name: "Copy reminder link" }), "ghost", "sm"),
    ).toBe(true);
    expect(screen.getAllByText("Waiver still needed")).toHaveLength(2);
    expect(screen.getByText("Waiver complete")).toBeInTheDocument();
    expect(
      screen.getByText("Ask them to finish their waiver from their own link."),
    ).toBeInTheDocument();
  });

  /**
   * K-343. The summary was a bare `cursor-pointer` line: the browser's black
   * triangle, and a 20px box beside a 44px "Copy reminder link".
   */
  it("opens the raw link from a 44px disclosure with the app's own caret", () => {
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
        ]}
      />,
    );

    const summary = screen.getByText("Show link").closest("summary");
    expect(summary).toHaveClass(
      "flex",
      "min-h-11",
      "list-none",
      "items-center",
      "[&::-webkit-details-marker]:hidden",
    );
    expect(summary?.querySelector("svg")).not.toBeNull();
  });
});
