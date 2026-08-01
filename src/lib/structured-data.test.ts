import { describe, expect, it } from "vitest";
import { EMPTY_REVIEW_AGGREGATE } from "./reviews";
import {
  absoluteUrl,
  type CourseForStructuredData,
  coursePageJsonLd,
  type JsonLdObject,
  pruneJsonLd,
  type ShopForStructuredData,
  scheduleJsonLd,
  shopJsonLd,
  type TripForStructuredData,
  tripPageJsonLd,
} from "./structured-data";

const ORIGIN = "https://diveday.example";

const shop: ShopForStructuredData = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  contactEmail: "hello@bluemantis.example",
  contactPhone: "+1 305 555 0134",
  currency: "usd",
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

/** Reach into a graph the way a consumer would, without fighting the index type. */
function at(graph: JsonLdObject, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") return (value as Record<string, unknown>)[key];
    return undefined;
  }, graph);
}

describe("absoluteUrl", () => {
  it("resolves a path against the canonical origin", () => {
    expect(absoluteUrl(ORIGIN, "/shop/blue-mantis/schedule")).toBe(
      "https://diveday.example/shop/blue-mantis/schedule",
    );
  });

  it("gives back nothing when no origin is configured, rather than a relative URL", () => {
    expect(absoluteUrl(null, "/shop/blue-mantis/schedule")).toBeNull();
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

describe("shopJsonLd", () => {
  it("types a dive shop as a SportsActivityLocation with its public contact details", () => {
    const graph = shopJsonLd(shop, ORIGIN);
    expect(graph["@type"]).toBe("SportsActivityLocation");
    expect(graph.name).toBe("Blue Mantis Divers");
    expect(graph.url).toBe("https://diveday.example/shop/blue-mantis/schedule");
  });

  it("omits aggregateRating entirely when nothing is published — never 'rated by nobody'", () => {
    expect(shopJsonLd(shop, ORIGIN).aggregateRating).toBeUndefined();
    expect(shopJsonLd(shop, ORIGIN, EMPTY_REVIEW_AGGREGATE).aggregateRating).toBeUndefined();
  });

  it("publishes the real average and count once reviews exist", () => {
    const graph = shopJsonLd(shop, ORIGIN, { count: 7, average: 4.6 });
    expect(graph.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.6,
      reviewCount: 7,
      bestRating: 5,
      worstRating: 1,
    });
  });
});

describe("tripPageJsonLd", () => {
  it("describes the departure as a bookable offline Event", () => {
    const graph = tripPageJsonLd(shop, trip, ORIGIN);
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
    const graph = tripPageJsonLd({ ...shop, currency: "mxn" }, trip, ORIGIN);
    expect(at(graph, "offers.priceCurrency")).toBe("MXN");
    expect(at(graph, "offers.price")).toBe("180.00");
  });

  // A fixed `.toFixed(2)` published a ¥18,000 charter as "180.00" — a price a
  // hundred times too low, to the one audience that can't ask about it.
  it("uses the currency's own decimal places for a zero-decimal currency", () => {
    const graph = tripPageJsonLd({ ...shop, currency: "jpy" }, trip, ORIGIN);
    expect(at(graph, "offers.priceCurrency")).toBe("JPY");
    expect(at(graph, "offers.price")).toBe("18000");
  });

  it("falls back to the shop as the venue when no dive site is named", () => {
    const graph = tripPageJsonLd(shop, { ...trip, diveSiteName: null }, ORIGIN);
    expect(at(graph, "location.name")).toBe("Blue Mantis Divers");
  });

  it("makes no offer at all for an unpriced charter, rather than publishing it as free", () => {
    const graph = tripPageJsonLd(shop, { ...trip, priceCents: null }, ORIGIN);
    expect(graph.offers).toBeUndefined();
  });

  it("reports a full trip as sold out", () => {
    const graph = tripPageJsonLd(shop, { ...trip, booked: 12 }, ORIGIN);
    expect(at(graph, "offers.availability")).toBe("https://schema.org/SoldOut");
    expect(graph.remainingAttendeeCapacity).toBe(0);
  });

  it("reports a trip on a conditions hold as sold out — it cannot be booked right now", () => {
    const graph = tripPageJsonLd(shop, { ...trip, conditionsHold: true }, ORIGIN);
    expect(at(graph, "offers.availability")).toBe("https://schema.org/SoldOut");
  });

  it("never reports negative capacity if an overbooked roster ever slips through", () => {
    const graph = tripPageJsonLd(shop, { ...trip, booked: 20 }, ORIGIN);
    expect(graph.remainingAttendeeCapacity).toBe(0);
  });

  it("carries no personal data — only what the page already shows a stranger", () => {
    const serialized = JSON.stringify(tripPageJsonLd(shop, trip, ORIGIN, { count: 3, average: 5 }));
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
    expect(at(items[1], "item.url")).toBe(
      "https://diveday.example/shop/blue-mantis/schedule/trip-2",
    );
  });

  it("describes the shop alone when nothing is on the books, not a list of zero", () => {
    const graph = scheduleJsonLd(shop, [], ORIGIN);
    expect(graph["@type"]).toBe("SportsActivityLocation");
    expect(graph.itemListElement).toBeUndefined();
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
