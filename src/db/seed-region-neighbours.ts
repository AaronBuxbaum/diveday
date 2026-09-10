import type { DbExecutor } from "./client";
import { upsertTripRequirements } from "./readiness";
import { diveSites, shops } from "./schema";
import { at, DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { createTrip } from "./trips";

/**
 * **Two more shops on Key Largo's regional page** (issue #1436, N-49).
 *
 * `/dive/key-largo` lists every *listed* shop in the town — not a demo, not
 * opted out of search, with something scheduled — and the canonical demo is
 * a demo, so on its own the fixture would photograph an empty region. These
 * two are the neighbours: real (`isDemo: false`) rows with a Key Largo
 * address, one dive site each, and a handful of public departures inside the
 * next two weeks, so the page and its visual baseline show two operators
 * side by side and the sitemap has a shop to list.
 *
 * They are deliberately thin: no staff, no logins, no bookings, no history.
 * Nothing signs into them, nothing resets them (`/api/test/reset` restores
 * the demo's schedule and purges minted demos, and touches neither), and
 * nothing about them is personal. A test that needs a *shop* uses
 * `privateShop`; these exist so a *page about a place* has a place to show.
 *
 * Not a seed scenario the demo shop owns — `seedDemoSchedule` seeds one
 * shop's board and re-runs on reset; this runs once, beside the shop's own
 * stable half, in `seedDemo`.
 */
export const REGION_NEIGHBOUR_SLUGS = ["reef-line-divers", "keys-current-charters"] as const;

export async function seedRegionNeighbours(db: DbExecutor): Promise<void> {
  const address = {
    addressLocality: "Key Largo",
    addressRegion: "FL",
    addressPostalCode: "33037",
    addressCountry: "US",
    regionSlug: "key-largo",
  };
  const [reefLine, keysCurrent] = await db
    .insert(shops)
    .values([
      {
        name: "Reef Line Divers",
        slug: REGION_NEIGHBOUR_SLUGS[0],
        // i18n-exempt: a shop types its own tagline.
        tagline: "Two tanks on the outer reef, every morning.",
        timezone: DEMO_SHOP_TIMEZONE,
        unitsConfirmedAt: at(-30, 9),
        contactEmail: "desk@reefline.invalid",
        addressStreet: "88 Marina Way",
        latitude: 25.09,
        longitude: -80.44,
        ...address,
      },
      {
        name: "Keys Current Charters",
        slug: REGION_NEIGHBOUR_SLUGS[1],
        // i18n-exempt: a shop types its own tagline.
        tagline: "Wrecks and drift dives, small groups.",
        timezone: DEMO_SHOP_TIMEZONE,
        unitsConfirmedAt: at(-30, 9),
        contactEmail: "hello@keyscurrent.invalid",
        addressStreet: "12 Dock Road",
        latitude: 25.08,
        longitude: -80.45,
        ...address,
      },
    ])
    .returning({ id: shops.id });
  if (!reefLine || !keysCurrent) throw new Error("seedRegionNeighbours: shops did not insert");

  const [frenchReef, spiegelGrove] = await db
    .insert(diveSites)
    .values([
      {
        shopId: reefLine.id,
        name: "French Reef",
        slug: "french-reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0347,
        forecastLongitude: -80.3495,
      },
      {
        shopId: keysCurrent.id,
        name: "Spiegel Grove",
        slug: "spiegel-grove",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0672,
        forecastLongitude: -80.3055,
        minimumCertificationLevel: "advanced_open_water",
      },
    ])
    .returning({ id: diveSites.id });
  if (!frenchReef || !spiegelGrove) throw new Error("seedRegionNeighbours: sites did not insert");

  const hours = (n: number) => n * 60 * 60 * 1000;
  const departures = [
    // Reef Line: a morning two-tank most days, one afternoon.
    {
      shopId: reefLine.id,
      diveSiteId: frenchReef.id,
      title: "Morning Two-Tank Reef",
      startsAt: at(1, 8),
      capacity: 12,
      priceCents: 11_000,
    },
    {
      shopId: reefLine.id,
      diveSiteId: frenchReef.id,
      title: "Afternoon Reef",
      startsAt: at(2, 13),
      capacity: 12,
      priceCents: 9_500,
    },
    {
      shopId: reefLine.id,
      diveSiteId: frenchReef.id,
      title: "Morning Two-Tank Reef",
      startsAt: at(5, 8, 30),
      capacity: 12,
      priceCents: 11_000,
    },
    {
      shopId: reefLine.id,
      diveSiteId: frenchReef.id,
      title: "Morning Two-Tank Reef",
      startsAt: at(10, 8),
      capacity: 12,
      priceCents: 11_000,
    },
    // Keys Current: wrecks, which ask for an Advanced card.
    {
      shopId: keysCurrent.id,
      diveSiteId: spiegelGrove.id,
      title: "Spiegel Grove Wreck",
      startsAt: at(1, 9),
      capacity: 8,
      priceCents: 14_500,
    },
    {
      shopId: keysCurrent.id,
      diveSiteId: spiegelGrove.id,
      title: "Spiegel Grove Wreck",
      startsAt: at(3, 8),
      capacity: 8,
      priceCents: 14_500,
    },
    {
      shopId: keysCurrent.id,
      diveSiteId: spiegelGrove.id,
      title: "Wreck and Drift",
      startsAt: at(6, 13, 30),
      capacity: 8,
      priceCents: 15_500,
    },
    {
      shopId: keysCurrent.id,
      diveSiteId: spiegelGrove.id,
      title: "Spiegel Grove Wreck",
      startsAt: at(12, 8),
      capacity: 8,
      priceCents: 14_500,
    },
  ];
  for (const departure of departures) {
    const trip = await createTrip(db, {
      ...departure,
      endsAt: new Date(departure.startsAt.getTime() + hours(4)),
    });
    if (!trip) throw new Error(`seedRegionNeighbours: ${departure.title} did not insert`);
    if (departure.shopId === keysCurrent.id) {
      await upsertTripRequirements(db, {
        shopId: keysCurrent.id,
        tripId: trip.id,
        requiresWaiver: true,
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: ["wreck"],
        requiresNitrox: false,
        requiresPayment: false,
      });
    }
  }
}
