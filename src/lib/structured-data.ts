import { currencyFractionDigits, minorToMajor } from "./money";
import { publicCoursePath, publicSchedulePath, publicTripPath } from "./public-routes";
import type { ReviewAggregate } from "./reviews";
import { MAX_REVIEW_RATING, MIN_REVIEW_RATING } from "./reviews";

/**
 * schema.org JSON-LD for the public booking surface — the schedule, one trip,
 * and a course page (docs ADR 20260729-booking-page-structured-data).
 *
 * Framework-free and built only from data those pages already render to an
 * anonymous visitor. Nothing personal ever enters a graph: no diver names, no
 * emails, no roster counts beyond the open-seat figure the page itself shows.
 * The embed surface (`?embed=1`) deliberately emits none of this — the
 * standalone page is the canonical URL, and two URLs describing the same Event
 * is exactly the duplication structured data is supposed to prevent.
 */

export type JsonLdValue = string | number | boolean | null | JsonLdObject | JsonLdValue[];
export type JsonLdObject = { [key: string]: JsonLdValue | undefined };

const SCHEMA_CONTEXT = "https://schema.org";

/** Absolute URL for a path, or null when no canonical origin is configured. */
export function absoluteUrl(origin: string | null, path: string): string | null {
  if (!origin) return null;
  try {
    return new URL(path, `${origin}/`).toString();
  } catch {
    return null;
  }
}

/**
 * Drop every key whose value is null/undefined, recursively. A schema.org graph
 * with `"location": null` in it is worse than one without the key: consumers
 * read the null as a claim about the thing, and Google's validator flags it.
 */
export function pruneJsonLd(value: JsonLdValue | undefined): JsonLdValue | undefined {
  if (Array.isArray(value)) {
    const items = value.map(pruneJsonLd).filter((item): item is JsonLdValue => item != null);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, pruneJsonLd(item)] as const)
      .filter((entry): entry is readonly [string, JsonLdValue] => entry[1] != null);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value ?? undefined;
}

export type ShopForStructuredData = {
  name: string;
  slug: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /**
   * The shop's own currency, for every `Offer` in the graph. Search engines
   * take `priceCurrency` at face value, so a hardcoded "USD" doesn't just look
   * wrong on a Cozumel shop's listing — it publishes a price in the wrong
   * currency to the one audience that can't ask a follow-up question.
   */
  currency: string;
  /** Physical business address fields — see `shopAddressOf` for how they combine. */
  addressStreet: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
};

/**
 * A stored minor-unit amount as schema.org's decimal price string, with the
 * currency's own number of decimal places — "130.00" for USD, "5000" for JPY.
 * A fixed `.toFixed(2)` would publish a ¥5,000 course as "50.00".
 */
function offerPrice(cents: number, currency: string): string {
  return minorToMajor(cents, currency).toFixed(currencyFractionDigits(currency));
}

/**
 * The shop's own `aggregateRating`, or nothing at all when it has no published
 * reviews. Never emitted with a count of zero: schema.org treats an
 * aggregateRating as a claim, and "rated, by nobody" is not one DiveDay will
 * make on a shop's behalf.
 */
function aggregateRatingOf(aggregate: ReviewAggregate | null): JsonLdObject | undefined {
  if (!aggregate || aggregate.average === null || aggregate.count < 1) return undefined;
  return {
    "@type": "AggregateRating",
    ratingValue: aggregate.average,
    reviewCount: aggregate.count,
    bestRating: MAX_REVIEW_RATING,
    worstRating: MIN_REVIEW_RATING,
  };
}

export type ReviewForStructuredData = {
  /**
   * First name and last initial — the same already-public byline `ShopReviews`
   * renders. `""` means the diver has no display name; the `author` node is
   * omitted rather than invented, since this layer holds no prose.
   */
  reviewer: string;
  rating: number;
  comment: string;
  /** The dive itself, not when the review was published — what a reader actually wants dated. */
  divedAt: Date;
};

