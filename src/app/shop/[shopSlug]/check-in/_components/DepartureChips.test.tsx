// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DepartureChips } from "./DepartureChips";

afterEach(() => {
  cleanup();
});

const departures = [
  { tripId: "trip-morning", time: "7:00 AM", title: "Molasses & French" },
  { tripId: "trip-afternoon", time: "1:00 PM", title: "Spiegel Grove" },
  { tripId: "trip-night", time: "7:30 PM", title: "Night Dive" },
];

describe("the departure chips", () => {
  it("carries the focus in the URL, so a bookmark and a refusal both keep it", () => {
    render(
      <DepartureChips
        ariaLabel="Choose a departure"
        shopSlug="blue-mantis"
        departures={departures}
        focusedTripId="trip-afternoon"
      />,
    );
    // Regex, not the exact string: the accessible name is built from two
    // nodes, and the separator between them is a rendered space rather than a
    // character, which jsdom's name computation trims away.
    expect(screen.getByRole("link", { name: /7:00 AM.*Molasses & French/ })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/check-in?trip=trip-morning",
    );
  });

  it("marks exactly one departure current", () => {
    render(
      <DepartureChips
        ariaLabel="Choose a departure"
        shopSlug="blue-mantis"
        departures={departures}
        focusedTripId="trip-afternoon"
      />,
    );
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("1:00 PM· Spiegel Grove");
  });

  it("renders nothing when there is only one boat to choose from", () => {
    // A control offering no choice is chrome doing the content's job: the
    // queue below already *is* that boat, and its title is the heading.
    const { container } = render(
      <DepartureChips
        ariaLabel="Choose a departure"
        shopSlug="blue-mantis"
        departures={[departures[0] as { tripId: string; time: string; title: string }]}
        focusedTripId="trip-morning"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the title from the phone's pixels without taking it out of the name", () => {
    // "8:00 AM · Deep Wreck Charter — the Duane on EANx" is wider than a 390px
    // phone and a `whitespace-nowrap` flex item will not shrink below its own
    // content, so below `sm` the title is `sr-only` rather than clipped. It is
    // still announced: the assertion above reads the accessible name and finds
    // the whole thing.
    render(
      <DepartureChips
        ariaLabel="Choose a departure"
        shopSlug="blue-mantis"
        departures={departures}
        focusedTripId="trip-morning"
      />,
    );
    const title = screen.getByText("· Molasses & French");
    expect(title.className).toContain("sr-only");
    expect(title.className).toContain("sm:not-sr-only");
  });

  it("renders nothing when the day holds no departures at all", () => {
    const { container } = render(
      <DepartureChips
        ariaLabel="Choose a departure"
        shopSlug="blue-mantis"
        departures={[]}
        focusedTripId="trip-morning"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
