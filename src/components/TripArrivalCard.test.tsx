// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { arrivalCardFacts, TripArrivalCard } from "./TripArrivalCard";

afterEach(cleanup);

const shop = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  timezone: "America/New_York",
  contactPhone: null,
  contactEmail: null,
  dockCallNote: null,
  address: {
    street: "100 Ocean Drive",
    locality: "Key Largo",
    region: "FL",
    postalCode: "33037",
    country: "US",
  },
};

const trip = {
  id: "trip-1",
  title: "Reef morning",
  startsAt: new Date("2030-08-01T13:00:00.000Z"),
  endsAt: new Date("2030-08-01T17:00:00.000Z"),
  meetingPointLabel: null,
  meetingPointAddress: null,
  arrivalLandmark: "  Blue sign  ",
  arrivalParkingNote: null,
  arrivalTransitNote: "  Bus 4  ",
  arrivalLookFor: null,
  arrivalFirstInteraction: "  Ask the dock host  ",
  arrivalPhotoUrl: null,
};

describe("arrivalCardFacts", () => {
  it("falls back to the shop address and map when no custom meeting point exists", () => {
    expect(arrivalCardFacts(shop, trip)).toMatchObject({
      label: "Blue Mantis Divers",
      address: "100 Ocean Drive, Key Largo, FL 33037, US",
      mapQuery: "Blue Mantis Divers, 100 Ocean Drive, Key Largo, FL 33037, US",
      landmark: "Blue sign",
      transitNote: "Bus 4",
      firstInteraction: "Ask the dock host",
    });
  });

  it("uses the trip's custom meeting point without changing the shop fallback", () => {
    expect(
      arrivalCardFacts(shop, {
        ...trip,
        meetingPointLabel: "  North Jetty  ",
        meetingPointAddress: "  12 Dock Road  ",
      }),
    ).toMatchObject({
      label: "North Jetty",
      address: "12 Dock Road",
      mapQuery: "North Jetty, 12 Dock Road",
    });
  });

  /**
   * **The shop's standing sentence, and only where the departure wrote none**
   * (issue #1212). Two answers to one question is the defect, so the
   * departure's own words always win.
   */
  it("falls back to the shop's standing dock-call sentence, and never over the trip's own", () => {
    const withStanding = { ...shop, dockCallNote: "  Come to the blue gate, we'll wave.  " };
    expect(arrivalCardFacts(withStanding, trip)).toMatchObject({
      firstInteraction: "Ask the dock host",
    });
    expect(
      arrivalCardFacts(withStanding, { ...trip, arrivalFirstInteraction: null }),
    ).toMatchObject({ firstInteraction: "Come to the blue gate, we'll wave." });
    expect(
      arrivalCardFacts(shop, { ...trip, arrivalFirstInteraction: null }).firstInteraction,
    ).toBeNull();
  });

  it("keeps a map destination when only the custom meeting label is set", () => {
    expect(
      arrivalCardFacts(shop, {
        ...trip,
        meetingPointLabel: "  North Jetty  ",
      }),
    ).toMatchObject({
      label: "North Jetty",
      address: "100 Ocean Drive, Key Largo, FL 33037, US",
      mapQuery: "North Jetty, 100 Ocean Drive, Key Largo, FL 33037, US",
    });
  });
});

/**
 * **Where the day is planned to go, and who said so** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 5.
 *
 * A shop-typed title need not name a site, and this row is the only place the
 * order and the provenance appear together. It carries no time: the plan's own
 * timestamp is the change ledger's to state, and a second one here would be the
 * same fact twice.
 */
describe("the Sites row", () => {
  it("reads in the order the day runs them, over the Plan chip", () => {
    render(
      <TripArrivalCard
        shop={shop}
        trip={trip}
        locale="en-US"
        sites={["Molasses Reef", "French Reef"]}
      />,
    );
    expect(screen.getByText("Sites")).toBeInTheDocument();
    // The order is the day's, never alphabetical.
    expect(screen.getByText("Molasses Reef, French Reef")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("renders nothing at all when the caller names no sites", () => {
    const { rerender } = render(<TripArrivalCard shop={shop} trip={trip} locale="en-US" />);
    expect(screen.queryByText("Sites")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();

    rerender(<TripArrivalCard shop={shop} trip={trip} locale="en-US" sites={[]} />);
    expect(screen.queryByText("Sites")).not.toBeInTheDocument();
  });
});
