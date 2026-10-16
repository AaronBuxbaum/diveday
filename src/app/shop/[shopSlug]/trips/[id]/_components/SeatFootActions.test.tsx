// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rendersFlush } from "@/test/button-flush";
import { fixtures, ready, renderRoster } from "./roster-test-fixtures";

afterEach(cleanup);

/**
 * The seat's foot row put its controls on the panel's text column with a hand
 * `-mx-3`, which left whichever came first 4px from the card's
 * `overflow-hidden` on a phone, so both drew an inset ring
 * (`trip-guests-identity-open` at 390). Now the first control is `flush`: a
 * link's box is its label, a ghost's box reaches 8px past it, and either way
 * the app's own ring fits inside the clip (K-06). jsdom has no layout, so
 * this asks which control is flush; `button.test.ts` refuses the row bleed.
 */
describe("the seat's foot row sits on the text column through flush", () => {
  it("flushes Create order, the first control, and leaves Remove booking its padding", () => {
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: true });

    const remove = screen.getByRole("button", { name: "Remove booking" });
    const order = screen.getByRole("link", { name: "Create order" });
    expect(rendersFlush(order, "link", "sm")).toBe(true);
    expect(rendersFlush(remove, "danger-ghost", "sm")).toBe(false);
    for (const control of [order, remove]) {
      expect(control).not.toHaveClass("focus-visible:focus-ring-inset");
    }
  });

  it("withholds Create order from a reader who may not raise an invoice (issue #1925)", () => {
    // Payments connected, so the only thing hiding the link is the permission:
    // `orders/new` would bounce this reader to the Orders index.
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: true, canManageOrders: false });

    expect(screen.queryByRole("link", { name: "Create order" })).toBeNull();
    const remove = screen.getByRole("button", { name: "Remove booking" });
    expect(rendersFlush(remove, "danger-ghost", "sm")).toBe(true);
  });

  it("flushes Remove booking when it is the only control on the row", () => {
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: false });

    const remove = screen.getByRole("button", { name: "Remove booking" });
    expect(screen.queryByRole("link", { name: "Create order" })).toBeNull();
    expect(rendersFlush(remove, "danger-ghost", "sm")).toBe(true);
    expect(remove).not.toHaveClass("focus-visible:focus-ring-inset");
  });
});

/**
 * **"Move to another departure"** (ADR 20261013-staff-move-a-seat): offered on
 * a booked seat when the page found somewhere to go, as one select of
 * departures already worded with their zone, and never on a seat the day has
 * already recorded.
 */
describe("the move to another departure", () => {
  const moveSeat = {
    action: () => {},
    targets: [{ id: "t-2", label: "Two-Tank Reef · Sat, Oct 24, 8:00 AM EDT" }],
    departed: false,
    started: false,
  };

  it("offers the departures on a booked seat", () => {
    renderRoster({ ...fixtures, roster: [ready], moveSeat });

    expect(screen.getByText("Move to another departure")).toBeInTheDocument();
    const select = screen.getByLabelText("Departure");
    expect(select).toHaveAttribute("name", "toTripId");
    expect(screen.getByRole("option", { name: /Sat, Oct 24, 8:00 AM EDT/ })).toHaveValue("t-2");
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });

  it("is absent when the page found nowhere to go", () => {
    renderRoster({ ...fixtures, roster: [ready] });

    expect(screen.queryByText("Move to another departure")).toBeNull();
  });

  /**
   * Layer 3 review (dde-2 #3) and re-review (dde-3 #4+#5): a turned-away seat
   * moves until the boat's scheduled start, and from it the door is Remove.
   */
  it("moves a turned-away seat only before the boat's start", () => {
    const turnedAway = {
      ...ready,
      booking: {
        ...ready.booking,
        status: "no_show" as const,
        turnedAwayAt: new Date("2026-10-16T07:00:00Z"),
        turnedAwayReason: "card" as const,
      },
    };
    renderRoster({ ...fixtures, roster: [turnedAway], moveSeat });
    expect(screen.getByText("Move to another departure")).toBeInTheDocument();
    cleanup();
    renderRoster({ ...fixtures, roster: [turnedAway], moveSeat: { ...moveSeat, started: true } });
    expect(screen.queryByText("Move to another departure")).toBeNull();
    cleanup();
    const departed = { ...moveSeat, started: true, departed: true };
    renderRoster({ ...fixtures, roster: [turnedAway], moveSeat: departed });
    expect(screen.queryByText("Move to another departure")).toBeNull();
    cleanup();
    renderRoster({ ...fixtures, roster: [ready], moveSeat: departed });
    expect(screen.queryByText("Move to another departure")).toBeNull();
  });

  it("is absent on a checked-in seat", () => {
    const checkedIn = { ...ready, booking: { ...ready.booking, status: "checked_in" as const } };
    renderRoster({ ...fixtures, roster: [checkedIn], moveSeat });

    expect(screen.queryByText("Move to another departure")).toBeNull();
  });
});
