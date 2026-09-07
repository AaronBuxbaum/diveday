import { nowDate } from "./clock";
import { currencyFractionDigits, minorToMajor } from "./money";
import { publicSchedulePath, publicTripPath } from "./public-routes";
import type { CertificationLevel, CertRequirementSource } from "./readiness";
import { absoluteUrl } from "./structured-data";
import { shiftInstantByCalendarDays, zonedIsoString } from "./zoned";

/**
 * **The shop's open seats, written for a reader that is not a person**
 * (issue #1427, improvement-ideas N-50).
 *
 * An AI travel agent asked "find me a wreck dive out of Key Largo on Saturday"
 * can read a schedule page the way a diver does, but a page is prose, a
 * calendar rail and a booking form, and the one fact it wants — which
 * departures still have a seat, and where to send its reader — is scattered
 * across all three. This is that fact alone: the next two weeks of public
 * departures with a seat open, each carrying the handful of things an agent
 * needs to describe it and one URL to hand over. **The booking still happens
 * on the booking page.** The document offers nothing to POST to; it exists so
 * the agent finds the right page, not so it can skip it.
 *
 * **Three boundaries, and they are the shape of the type.** Nothing about a
 * person: no diver, no crew, no count of who is aboard beyond the seats that
 * are not — the same line `src/lib/structured-data.ts` holds for JSON-LD.
 * Codes, never sentences: the certification gate is the enum value the
 * readiness engine reasons in, so an agent in any language reads the same
 * fact and a message bundle is never consulted. And only what the public
 * schedule page already shows an anonymous visitor: a private charter, a
 * held departure and a full boat are absent here for exactly the reason they
 * cannot be booked there.
 *
 * Framework-free. `src/db/availability.ts` reads the rows; the route under
 * `src/app/s/[shopSlug]/availability.json` decides who may read the result.
 */

/** How far ahead the document looks. Two weeks: the horizon an agent plans a trip on. */
export const AVAILABILITY_WINDOW_DAYS = 14;

/**
 * The document's own version marker. Bump it when a field changes meaning;
 * adding a field is not a new version, and a reader is told to ignore what
 * it does not know.
 */
export const AVAILABILITY_SCHEMA = "diveday/availability/v1";

export type AvailabilityShop = {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
};

export type AvailabilityTripInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  /** Non-cancelled bookings — the same count the schedule page shows seats against. */
  booked: number;
  priceCents: number | null;
  /** A held departure pauses bookings, so it is not available whatever its seats say. */
  conditionsHold: boolean;
  /** The sites the boat visits, in dive order — names only. */
  sites: readonly string[];
  /** What the departure asks of anybody, or null when it asks nothing. */
  requirement: CertRequirementSource | null;
};

export type AvailabilityDeparture = {
  id: string;
  title: string;
  /** Shop wall clock with its offset, e.g. `2026-07-25T07:30:00-04:00`. */
  starts_at: string;
  ends_at: string;
  time_zone: string;
  sites: string[];
  /** Decimal string in the currency's own places ("130.00", "5000"), or null for an unpriced charter. */
  price: { amount: string; currency: string } | null;
  certification: {
    minimum_level: CertificationLevel | null;
    required_specialties: string[];
    requires_nitrox: boolean;
  } | null;
  seats_open: number;
  booking_url: string;
};

export type AvailabilityDocument = {
  schema: typeof AVAILABILITY_SCHEMA;
  generated_at: string;
  shop: {
    name: string;
    slug: string;
    time_zone: string;
    currency: string;
    schedule_url: string;
  };
  window: { from: string; to: string };
  departures: AvailabilityDeparture[];
};

/** The document's window: `now` to the same wall-clock instant two weeks on, in the shop's zone. */
export function availabilityWindow(now: Date, timeZone: string): { from: Date; to: Date } {
  return { from: now, to: shiftInstantByCalendarDays(now, AVAILABILITY_WINDOW_DAYS, timeZone) };
}

/** Seats a diver could still buy — never negative, and zero on a held boat. */
export function seatsOpen(
  trip: Pick<AvailabilityTripInput, "capacity" | "booked" | "conditionsHold">,
) {
  if (trip.conditionsHold) return 0;
  return Math.max(0, trip.capacity - trip.booked);
}

/**
 * The document, from rows the reader already scoped to public, scheduled
 * departures. The window and the seat test are applied again here rather
 * than trusted from the query, so a caller that hands in a wider list still
 * publishes only what an agent can act on.
 */
export function availabilityDocument(
  shop: AvailabilityShop,
  trips: readonly AvailabilityTripInput[],
  origin: string,
  now: Date = nowDate(),
): AvailabilityDocument {
  const tz = shop.timezone;
  const currency = shop.currency.toUpperCase();
  const window = availabilityWindow(now, tz);
  const departures = trips
    .filter(
      (trip) =>
        seatsOpen(trip) > 0 &&
        trip.startsAt.getTime() >= window.from.getTime() &&
        trip.startsAt.getTime() < window.to.getTime(),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
    .map((trip) => ({
      id: trip.id,
      title: trip.title,
      starts_at: zonedIsoString(trip.startsAt, tz),
      ends_at: zonedIsoString(trip.endsAt, tz),
      time_zone: tz,
      sites: [...trip.sites],
      price:
        trip.priceCents === null
          ? null
          : {
              amount: minorToMajor(trip.priceCents, currency).toFixed(
                currencyFractionDigits(currency),
              ),
              currency,
            },
      certification: trip.requirement
        ? {
            minimum_level: trip.requirement.minimumCertificationLevel,
            required_specialties: [...trip.requirement.requiredSpecialties],
            requires_nitrox: trip.requirement.requiresNitrox,
          }
        : null,
      seats_open: seatsOpen(trip),
      booking_url: mustAbsolute(origin, publicTripPath(shop.slug, trip.id)),
    }));

  return {
    schema: AVAILABILITY_SCHEMA,
    generated_at: now.toISOString(),
    shop: {
      name: shop.name,
      slug: shop.slug,
      time_zone: tz,
      currency,
      schedule_url: mustAbsolute(origin, publicSchedulePath(shop.slug)),
    },
    window: { from: zonedIsoString(window.from, tz), to: zonedIsoString(window.to, tz) },
    departures,
  };
}

/**
 * An absolute URL, or the bare path when the origin cannot form one. The
 * route always hands in a real origin (the configured public one, or the
 * request's own), so the fallback is defensive rather than a state anyone
 * sees — but a document with a relative `booking_url` still beats no
 * document, since the reader knows where it fetched this from.
 */
function mustAbsolute(origin: string, path: string): string {
  return absoluteUrl(origin, path) ?? path;
}
