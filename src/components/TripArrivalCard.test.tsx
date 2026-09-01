import { describe, expect, it } from "vitest";
import { arrivalCardFacts } from "./TripArrivalCard";

const shop = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  timezone: "America/New_York",
  contactPhone: null,
  contactEmail: null,
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
