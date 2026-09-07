import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_SCHEMA,
  AVAILABILITY_WINDOW_DAYS,
  type AvailabilityTripInput,
  availabilityDocument,
  availabilityWindow,
  seatsOpen,
} from "./availability";

const NOW = new Date("2026-07-21T13:30:00Z");
const ORIGIN = "https://dive.day";
const shop = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  timezone: "America/New_York",
  currency: "usd",
};

function trip(overrides: Partial<AvailabilityTripInput> = {}): AvailabilityTripInput {
  return {
    id: "trip-1",
    title: "Molasses Reef two-tank",
    startsAt: new Date("2026-07-25T11:30:00Z"),
    endsAt: new Date("2026-07-25T16:00:00Z"),
    capacity: 12,
    booked: 9,
    priceCents: 13_000,
    conditionsHold: false,
    sites: ["Molasses Reef", "French Reef"],
    requirement: null,
    ...overrides,
  };
}

describe("availabilityWindow", () => {
  it("looks two weeks ahead on the shop's own calendar", () => {
    const window = availabilityWindow(NOW, "America/New_York");
    expect(window.from).toEqual(NOW);
    expect(window.to.toISOString()).toBe(
      `2026-08-0${4}T13:30:00.000Z`, // same wall clock, 14 days on, still EDT
    );
    expect(AVAILABILITY_WINDOW_DAYS).toBe(14);
  });
});

describe("seatsOpen", () => {
  it("is the seats left, floored at zero, and zero on a held boat", () => {
    expect(seatsOpen({ capacity: 12, booked: 9, conditionsHold: false })).toBe(3);
    expect(seatsOpen({ capacity: 12, booked: 14, conditionsHold: false })).toBe(0);
    expect(seatsOpen({ capacity: 12, booked: 0, conditionsHold: true })).toBe(0);
  });
});

describe("availabilityDocument", () => {
  it("writes one departure with every field an agent needs and nothing about a person", () => {
    const doc = availabilityDocument(
      shop,
      [
        trip({
          requirement: {
            minimumCertificationLevel: "advanced_open_water",
            requiredSpecialties: ["deep"],
            requiresNitrox: false,
          },
        }),
      ],
      ORIGIN,
      NOW,
    );
    expect(doc.schema).toBe(AVAILABILITY_SCHEMA);
    expect(doc.generated_at).toBe("2026-07-21T13:30:00.000Z");
    expect(doc.shop).toEqual({
      name: "Blue Mantis Divers",
      slug: "blue-mantis",
      time_zone: "America/New_York",
      currency: "USD",
      schedule_url: "https://dive.day/s/blue-mantis",
    });
    expect(doc.window).toEqual({
      from: "2026-07-21T09:30:00-04:00",
      to: "2026-08-04T09:30:00-04:00",
    });
    expect(doc.departures).toEqual([
      {
        id: "trip-1",
        title: "Molasses Reef two-tank",
        starts_at: "2026-07-25T07:30:00-04:00",
        ends_at: "2026-07-25T12:00:00-04:00",
        time_zone: "America/New_York",
        sites: ["Molasses Reef", "French Reef"],
        price: { amount: "130.00", currency: "USD" },
        certification: {
          minimum_level: "advanced_open_water",
          required_specialties: ["deep"],
          requires_nitrox: false,
        },
        seats_open: 3,
        booking_url: "https://dive.day/s/blue-mantis/trips/trip-1",
      },
    ]);
    // The key set is the contract: a field about a person cannot arrive
    // without changing this list, and this list says exactly what a reader
    // outside DiveDay may learn.
    expect(Object.keys(doc.departures[0] ?? {}).sort()).toEqual(
      [
        "booking_url",
        "certification",
        "ends_at",
        "id",
        "price",
        "seats_open",
        "sites",
        "starts_at",
        "time_zone",
        "title",
      ].sort(),
    );
  });

  it("leaves out a full boat, a held departure, and one outside the window", () => {
    const doc = availabilityDocument(
      shop,
      [
        trip({ id: "full", booked: 12 }),
        trip({ id: "held", conditionsHold: true }),
        trip({ id: "sailed", startsAt: new Date("2026-07-21T11:00:00Z") }),
        trip({ id: "far", startsAt: new Date("2026-08-05T11:30:00Z") }),
        trip({ id: "edge", startsAt: new Date("2026-08-04T13:30:00Z") }),
        trip({ id: "open" }),
      ],
      ORIGIN,
      NOW,
    );
    expect(doc.departures.map((d) => d.id)).toEqual(["open"]);
  });

  it("orders by departure and then id, whatever order the rows arrived in", () => {
    const doc = availabilityDocument(
      shop,
      [
        trip({ id: "b", startsAt: new Date("2026-07-26T11:30:00Z") }),
        trip({ id: "z", startsAt: new Date("2026-07-25T11:30:00Z") }),
        trip({ id: "a", startsAt: new Date("2026-07-25T11:30:00Z") }),
      ],
      ORIGIN,
      NOW,
    );
    expect(doc.departures.map((d) => d.id)).toEqual(["a", "z", "b"]);
  });

  it("publishes no price for an unpriced charter and no gate for a departure that asks nothing", () => {
    const [departure] = availabilityDocument(
      shop,
      [trip({ priceCents: null, requirement: null })],
      ORIGIN,
      NOW,
    ).departures;
    expect(departure?.price).toBeNull();
    expect(departure?.certification).toBeNull();
  });

  it("writes the price in the currency's own places", () => {
    const [departure] = availabilityDocument(
      { ...shop, currency: "jpy" },
      [trip({ priceCents: 5000 })],
      ORIGIN,
      NOW,
    ).departures;
    expect(departure?.price).toEqual({ amount: "5000", currency: "JPY" });
  });
});
