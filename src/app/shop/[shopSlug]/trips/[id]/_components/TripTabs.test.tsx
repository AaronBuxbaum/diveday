// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripStageBadge, TripTabs, type TripTabsCopy, tripTabHref } from "./TripTabs";

const copy: TripTabsCopy = {
  tabsLabel: "Departure",
  tabs: { divers: "Divers", boat: "Boat", gear: "Gear", details: "Details" },
  phaseLabel: "Stage",
  phases: { prep: "Prep", checkin: "Check-in", aboard: "Aboard", back: "Back" },
};

describe("TripTabs", () => {
  afterEach(cleanup);

  it("draws four tabs in order and marks the open one as the page", () => {
    render(<TripTabs shopSlug="s" tripId="t" current="gear" copy={copy} />);
    const nav = screen.getByRole("navigation", { name: "Departure" });
    const links = within(nav).getAllByRole("link");
    // No Check-in tab: arrival is a state of the Divers roster (owner,
    // 2026-10-05), so the desk's list is the one list.
    expect(links.map((link) => link.textContent)).toEqual(["Divers", "Boat", "Gear", "Details"]);
    expect(within(nav).getByRole("link", { name: "Gear" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Divers" })).not.toHaveAttribute("aria-current");
  });

  it("draws no stage stepper above the tabs", () => {
    render(<TripTabs shopSlug="s" tripId="t" current="divers" copy={copy} />);
    expect(screen.queryByRole("list", { name: "Stage" })).toBeNull();
    expect(screen.queryByText("Aboard")).toBeNull();
  });
});

describe("TripStageBadge", () => {
  afterEach(cleanup);

  it("says the stage in one word, named as the stage for a screen reader", () => {
    render(<TripStageBadge phase="aboard" copy={copy} />);
    expect(screen.getByText("Aboard")).toBeInTheDocument();
    expect(screen.getByText(/Stage:/)).toHaveClass("sr-only");
  });

  it("draws nothing for a canceled departure", () => {
    const { container } = render(<TripStageBadge phase={null} copy={copy} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("tripTabHref", () => {
  it("points each tab at the surface that does that work", () => {
    expect(tripTabHref("s", "t", "divers")).toBe("/shop/s/trips/t");
    expect(tripTabHref("s", "t", "boat")).toBe("/shop/s/trips/t/manifest");
    expect(tripTabHref("s", "t", "gear")).toBe("/shop/s/trips/t/prep");
    expect(tripTabHref("s", "t", "details")).toBe("/shop/s/trips/t?view=details");
  });
});
