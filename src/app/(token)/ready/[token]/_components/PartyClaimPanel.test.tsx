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
    const target = screen.getByText("Maya Alvarez").closest("li");
    expect(target).toHaveAttribute("id", "party-seat-seat-1");
    expect(target).toHaveAttribute("tabindex", "-1");
    expect(target?.querySelector("details")).not.toHaveAttribute("open");
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

  /** H-20261014-parent-signs-minor-release: a parent signs a child's release from their own page. */
  it("offers the organizer the minor's waiver, posting only the seat", () => {
    const action = async () => {};
    const seat = {
      bookingId: "seat-mia",
      seatName: "Mia",
      claimed: false,
      waiverSigned: false,
      claimUrl: "/claim/seat-mia",
      signForMinor: true,
    };
    const { container } = render(
      <PartyClaimPanel locale="en-US" seats={[seat]} signWaiverAction={action} />,
    );
    expect(
      screen.getByText(
        "Mia is under 18, so you sign their release with them, as their parent or guardian.",
      ),
    ).toBeTruthy();
    const button = screen.getByRole("button", { name: "Sign Mia’s waiver" });
    const fields = [...(button.closest("form")?.querySelectorAll("input") ?? [])].map((input) => [
      input.name,
      input.value,
    ]);
    expect(fields).toEqual([["bookingId", "seat-mia"]]);
    cleanup();
    // Without the action (the booking confirmation's panel), no seat offers to.
    render(<PartyClaimPanel locale="en-US" seats={[seat]} />);
    expect(screen.queryByRole("button", { name: "Sign Mia’s waiver" })).toBeNull();
    expect(container).toBeTruthy();
  });

  /** Dive-domain review F4 and N7 of layer r4-1: a minor seat with no button says why. */
  it("tells the organizer the path left when they cannot sign", () => {
    const base = {
      claimed: false,
      waiverSigned: false,
      claimUrl: null,
      signForMinor: false,
    };
    render(
      <PartyClaimPanel
        locale="en-US"
        seats={[
          { ...base, bookingId: "seat-tess", seatName: "Tess", minorNote: "send_link" as const },
          { ...base, bookingId: "seat-kai", seatName: "Kai", minorNote: "physician" as const },
        ]}
        signWaiverAction={async () => {}}
      />,
    );
    expect(
      screen.getByText("Send Tess their link; a parent or guardian signs with them."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Kai’s medical answers need a physician’s sign-off. The shop will say what it needs.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /waiver/ })).toBeNull();
  });
});
