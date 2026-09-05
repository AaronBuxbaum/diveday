// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { type TripAlternative, TripAlternatives } from "./TripAlternatives";

/**
 * D01's surface (#1161): at most two other departures, each printing the
 * visible fact that put it there. Guidance, never a gate — and silent whenever
 * the comparator found nothing genuinely relevant, which is most departures.
 */

afterEach(cleanup);

function alternative(over: Partial<TripAlternative> = {}): TripAlternative {
  return {
    tripId: "trip-2",
    title: "Benwood & French",
    href: "/s/blue-mantis/trips/trip-2",
    when: "Fri 8:00 AM",
    seatsOpen: 7,
    reason: "same_site",
    partOfDay: "morning",
    ...over,
  };
}

describe("TripAlternatives", () => {
  it("renders nothing when nothing is worth offering", () => {
    const { container } = render(
      <TripAlternatives alternatives={[]} locale={DEFAULT_DIVER_LOCALE} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("prints each row's reason and its seat count beside the departure", () => {
    render(
      <TripAlternatives
        alternatives={[
          alternative(),
          alternative({
            tripId: "trip-3",
            title: "Macro Afternoon",
            href: "/s/blue-mantis/trips/trip-3",
            when: "Fri 1:00 PM",
            seatsOpen: 4,
            reason: "gentler",
            partOfDay: "afternoon",
          }),
        ]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getByText("Benwood & French")).toBeInTheDocument();
    expect(screen.getByText("The same site, another day.")).toBeInTheDocument();
    expect(screen.getByText("7 spots left")).toBeInTheDocument();
    expect(screen.getByText("Macro Afternoon")).toBeInTheDocument();
    expect(screen.getByText("The shop rates this site for beginners.")).toBeInTheDocument();
    expect(screen.getByText("4 spots left")).toBeInTheDocument();
  });

  it("says which part of the day, not merely that it is the same one", () => {
    // "Also an afternoon boat" and "also a morning boat" are different
    // sentences, and one of them is always wrong for a given row.
    render(
      <TripAlternatives
        alternatives={[alternative({ reason: "same_time_of_day", partOfDay: "afternoon" })]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getByText("Also an afternoon boat.")).toBeInTheDocument();
  });

  it("carries the frame through to the departure it offers", () => {
    // An embedded widget that linked out of the frame would drop a diver on the
    // shop's own site mid-booking.
    render(
      <TripAlternatives
        alternatives={[alternative({ href: "/s/blue-mantis/trips/trip-2?embed=1" })]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getByRole("link", { name: "Benwood & French" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/trips/trip-2?embed=1",
    );
  });
});
