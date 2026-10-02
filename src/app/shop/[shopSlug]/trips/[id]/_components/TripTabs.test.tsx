// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripTabs, type TripTabsCopy, tripTabHref } from "./TripTabs";

const copy: TripTabsCopy = {
  tabsLabel: "Departure",
  tabs: { divers: "Divers", checkin: "Check-in", boat: "Boat", gear: "Gear", details: "Details" },
  phaseLabel: "Stage",
  phases: { prep: "Prep", checkin: "Check-in", aboard: "Aboard", back: "Back" },
};

describe("TripTabs", () => {
  afterEach(cleanup);

  it("draws five tabs in order and marks the open one as the page", () => {
    render(<TripTabs shopSlug="s" tripId="t" current="gear" phase="prep" copy={copy} />);
    const nav = screen.getByRole("navigation", { name: "Departure" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Divers",
      "Check-in",
      "Boat",
      "Gear",
      "Details",
    ]);
    expect(within(nav).getByRole("link", { name: "Gear" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Divers" })).not.toHaveAttribute("aria-current");
  });

  it("marks the departure's stage as the current step", () => {
    render(<TripTabs shopSlug="s" tripId="t" current="divers" phase="aboard" copy={copy} />);
    const stepper = screen.getByRole("list", { name: "Stage" });
    expect(within(stepper).getByText("Aboard")).toHaveAttribute("aria-current", "step");
    expect(within(stepper).getByText("Prep")).not.toHaveAttribute("aria-current");
  });

  it("draws no stepper for a cancelled departure, and keeps the tabs", () => {
    render(<TripTabs shopSlug="s" tripId="t" current="divers" phase={null} copy={copy} />);
    expect(screen.queryByRole("list", { name: "Stage" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Departure" })).toBeInTheDocument();
  });
});

describe("tripTabHref", () => {
  it("points each tab at the surface that does that work", () => {
    expect(tripTabHref("s", "t", "divers")).toBe("/shop/s/trips/t");
    expect(tripTabHref("s", "t", "checkin")).toBe("/shop/s/check-in?trip=t");
    expect(tripTabHref("s", "t", "boat")).toBe("/shop/s/trips/t/manifest");
    expect(tripTabHref("s", "t", "gear")).toBe("/shop/s/trips/t/prep");
    expect(tripTabHref("s", "t", "details")).toBe("/shop/s/trips/t?view=details");
  });
});
