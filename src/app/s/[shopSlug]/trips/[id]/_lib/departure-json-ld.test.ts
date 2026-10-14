import { describe, expect, it } from "vitest";
import { publicAppUrl } from "@/lib/notifications";
import { tripPageJsonLd } from "@/lib/structured-data";
import { departureJsonLd } from "./departure-json-ld";

type Shop = Parameters<typeof departureJsonLd>[0];
type Trip = Parameters<typeof departureJsonLd>[1];

const shop: Shop = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  contactEmail: "hello@bluemantis.example",
  contactPhone: null,
  currency: "usd",
  addressStreet: "100 Ocean Drive",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: "33037",
  addressCountry: "US",
};
const trip: Trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  description: "A pair of reef dives.",
  startsAt: new Date("2026-08-04T12:00:00Z"),
  endsAt: new Date("2026-08-04T16:00:00Z"),
  capacity: 12,
  booked: 4,
  conditionsHold: false,
  diveSite: { name: "Molasses Reef" },
};
const aggregate = { average: 4.8, count: 21, suppressedCount: 0 };

describe("departureJsonLd", () => {
  it("is the departure's Event, its venue the dive site and its price the one passed", () => {
    expect(departureJsonLd(shop, trip, 9500, aggregate)).toEqual(
      tripPageJsonLd(
        shop,
        {
          id: "trip-1",
          title: "Two-Tank Reef",
          description: "A pair of reef dives.",
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
          capacity: 12,
          booked: 4,
          priceCents: 9500,
          diveSiteName: "Molasses Reef",
          conditionsHold: false,
        },
        publicAppUrl(),
        aggregate,
      ),
    );
  });

  it("names no venue for a departure with no site yet", () => {
    const withSite = JSON.stringify(departureJsonLd(shop, trip, 9500, null));
    const withoutSite = JSON.stringify(
      departureJsonLd(shop, { ...trip, diveSite: null }, 9500, null),
    );
    expect(withSite).toContain("Molasses Reef");
    expect(withoutSite).not.toContain("Molasses Reef");
  });

  it("makes no offer for an unpriced departure", () => {
    expect(JSON.stringify(departureJsonLd(shop, trip, null, null))).not.toContain('"offers"');
    expect(JSON.stringify(departureJsonLd(shop, trip, 9500, null))).toContain('"offers"');
  });
});
