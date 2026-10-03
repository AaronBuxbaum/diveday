// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DepartureLedger, type DepartureRow } from "./DepartureLedger";

afterEach(cleanup);

/**
 * Issue 775's rule, carried through the 2026-10-03 redesign that took the
 * meters out: **the ink is on the gap, not the achievement.** Only waivers
 * still to collect take a tone, and they take it in words.
 */

const FULL: DepartureRow = {
  tripId: "trip-full",
  href: "/shop/blue-mantis/trips/trip-full",
  title: "Two-Tank Reef — Molasses & French",
  date: "Wed, Aug 26",
  seats: "12 of 12 seats",
  crew: "3 crew",
  waivers: { fact: "All waivers in", outstanding: false },
};

const SHORT: DepartureRow = {
  tripId: "trip-short",
  href: "/shop/blue-mantis/trips/trip-short",
  title: "Two-Tank Reef — Benwood & Elbow",
  date: "Mon, Aug 24",
  seats: "9 of 12 seats",
  crew: "2 crew",
  waivers: { fact: "2 waivers to collect", outstanding: true },
};

const UNBOOKED: DepartureRow = {
  tripId: "trip-empty",
  href: "/shop/blue-mantis/trips/trip-empty",
  title: "Wreck Trip — Duane",
  date: "Sun, Aug 23",
  seats: "0 of 8 seats",
  crew: "0 crew",
  waivers: null,
};

function renderLedger(rows: DepartureRow[] = [FULL, SHORT, UNBOOKED]) {
  return render(
    <DepartureLedger
      label="Trips this month"
      labelId="reports-departures"
      count="24 trips"
      rows={rows}
    />,
  );
}

describe("the waivers fact", () => {
  it("tones only the count still to collect", () => {
    renderLedger();
    expect(screen.getByText("2 waivers to collect")).toHaveClass("text-warning-strong");
  });

  it("stays quiet once every waiver is in", () => {
    renderLedger();
    expect(screen.getByText("All waivers in")).not.toHaveClass("text-warning-strong");
  });

  it("leaves seats quiet however empty the boat", () => {
    // An empty boat on a month being reviewed is a fact, not a task.
    renderLedger();
    for (const fact of ["12 of 12 seats", "9 of 12 seats", "0 of 8 seats"]) {
      expect(screen.getByText(fact)).not.toHaveClass("text-warning-strong");
    }
  });

  it("says nothing about waivers for a departure nobody booked", () => {
    renderLedger([UNBOOKED]);
    expect(screen.queryByText(/waiver/)).toBeNull();
  });
});

describe("the facts' columns", () => {
  it("stand every fact in a fixed column, set whole", () => {
    renderLedger([SHORT]);
    expect(screen.getByText("9 of 12 seats")).toHaveClass("lg:w-32");
    expect(screen.getByText("2 crew")).toHaveClass("lg:w-24");
    expect(screen.getByText("2 waivers to collect")).toHaveClass("lg:w-48");
    expect(screen.getByText("2 crew").parentElement).toHaveClass("whitespace-nowrap");
  });

  it("hold the waivers column open for a departure nobody booked", () => {
    const { container } = renderLedger([UNBOOKED]);
    const slot = container.querySelector('span[aria-hidden="true"]');
    expect(slot?.textContent).toBe("");
    expect(slot).toHaveClass("lg:w-48", "hidden", "lg:block");
  });

  it("draw no meters", () => {
    const { container } = renderLedger();
    expect(container.querySelector(".rounded-full")).toBeNull();
  });
});

describe("the row", () => {
  it("carries its own nouns, because no column header names them", () => {
    renderLedger();
    for (const fact of ["9 of 12 seats", "2 crew", "2 waivers to collect", "Mon, Aug 24"]) {
      expect(screen.getAllByText(fact, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it("is the door to its own guest list", () => {
    renderLedger([SHORT]);
    const door = screen.getByRole("link", { name: SHORT.title });
    expect(door.getAttribute("href")).toBe(SHORT.href);
  });

  it("hands the month's count to the group header, not to the rows", () => {
    renderLedger();
    expect(screen.getByText("24 trips")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Trips this month" })).toBeTruthy();
  });
});
