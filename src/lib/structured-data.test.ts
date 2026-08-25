import { describe, expect, it } from "vitest";
import { EMPTY_REVIEW_AGGREGATE } from "./reviews";
import {
  absoluteUrl,
  type CourseForStructuredData,
  coursePageJsonLd,
  type JsonLdObject,
  pruneJsonLd,
  type ReviewForStructuredData,
  reviewsJsonLd,
  type ShopForStructuredData,
  scheduleJsonLd,
  shopAddressOf,
  shopJsonLd,
  type TripForStructuredData,
  tripPageJsonLd,
} from "./structured-data";

const ORIGIN = "https://diveday.example";

/**
 * A shop with an address on file, which is what a set-up shop looks like — and
 * what the Event needs to be eligible at all. This fixture carried five nulls
 * until 2026-08-22, so every `tripPageJsonLd` case below was silently asserting
 * against an Event Google rejects (issue #703). `addresslessShop` is the state
 * that used to be the default; it now has one test rather than all of them.
 */
const shop: ShopForStructuredData = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  contactEmail: "hello@bluemantis.example",
  contactPhone: "+1 305 555 0134",
  currency: "usd",
  addressStreet: "100 Ocean Drive",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: "33037",
  addressCountry: "US",
};

/** A shop legitimately set up with no street address — see `shopAddressOf`. */
const addresslessShop: ShopForStructuredData = {
  ...shop,
  addressStreet: null,
  addressLocality: null,
  addressRegion: null,
  addressPostalCode: null,
  addressCountry: null,
};

const trip: TripForStructuredData = {
  id: "trip-1",
  title: "Two-Tank Reef — Molasses",
  description: "A relaxed pair of reef dives.",
  startsAt: new Date("2026-08-04T12:00:00.000Z"),
  endsAt: new Date("2026-08-04T16:00:00.000Z"),
  capacity: 12,
  booked: 4,
  priceCents: 18_000,
  diveSiteName: "Molasses Reef",
  conditionsHold: false,
};

const review: ReviewForStructuredData = {
  reviewer: "Marta R.",
  rating: 5,
  comment: "Great reef dive, the crew was fantastic.",
  divedAt: new Date("2026-07-15T10:00:00.000Z"),
};

/** Reach into a graph the way a consumer would, without fighting the index type. */
function at(graph: JsonLdObject, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") return (value as Record<string, unknown>)[key];
    return undefined;
  }, graph);
}

describe("absoluteUrl", () => {
  it("resolves a path against the canonical origin", () => {
    expect(absoluteUrl(ORIGIN, "/s/blue-mantis")).toBe("https://diveday.example/s/blue-mantis");
  });

  it("gives back nothing when no origin is configured, rather than a relative URL", () => {
    expect(absoluteUrl(null, "/s/blue-mantis")).toBeNull();
  });
});

