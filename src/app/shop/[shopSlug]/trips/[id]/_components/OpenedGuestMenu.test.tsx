// @vitest-environment jsdom

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseGuestAction,
  fixtures,
  openGuestMenu,
  ready,
  renderRoster,
} from "./roster-test-fixtures";

afterEach(cleanup);

/**
 * **The opened guest's rare acts are one menu** (owner, 2026-11-25): the
 * profile, Create order, the move, and last Cancel booking in danger ink. No
 * row of it posts anything; a row that asks a question opens its sheet.
 */
describe("the opened guest's More menu", () => {
  const names = () =>
    [...openGuestMenu().querySelectorAll("a, button")].map((row) => row.textContent);

  it("lists the profile, Create order and Cancel booking, in that order", () => {
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: true });

    expect(names()).toEqual(["Open guest profile", "Create order", "Cancel booking"]);
    expect(within(openGuestMenu()).getByRole("button", { name: "Cancel booking" })).toHaveClass(
      "text-danger",
    );
    expect(openGuestMenu().querySelector("form")).toBeNull();
  });

  it("withholds Create order from a reader who may not raise an invoice (issue #1925)", () => {
    // Payments connected, so the only thing hiding the link is the permission:
    // `orders?add=1` would bounce this reader to the Orders index.
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: true, canManageOrders: false });

    expect(names()).toEqual(["Open guest profile", "Cancel booking"]);
  });

  it("asks before cancelling, and Never mind puts the question away", () => {
    renderRoster({ ...fixtures, roster: [ready], paymentsConnected: false });

    const sheet = document.querySelector('[data-guest-sheet="cancel"]') as HTMLElement;
    expect(sheet).not.toBeVisible();
    chooseGuestAction("Cancel booking");
    expect(sheet).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Yes, cancel booking" })).toBeVisible();
    fireEvent.click(within(sheet).getByRole("button", { name: "Never mind" }));
    expect(sheet).not.toBeVisible();
  });
});

/**
 * **"Move to another trip"** (ADR 20261013-staff-move-a-seat): offered on
 * a booked seat when the page found somewhere to go, as one select of
 * departures already worded with their zone, and never on a seat the day has
 * already recorded.
 */
describe("the move to another departure", () => {
  const moveSeat = {
    action: () => {},
    targets: [
      {
        id: "t-2",
        label: "Two-Tank Reef · Sat, Oct 24, 8:00 AM EDT",
        seatsLeft: 3,
        startsAt: "2026-10-24T12:00:00Z",
        localDay: "2026-10-24",
        dayLabel: "Sat, Oct 24, 2026",
        timeLabel: "8:00 AM EDT",
      },
    ],
    departed: false,
    started: false,
  };

  it("offers the departures on a booked seat", () => {
    renderRoster({ ...fixtures, roster: [ready], moveSeat });

    chooseGuestAction("Move to another trip");
    const select = screen.getByLabelText("Departure");
    expect(select).toHaveAttribute("name", "toTripId");
    expect(screen.getByRole("option", { name: /8:00 AM EDT/ })).toHaveValue("t-2");
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });

  it("is absent when the page found nowhere to go", () => {
    renderRoster({ ...fixtures, roster: [ready] });

    expect(
      within(openGuestMenu()).queryByRole("button", { name: "Move to another trip" }),
    ).toBeNull();
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
    expect(
      within(openGuestMenu()).queryByRole("button", { name: "Move to another trip" }),
    ).not.toBeNull();
    cleanup();
    renderRoster({ ...fixtures, roster: [turnedAway], moveSeat: { ...moveSeat, started: true } });
    expect(
      within(openGuestMenu()).queryByRole("button", { name: "Move to another trip" }),
    ).toBeNull();
    cleanup();
    const departed = { ...moveSeat, started: true, departed: true };
    renderRoster({ ...fixtures, roster: [turnedAway], moveSeat: departed });
    expect(
      within(openGuestMenu()).queryByRole("button", { name: "Move to another trip" }),
    ).toBeNull();
    cleanup();
    renderRoster({ ...fixtures, roster: [ready], moveSeat: departed });
    expect(
      within(openGuestMenu()).queryByRole("button", { name: "Move to another trip" }),
    ).toBeNull();
  });

  it("is absent on a checked-in seat", () => {
    // Arrival is the trail's word on a `booked` seat (issue #2702).
    const checkedIn = { ...ready, checkedIn: true };
    renderRoster({ ...fixtures, roster: [checkedIn], moveSeat });

    expect(
      within(openGuestMenu()).queryByRole("button", { name: "Move to another trip" }),
    ).toBeNull();
  });
});