/**
 * Published reviews as schema.org `Review` objects, or nothing at all for an
 * empty list — the same "omit rather than emit noise" rule `aggregateRatingOf`
 * already follows. Carries only what `ShopReviews` already renders to an
 * anonymous visitor: the reviewer's public display name, their own words, the
 * star rating, and the dive date — no email, no person id, no booking id.
 */
export function reviewsJsonLd(
  reviews: readonly ReviewForStructuredData[],
): JsonLdObject[] | undefined {
  if (reviews.length === 0) return undefined;
  return reviews.map((review) => ({
    "@type": "Review",
    author: review.reviewer ? { "@type": "Person", name: review.reviewer } : undefined,
    reviewRating: {
      "@type": "Rating",
      ratingValue: review.rating,
      bestRating: MAX_REVIEW_RATING,
      worstRating: MIN_REVIEW_RATING,
    },
    reviewBody: review.comment,
    datePublished: review.divedAt.toISOString(),
  }));
}

/**
 * The shop's `PostalAddress`, or nothing when no field is set. A shop that has
 * filled in even one field (say, just a country) has told us something real
 * about where it operates, and a partial address is still worth publishing —
 * schema.org has no concept of "half an address" to reject, and Google's
 * validator only asks for the sub-fields that are present. The only claim
 * DiveDay refuses to make is an address out of nothing at all: an unfilled
 * shop gets no `address` key rather than one made of five nulls.
 * `pruneJsonLd` (already run over the final graph) strips whichever
 * sub-fields stayed null, so this only needs to decide whether to emit the
 * object at all.
 */
export function shopAddressOf(shop: ShopForStructuredData): JsonLdObject | undefined {
  const { addressStreet, addressLocality, addressRegion, addressPostalCode, addressCountry } = shop;
  if (!addressStreet && !addressLocality && !addressRegion && !addressPostalCode && !addressCountry)
    return undefined;
  return {
    "@type": "PostalAddress",
    streetAddress: addressStreet,
    addressLocality,
    addressRegion,
    postalCode: addressPostalCode,
    addressCountry,
  };
}

/**
 * The shop as a dive operator. `SportsActivityLocation` rather than a bare
 * `Organization` because that is what a dive shop is to a search engine, and it
 * is the type that carries an address and opening hours — the address is
 * modeled (`shopAddressOf`); opening hours are not yet.
 */
export function shopJsonLd(
  shop: ShopForStructuredData,
  origin: string | null,
  aggregate: ReviewAggregate | null = null,
  reviews: readonly ReviewForStructuredData[] = [],
): JsonLdObject {
  return {
    "@type": "SportsActivityLocation",
    name: shop.name,
    url: absoluteUrl(origin, publicSchedulePath(shop.slug)),
    email: shop.contactEmail,
    telephone: shop.contactPhone,
    address: shopAddressOf(shop),
    aggregateRating: aggregateRatingOf(aggregate),
    review: reviewsJsonLd(reviews),
  };
}

export type TripForStructuredData = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
  priceCents: number | null;
  /** Named dive site, when the trip has one — the closest thing to a venue a boat day has. */
  diveSiteName: string | null;
  /** A trip on a conditions hold is still scheduled; bookings are what pause. */
  conditionsHold: boolean;
};

/**
 * One departure as an `Event`. `offers` is present only for a priced trip —
 * an unpriced charter genuinely has no offer to make, and inventing `0` would
 * publish "free" to every consumer that reads it.
 */