describe("pruneJsonLd", () => {
  it("drops null and undefined keys, since a null reads as a claim about the thing", () => {
    expect(pruneJsonLd({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
  });

  it("prunes recursively and removes a branch left empty", () => {
    expect(pruneJsonLd({ outer: { inner: null }, kept: "yes" })).toEqual({ kept: "yes" });
  });

  it("keeps falsy values that are real data", () => {
    expect(pruneJsonLd({ zero: 0, empty: "", no: false })).toEqual({
      zero: 0,
      empty: "",
      no: false,
    });
  });
});

describe("shopAddressOf", () => {
  it("builds a PostalAddress when every field is set", () => {
    const address = shopAddressOf({
      ...shop,
      addressStreet: "99 Coral Way",
      addressLocality: "Cozumel",
      addressRegion: "Quintana Roo",
      addressPostalCode: "77600",
      addressCountry: "MX",
    });
    expect(address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "99 Coral Way",
      addressLocality: "Cozumel",
      addressRegion: "Quintana Roo",
      postalCode: "77600",
      addressCountry: "MX",
    });
  });

  it("emits nothing when no address field is set at all", () => {
    expect(shopAddressOf(addresslessShop)).toBeUndefined();
  });

  it("still builds a partial PostalAddress when only some fields are set", () => {
    const address = shopAddressOf({ ...addresslessShop, addressCountry: "MX" });
    expect(address).toEqual({
      "@type": "PostalAddress",
      streetAddress: null,
      addressLocality: null,
      addressRegion: null,
      postalCode: null,
      addressCountry: "MX",
    });
  });
});

describe("reviewsJsonLd", () => {
  it("maps a published review to a schema.org Review", () => {
    const [graph] = reviewsJsonLd([review]) ?? [];
    expect(graph).toEqual({
      "@type": "Review",
      author: { "@type": "Person", name: "Marta R." },
      reviewRating: {
        "@type": "Rating",
        ratingValue: 5,
        bestRating: 5,
        worstRating: 1,
      },
      reviewBody: "Great reef dive, the crew was fantastic.",
      datePublished: "2026-07-15T10:00:00.000Z",
    });
  });

  it("returns undefined for an empty list, never an empty array", () => {
    expect(reviewsJsonLd([])).toBeUndefined();
  });
});

describe("shopJsonLd", () => {
  it("types a dive shop as a SportsActivityLocation with its public contact details", () => {
    const graph = shopJsonLd(shop, ORIGIN);
    expect(graph["@type"]).toBe("SportsActivityLocation");
    expect(graph.name).toBe("Blue Mantis Divers");
    expect(graph.url).toBe("https://diveday.example/s/blue-mantis");
  });

  it("omits the address key entirely when the shop has none on file", () => {
    expect(shopJsonLd(addresslessShop, ORIGIN).address).toBeUndefined();
  });

  it("publishes a full PostalAddress once the shop has one on file", () => {
    const graph = shopJsonLd(
      {
        ...shop,
        addressStreet: "99 Coral Way",
        addressLocality: "Cozumel",
        addressRegion: "Quintana Roo",
        addressPostalCode: "77600",
        addressCountry: "MX",
      },
      ORIGIN,
    );
    expect(graph.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "99 Coral Way",
      addressLocality: "Cozumel",
      addressRegion: "Quintana Roo",
      postalCode: "77600",
      addressCountry: "MX",
    });
  });

  it("omits aggregateRating entirely when nothing is published — never 'rated by nobody'", () => {
    expect(shopJsonLd(shop, ORIGIN).aggregateRating).toBeUndefined();
    expect(shopJsonLd(shop, ORIGIN, EMPTY_REVIEW_AGGREGATE).aggregateRating).toBeUndefined();
  });

  it("publishes the real average and count once reviews exist", () => {
    const graph = shopJsonLd(shop, ORIGIN, { count: 7, average: 4.6, suppressedCount: 0 });
    expect(graph.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.6,
      reviewCount: 7,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it("omits review entirely when the caller passes none", () => {
    expect(shopJsonLd(shop, ORIGIN).review).toBeUndefined();
    expect(shopJsonLd(shop, ORIGIN, null, []).review).toBeUndefined();
  });

  it("publishes description and image when provided", () => {
    const brandedShop: ShopForStructuredData = {
      ...shop,
      tagline: "Diving the Florida Keys",
      description: "A friendly, family-owned dive operation.",
      logoUrl: "https://diveday.example/storage/shop-logos/logo.webp",
    };
    const graph = shopJsonLd(brandedShop, ORIGIN);
    expect(graph.description).toBe("A friendly, family-owned dive operation.");
    expect(graph.image).toBe("https://diveday.example/storage/shop-logos/logo.webp");
  });

  it("falls back to tagline for description when description is unset", () => {
    const taglineOnlyShop: ShopForStructuredData = {
      ...shop,
      tagline: "Diving the Florida Keys",
      description: null,
    };
    const graph = shopJsonLd(taglineOnlyShop, ORIGIN);
    expect(graph.description).toBe("Diving the Florida Keys");
    expect(graph.image).toBeUndefined();
  });

  it("publishes a review array only when reviews are passed", () => {
    const graph = shopJsonLd(shop, ORIGIN, null, [review]);
    expect(graph.review).toEqual([
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Marta R." },
        reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 },
        reviewBody: "Great reef dive, the crew was fantastic.",
        datePublished: "2026-07-15T10:00:00.000Z",
      },
    ]);
  });
});

/**
 * Every case below is about a shop with an address, so the Event exists. This
 * unwraps the `| null` in one place rather than making each assertion carry a
 * `?.` that would quietly pass against no Event at all.
 */
function eventFor(graph: JsonLdObject | null): JsonLdObject {
  if (!graph) throw new Error("expected an Event — this shop has an address on file");
  return graph;
}

describe("tripPageJsonLd", () => {
  it("describes the departure as a bookable offline Event", () => {
    const graph = eventFor(tripPageJsonLd(shop, trip, ORIGIN));
    expect(graph["@context"]).toBe("https://schema.org");
    expect(graph["@type"]).toBe("Event");
    expect(graph.startDate).toBe("2026-08-04T12:00:00.000Z");
    expect(graph.eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
    expect(graph.remainingAttendeeCapacity).toBe(8);
    expect(at(graph, "location.name")).toBe("Molasses Reef");
    expect(at(graph, "offers.price")).toBe("180.00");
    expect(at(graph, "offers.availability")).toBe("https://schema.org/InStock");
  });

  it("publishes the offer in the shop's own currency, not dollars", () => {
    const graph = eventFor(tripPageJsonLd({ ...shop, currency: "mxn" }, trip, ORIGIN));
    expect(at(graph, "offers.priceCurrency")).toBe("MXN");
    expect(at(graph, "offers.price")).toBe("180.00");
  });

  // A fixed `.toFixed(2)` published a ¥18,000 charter as "180.00" — a price a
  // hundred times too low, to the one audience that can't ask about it.
  it("uses the currency's own decimal places for a zero-decimal currency", () => {
    const graph = eventFor(tripPageJsonLd({ ...shop, currency: "jpy" }, trip, ORIGIN));
    expect(at(graph, "offers.priceCurrency")).toBe("JPY");
    expect(at(graph, "offers.price")).toBe("18000");
  });

  /**
   * **`location.address` is what makes the Event eligible at all.**
   *
   * Google requires it for an offline event; a `Place` carrying only a name is
   * an error in the Rich Results Test, and the whole Event — seat count,
   * availability, offer and all — is dropped from the rich result. Every
   * departure this app has published was in that state, and this file never
   * caught it because it asserted `location.name` and nothing else, against a
   * fixture that had no address (issue #703).
   */
  it("gives the venue the shop's postal address, keeping the dive site's name", () => {
    const graph = eventFor(tripPageJsonLd(shop, trip, ORIGIN));

    expect(at(graph, "location.name")).toBe("Molasses Reef");
    expect(at(graph, "location.address")).toEqual({
      "@type": "PostalAddress",
      streetAddress: "100 Ocean Drive",
      addressLocality: "Key Largo",
      addressRegion: "FL",
      postalCode: "33037",
      addressCountry: "US",
    });
  });

  it("emits no Event at all for a shop with no address, rather than an invalid one", () => {
    // A real, deliberate state — a shop can be fully set up with no street. A
    // missing rich result beats a permanent error in its Search Console, and
    // it is the same call `shopAddressOf` makes about an address of five nulls.
    expect(tripPageJsonLd(addresslessShop, trip, ORIGIN)).toBeNull();
  });

  it.each([
    ["null", null],
    // An empty string too: `pruneJsonLd` drops null and undefined but keeps
    // `""`, so a `??` here would publish a Place with no name at all.
    ["blank", ""],
  ])(
    "falls back to the shop as the venue when the dive site name is %s",
    (_label, diveSiteName) => {
      const graph = eventFor(tripPageJsonLd(shop, { ...trip, diveSiteName }, ORIGIN));
      expect(at(graph, "location.name")).toBe("Blue Mantis Divers");
    },
  );

  it("makes no offer at all for an unpriced charter, rather than publishing it as free", () => {
    const graph = eventFor(tripPageJsonLd(shop, { ...trip, priceCents: null }, ORIGIN));
    expect(graph.offers).toBeUndefined();
  });

  it("reports a full trip as sold out", () => {
    const graph = eventFor(tripPageJsonLd(shop, { ...trip, booked: 12 }, ORIGIN));
    expect(at(graph, "offers.availability")).toBe("https://schema.org/SoldOut");
    expect(graph.remainingAttendeeCapacity).toBe(0);
  });

  it("reports a trip on a conditions hold as sold out — it cannot be booked right now", () => {
    const graph = eventFor(tripPageJsonLd(shop, { ...trip, conditionsHold: true }, ORIGIN));
    expect(at(graph, "offers.availability")).toBe("https://schema.org/SoldOut");
  });

  it("never reports negative capacity if an overbooked roster ever slips through", () => {
    const graph = eventFor(tripPageJsonLd(shop, { ...trip, booked: 20 }, ORIGIN));
    expect(graph.remainingAttendeeCapacity).toBe(0);
  });

  it("carries no personal data — only what the page already shows a stranger", () => {
    const serialized = JSON.stringify(
      tripPageJsonLd(shop, trip, ORIGIN, { count: 3, average: 5, suppressedCount: 0 }),
    );
    for (const forbidden of ["personId", "bookingId", "@example.com>", "diver"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("scheduleJsonLd", () => {
  it("lists upcoming departures in order", () => {
    const graph = scheduleJsonLd(shop, [trip, { ...trip, id: "trip-2" }], ORIGIN);
    expect(graph["@type"]).toBe("ItemList");
    expect(graph.numberOfItems).toBe(2);
    const items = graph.itemListElement as JsonLdObject[];
    expect(items.map((item) => item.position)).toEqual([1, 2]);
    expect(at(items[1], "item.url")).toBe("https://diveday.example/s/blue-mantis/trips/trip-2");
  });

  it("describes the shop alone when nothing is on the books, not a list of zero", () => {
    const graph = scheduleJsonLd(shop, [], ORIGIN);
    expect(graph["@type"]).toBe("SportsActivityLocation");
    expect(graph.itemListElement).toBeUndefined();
  });

  it("omits review when the page passes none", () => {
    expect(scheduleJsonLd(shop, [trip], ORIGIN).review).toBeUndefined();
    expect(scheduleJsonLd(shop, [], ORIGIN).review).toBeUndefined();
  });

  it("publishes the page's reviews on the ItemList when there are upcoming trips", () => {
    const graph = scheduleJsonLd(shop, [trip], ORIGIN, null, [review]);
    expect(graph["@type"]).toBe("ItemList");
    expect(graph.review).toEqual([
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Marta R." },
        reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 },
        reviewBody: "Great reef dive, the crew was fantastic.",
        datePublished: "2026-07-15T10:00:00.000Z",
      },
    ]);
  });

  it("publishes the page's reviews on the bare shop node when there are no upcoming trips", () => {
    const graph = scheduleJsonLd(shop, [], ORIGIN, null, [review]);
    expect(graph["@type"]).toBe("SportsActivityLocation");
    expect(graph.review).toEqual([
      {
        "@type": "Review",
        author: { "@type": "Person", name: "Marta R." },
        reviewRating: { "@type": "Rating", ratingValue: 5, bestRating: 5, worstRating: 1 },
        reviewBody: "Great reef dive, the crew was fantastic.",
        datePublished: "2026-07-15T10:00:00.000Z",
      },
    ]);
  });

  it("falls back to the bare shop when no departure can carry an address", () => {
    // With no address every Event is omitted, and an ItemList of zero is the
    // same noise an empty schedule is — the shop node already says "this
    // operator exists, with nothing on the books" (issue #703).
    const graph = scheduleJsonLd(addresslessShop, [trip, { ...trip, id: "trip-2" }], ORIGIN);
    expect(graph["@type"]).toBe("SportsActivityLocation");
    expect(graph.itemListElement).toBeUndefined();
  });

  it("never threads reviews into a per-trip Event's organizer", () => {
    const graph = scheduleJsonLd(shop, [trip], ORIGIN, null, [review]);
    const items = graph.itemListElement as JsonLdObject[];
    expect(at(items[0], "item.organizer.review")).toBeUndefined();
  });
});

describe("coursePageJsonLd", () => {
  const course: CourseForStructuredData = {
    slug: "open-water",
    title: "Open Water Diver",
    agency: "PADI",
    summary: "Your first certification.",
    description: "The long version.",
    priceCents: 55_000,
    durationText: "3 days",
  };

  it("names the shop as provider and the agency card as the credential", () => {
    const graph = coursePageJsonLd(shop, course, ORIGIN);
    expect(graph["@type"]).toBe("Course");
    expect(at(graph, "provider.name")).toBe("Blue Mantis Divers");
    expect(graph.educationalCredentialAwarded).toBe("PADI Open Water Diver");
    expect(graph.description).toBe("Your first certification.");
    expect(at(graph, "offers.price")).toBe("550.00");
  });

  it("falls back to the long description and the bare title without an agency", () => {
    const graph = coursePageJsonLd(shop, { ...course, agency: null, summary: null }, ORIGIN);
    expect(graph.educationalCredentialAwarded).toBe("Open Water Diver");
    expect(graph.description).toBe("The long version.");
  });
});

describe("aggregateRating and a curated record", () => {
  const shop = {
    name: "Blue Mantis Divers",
    slug: "blue-mantis",
    contactEmail: null,
    contactPhone: null,
    currency: "usd",
    addressStreet: null,
    addressLocality: null,
    addressRegion: null,
    addressPostalCode: null,
    addressCountry: null,
  };

  it("publishes the rating for a shop that has taken little down", () => {
    const graph = shopJsonLd(shop, "https://dive.day", {
      count: 9,
      average: 4.8,
      suppressedCount: 1,
    });
    expect(graph.aggregateRating).toMatchObject({ ratingValue: 4.8, reviewCount: 9 });
  });

  it("withholds it once the shop has hidden too much of its own record", () => {
    // A 5.0 over six reviews, with six more taken down, is not a measurement
    // DiveDay will hand a search engine on the shop's behalf
    // (ADR 20260813-review-moderation-has-a-floor).
    const graph = shopJsonLd(shop, "https://dive.day", {
      count: 6,
      average: 5,
      suppressedCount: 6,
    });
    expect(graph.aggregateRating).toBeUndefined();
  });
});