/**
 * **A diver marked aboard a boat that has left** (H-20261015-aboard-diver-removal-at): Remove says why it
 * will not, and offers nothing that posts. `cancelBooking` refuses the same
 * seat under its locks; this is the row saying so before anyone tries.
 */
describe("Remove on a diver marked aboard at sea", () => {
  it("says the diver is aboard and carries no confirm and no submit", () => {
    renderRoster({
      ...fixtures,
      roster: [ready],
      aboardAtSea: new Map([[ready.booking.id, "on_the_water"]]),
    });

    chooseGuestAction("Cancel booking");
    const sheet = document.querySelector('[data-guest-sheet="cancel"]') as HTMLElement;
    expect(
      screen.getByText(
        "Rene Marsh sailed on this departure, so the booking stays. To give money back, refund their order.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, cancel booking" })).toBeNull();
    // Nothing behind this Cancel booking can post the removal.
    expect(sheet.querySelector("form, button")).toBeNull();
  });

  it("tells a seat nobody counted at the dock how to let it go, never that it sailed", () => {
    renderRoster({
      ...fixtures,
      roster: [ready],
      aboardAtSea: new Map([[ready.booking.id, "uncounted"]]),
    });

    chooseGuestAction("Cancel booking");
    const sheet = document.querySelector('[data-guest-sheet="cancel"]') as HTMLElement;
    expect(
      screen.getByText(
        "Nobody counted Rene Marsh at the dock, so the boat may have carried them. If they didn’t come, mark them Not boarded on the manifest, then remove the booking.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sailed/)).toBeNull();
    expect(sheet.querySelector("form, button")).toBeNull();
  });

  it("leaves another diver's Remove as it was", () => {
    renderRoster({
      ...fixtures,
      roster: [ready],
      aboardAtSea: new Map([["someone-else", "on_the_water"]]),
    });

    chooseGuestAction("Cancel booking");
    expect(screen.getByRole("button", { name: "Yes, cancel booking" })).toBeInTheDocument();
  });
});

/**
 * **A course seat that carries a charter seat** (issue #2058, Aaron
 * 2026-10-13): Remove and the move both say which departure was sold on this
 * course, before anyone acts, and say nothing on a seat that carries none.
 */
describe("a course seat that carries a charter seat", () => {
  const moveSeat = {
    action: () => {},
    targets: [
      {
        id: "t-2",
        label: "Advanced session · Sat, Oct 24, 8:00 AM EDT",
        seatsLeft: 3,
        startsAt: "2026-10-24T12:00:00Z",
        localDay: "2026-10-24",
        dayLabel: "Sat, Oct 24, 2026",
        timeLabel: "8:00 AM EDT",
      },
    ],
    departed: false,
    started: false,
  };
  const dependentCharters = new Map([
    [ready.booking.id, [{ title: "Deep wall", startsAt: new Date("2026-10-26T12:00:00.000Z") }]],
  ]);

  it("names the charter in the move, and in the armed Remove", () => {
    renderRoster({ ...fixtures, roster: [ready], moveSeat, dependentCharters });

    const note = /is booked on Deep wall · .* because this course gets them/;
    for (const action of ["Move to another trip", "Cancel booking"]) {
      chooseGuestAction(action);
      const sheet = document.querySelector("[data-guest-sheet]:not([hidden])") as HTMLElement;
      expect(within(sheet).getByText(note)).toBeVisible();
    }
  });

  it("says nothing on a seat that carries none", () => {
    renderRoster({ ...fixtures, roster: [ready], moveSeat });
    chooseGuestAction("Cancel booking");
    expect(screen.queryByText(/because this course gets them/)).toBeNull();
  });
});