export function tripJsonLd(
  shop: ShopForStructuredData,
  trip: TripForStructuredData,
  origin: string | null,
  aggregate: ReviewAggregate | null = null,
): JsonLdObject {
  const url = absoluteUrl(origin, publicTripPath(shop.slug, trip.id));
  const openSeats = Math.max(0, trip.capacity - trip.booked);
  // A held or full trip is honestly SoldOut to a consumer: neither can be
  // booked right now, and InStock on either would send a diver to a page that
  // refuses them.
  const available =
    openSeats > 0 && !trip.conditionsHold
      ? "https://schema.org/InStock"
      : "https://schema.org/SoldOut";

  return {
    "@type": "Event",
    name: trip.title,
    description: trip.description,
    startDate: trip.startsAt.toISOString(),
    endDate: trip.endsAt.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url,
    maximumAttendeeCapacity: trip.capacity,
    remainingAttendeeCapacity: openSeats,
    location: trip.diveSiteName
      ? { "@type": "Place", name: trip.diveSiteName }
      : { "@type": "Place", name: shop.name },
    organizer: shopJsonLd(shop, origin, aggregate),
    offers:
      trip.priceCents === null
        ? undefined
        : {
            "@type": "Offer",
            price: offerPrice(trip.priceCents, shop.currency),
            priceCurrency: shop.currency.toUpperCase(),
            availability: available,
            url,
          },
  };
}

/** A single trip page's graph — one `Event`, context attached. */
export function tripPageJsonLd(
  shop: ShopForStructuredData,
  trip: TripForStructuredData,
  origin: string | null,
  aggregate: ReviewAggregate | null = null,
): JsonLdObject {
  return { "@context": SCHEMA_CONTEXT, ...tripJsonLd(shop, trip, origin, aggregate) };
}

/**
 * The schedule page's graph: the shop's upcoming departures as an ordered
 * `ItemList` of `Event`s. An empty schedule emits the shop alone rather than an
 * empty list — "this operator exists, with nothing on the books" is true; "here
 * is a list of zero trips" is noise.
 *
 * `reviews` is the schedule page's own top-level review list — the same rows
 * `<ShopReviews>` renders directly beneath it — and rides at the top of
 * whichever shape this returns (the bare shop node when there are no trips, the
 * `ItemList` itself when there are). It never flows into a per-trip `Event`'s
 * `organizer`: that graph describes one departure, not the shop's full review
 * list, so `tripJsonLd` below is called without it, same as every other
 * `shopJsonLd` call site outside this page's own top-level call.
 */
export function scheduleJsonLd(
  shop: ShopForStructuredData,
  trips: readonly TripForStructuredData[],
  origin: string | null,
  aggregate: ReviewAggregate | null = null,
  reviews: readonly ReviewForStructuredData[] = [],
): JsonLdObject {
  if (trips.length === 0) {
    return { "@context": SCHEMA_CONTEXT, ...shopJsonLd(shop, origin, aggregate, reviews) };
  }
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    name: `Upcoming dives with ${shop.name}`,
    numberOfItems: trips.length,
    itemListElement: trips.map((trip, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: tripJsonLd(shop, trip, origin, aggregate),
    })),
    review: reviewsJsonLd(reviews),
  };
}

export type CourseForStructuredData = {
  slug: string;
  title: string;
  agency: string | null;
  summary: string | null;
  description: string | null;
  priceCents: number | null;
  durationText: string | null;
};

/**
 * A course page as a `Course`. `provider` is the shop that teaches it; the
 * agency (PADI, SSI, …) rides in `educationalCredentialAwarded`, which is what
 * a certification actually is — not a second provider.
 */
export function coursePageJsonLd(
  shop: ShopForStructuredData,
  course: CourseForStructuredData,
  origin: string | null,
  aggregate: ReviewAggregate | null = null,
): JsonLdObject {
  const url = absoluteUrl(origin, publicCoursePath(shop.slug, course.slug));
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Course",
    name: course.title,
    description: course.summary ?? course.description,
    url,
    provider: shopJsonLd(shop, origin, aggregate),
    educationalCredentialAwarded: course.agency ? `${course.agency} ${course.title}` : course.title,
    offers:
      course.priceCents === null
        ? undefined
        : {
            "@type": "Offer",
            price: offerPrice(course.priceCents, shop.currency),
            priceCurrency: shop.currency.toUpperCase(),
            availability: "https://schema.org/InStock",
            url,
          },
    timeRequired: course.durationText,
  };
}
