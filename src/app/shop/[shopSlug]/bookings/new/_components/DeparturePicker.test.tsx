// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeparturePicker, type DeparturePickerDay } from "./DeparturePicker";

afterEach(cleanup);

/**
 * Slice 9g of ADR 20260827-the-shops-shelves: the Add-booking picker is one
 * ledger grouped by day.
 *
 * The rule pinned here is the one the composition exists for — **the day is
 * said once, by the header, and never again down the rows**. Putting the date
 * back on each row is the regression, and it is the natural one: a row that
 * carries its own date reads fine in isolation, which is exactly how the flat
 * list got that way.
 */

const DAYS: DeparturePickerDay[] = [
  {
    day: "2026-08-29",
    label: "Sat, Aug 29",
    rows: [
      {
        id: "reef",
        href: "/shop/blue-mantis/bookings/new/reef",
        title: "Two-Tank Reef — Molasses & French",
        time: "7:00 AM — 11:00 AM",
        seats: "4 seats left",
        requests: "2 requests",
      },
      {
        id: "afternoon",
        href: "/shop/blue-mantis/bookings/new/afternoon",
        title: "Afternoon Reef — Christ of the Abyss",
        time: "1:00 PM — 4:30 PM",
        seats: "9 seats left",
      },
    ],
  },
  {
    day: "2026-08-30",
    label: "Sun, Aug 30",
    rows: [
      {
        id: "wreck",
        href: "/shop/blue-mantis/bookings/new/wreck",
        title: "Wreck Trip — Spiegel Grove",
        time: "7:30 AM — 12:30 PM",
        seats: "1 seat left",
      },
    ],
  },
];

function renderPicker(days: DeparturePickerDay[] = DAYS) {
  return render(
    <DeparturePicker heading="Which departure?" headingId="which-departure" days={days} />,
  );
}

describe("the departure picker", () => {
  it("names each day once, above its own departures", () => {
    renderPicker();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Sat, Aug 29",
      "Sun, Aug 30",
    ]);
    expect(
      within(screen.getByRole("list", { name: "Sat, Aug 29" })).getAllByRole("listitem"),
    ).toHaveLength(2);
  });

  it("never repeats the day down its own rows", () => {
    renderPicker();
    for (const row of screen.getAllByRole("listitem")) {
      expect(row.textContent).not.toContain("Aug 29");
      expect(row.textContent).not.toContain("Aug 30");
    }
  });

  it("makes every row the door to step two, named", () => {
    renderPicker();
    expect(screen.getByRole("link", { name: "Two-Tank Reef — Molasses & French" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/bookings/new/reef",
    );
  });

  it("keeps seats-left on every row — it is the question the list answers", () => {
    renderPicker();
    expect(screen.getByText("4 seats left")).toBeTruthy();
    expect(screen.getByText("1 seat left")).toBeTruthy();
  });

  it("says the request count only where there are requests", () => {
    renderPicker();
    // A departure nobody asked for renders nothing rather than a "0 requests".
    expect(screen.getAllByText(/requests?$/)).toHaveLength(1);
  });
});
