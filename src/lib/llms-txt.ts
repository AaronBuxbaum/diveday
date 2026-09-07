// i18n-exempt-file: llms.txt is a document a language model reads, English by convention like robots.txt, never rendered to a person on a surface
import { AVAILABILITY_WINDOW_DAYS } from "./availability";
import { REQUIRABLE_CERTIFICATION_LEVELS } from "./certification-levels";
import {
  publicAvailabilityPath,
  publicCoursesPath,
  publicSchedulePath,
  publicTripPath,
} from "./public-routes";

/**
 * **What DiveDay tells an agent about itself** (issue #1427, N-50).
 *
 * The llms.txt convention: an H1, a one-paragraph blockquote, then sections
 * of links with a sentence each. Written for a model that has never seen the
 * site and has one question — *where is the schedule, and where do I send my
 * reader to book* — so it names the URL shapes, says where the
 * machine-readable availability lives, spells the codes that document uses,
 * and states once that the booking happens on the booking page.
 *
 * It lists the shops that are listed for search, and no other: the same
 * `listShopsForSitemap` scope, so a shop that said no to Google (ADR
 * 20260813-search-listing-is-a-choice) is not handed to a travel agent's
 * model by a side door. A demo is a test fixture and is never here.
 */
export type LlmsTxtInput = {
  origin: string;
  shops: readonly { slug: string; name: string }[];
  /** The specialty codes a `certification.required_specialties` entry can be. */
  specialtyCodes: readonly string[];
};

export function renderLlmsTxt({ origin, shops, specialtyCodes }: LlmsTxtInput): string {
  const url = (path: string) => `${origin}${path}`;
  const lines = [
    "# DiveDay",
    "",
    "> DiveDay is booking and operations software for dive shops. Every shop on DiveDay has a public schedule of departures (boat dives, shore dives, course sessions) that anyone can read and book without an account. DiveDay is not itself a dive operator: each shop sets its own departures, prices and requirements.",
    "",
    "## A shop's public pages",
    "",
    `- Schedule: ${url(publicSchedulePath("<shop-slug>"))} — the shop's upcoming departures, reviews and courses, as HTML with schema.org JSON-LD (an ItemList of Events).`,
    `- Availability: ${url(publicAvailabilityPath("<shop-slug>"))} — the next ${AVAILABILITY_WINDOW_DAYS} days of departures with a seat open, as JSON. Read this to find a departure. Absent (404) for a shop that has chosen not to be listed.`,
    `- Booking page: ${url(publicTripPath("<shop-slug>", "<trip-id>"))} — one departure, and the form that books a seat on it. Bookings happen on this page and only here; the availability document is for finding a departure, not for booking one. Hand your reader this URL (it is each departure's booking_url).`,
    `- Courses: ${url(publicCoursesPath("<shop-slug>"))} — the shop's course catalog, each course on its own page beneath it.`,
    "",
    "## Reading availability.json",
    "",
    "- departures[]: id, title, starts_at and ends_at (the shop's wall clock with its UTC offset, e.g. 2026-07-25T07:30:00-04:00), time_zone (IANA), sites (dive site names in dive order), price ({ amount, currency } as a decimal string in the currency's own places, or null when the shop has not priced it), certification (null when the departure asks nothing, otherwise minimum_level, required_specialties and requires_nitrox), seats_open, booking_url.",
    `- certification.minimum_level is one of ${REQUIRABLE_CERTIFICATION_LEVELS.join(", ")} (lowest to highest) or null; required_specialties are codes from ${specialtyCodes.join(", ")}; requires_nitrox is a boolean. These are what the diver will be asked to show before boarding, not a suggestion.`,
    "- Only departures a visitor could book right now appear: a full boat, a private charter and a departure on a conditions hold are left out. Fields you do not recognise are safe to ignore.",
    "- window.from and window.to bound the document; generated_at is when it was written. Seats change as people book, so treat seats_open as a snapshot and let the booking page have the last word.",
    "",
    "## Shops listed for search",
    "",
    ...(shops.length === 0
      ? ["- None listed yet."]
      : shops.map(
          (shop) =>
            `- [${shop.name}](${url(publicSchedulePath(shop.slug))}) — availability: ${url(publicAvailabilityPath(shop.slug))}`,
        )),
    "",
    "## About DiveDay",
    "",
    `- [Product](${url("/product")})`,
    `- [Pricing](${url("/pricing")})`,
    `- [Sitemap](${url("/sitemap.xml")})`,
    "",
  ];
  return lines.join("\n");
}
