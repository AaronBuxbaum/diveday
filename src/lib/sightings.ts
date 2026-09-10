import { DAY_MS } from "./clock";

/**
 * **What the crew saw, added up.**
 *
 * A sighting is a crew member tapping a species chip at the rail after a dive.
 * One row per species per site per departure, carrying a count
 * (`trip_sightings`); this file is the arithmetic that turns a month of those
 * rows into the one thing a diver reading a trip page wants to know — how often
 * that reef has actually shown a thing lately.
 *
 * Codes and numbers only, like the rest of `src/lib`: a species leaves here as
 * a catalog slug and becomes a word through `src/i18n/marine-life-labels.ts`,
 * and the sentence around it comes from the diver bundle.
 *
 * **It informs and gates nothing**, and it never promises. The read is over
 * what a crew wrote down, so the honest claim is a frequency with a date on it,
 * never an expectation about tomorrow.
 */

/**
 * How far back "this month" reaches, in days.
 *
 * A trailing thirty days rather than the calendar month, because the calendar
 * month makes the answer worst exactly when a diver is most likely to read it:
 * on the 2nd, a shop that dived every day for five weeks would show one dive
 * and one sighting. Thirty days is always thirty days.
 */
export const SIGHTING_WINDOW_DAYS = 30;

/**
 * How many species a site's summary shows.
 *
 * Three. The point of the beat is "the reef has been busy with X lately", and a
 * ranked list of eight is a spreadsheet — at which point a diver reads none of
 * it and the shop's own field guide above has already said what lives there.
 */
export const MAX_SIGHTING_SPECIES = 3;

/** The window's opening instant, for a read taken at `now`. */
export function sightingWindowStart(now: Date): Date {
  return new Date(now.getTime() - SIGHTING_WINDOW_DAYS * DAY_MS);
}

/** One species' tally at one site over the window. */
export type SiteSightingTally = {
  /** A `MARINE_LIFE_CATALOG` slug; the words are DiveDay's, resolved at render. */
  speciesSlug: string;
  /** How many separate departures logged it here. The numerator of the sentence. */
  dives: number;
  /** How many the crews tapped for in total. Kept for a shop's own reading; the page does not print it. */
  total: number;
  /** The most recent tap, which is what "last seen" renders in the shop's zone. */
  lastSeenAt: Date;
};

/** A site's whole answer for the window, or nothing worth saying. */
export type SiteSightings = {
  diveSiteId: string;
  /**
   * How many departures dived here in the window and left a record — the crew's
   * own dive log, or a sighting, whichever they wrote. The denominator.
   */
  dives: number;
  /** The top species, ranked, at most `MAX_SIGHTING_SPECIES`. */
  species: SiteSightingTally[];
};

/**
 * Rank a site's tallies and cut them to the lines a page will show.
 *
 * Ordered by how many departures saw the thing, then by how many were seen,
 * then by the slug so the order is stable across two identical months — a list
 * that reshuffles between two page loads reads as noise.
 *
 * **A tally is clamped to the denominator.** They come from two queries and
 * the denominator is the wider one by construction, but a numerator larger than
 * its denominator is the one output here that would read as a lie rather than
 * as an approximation, so it is made impossible rather than argued about.
 */
export function rankSiteSightings(input: {
  diveSiteId: string;
  dives: number;
  tallies: readonly SiteSightingTally[];
}): SiteSightings | null {
  if (input.tallies.length === 0) return null;
  const dives = Math.max(input.dives, ...input.tallies.map((tally) => tally.dives));
  const species = [...input.tallies]
    .map((tally) => ({ ...tally, dives: Math.min(tally.dives, dives) }))
    .sort(
      (a, b) =>
        b.dives - a.dives || b.total - a.total || a.speciesSlug.localeCompare(b.speciesSlug),
    )
    .slice(0, MAX_SIGHTING_SPECIES);
  return { diveSiteId: input.diveSiteId, dives, species };
}

/**
 * How many species the crew's chip row offers.
 *
 * Twelve, which is two or three rows of 44px targets on a phone at the rail and
 * still scannable in one look. It is deliberately **not** the whole 148-species
 * catalog: a boat is the worst place in the product to hunt through a wall of
 * names, and the long tail already has a door — the dive log's own species
 * select, one disclosure above, carries every species DiveDay knows.
 *
 * So the chips are the ordinary faces of this reef, and the memorable one goes
 * in the log beside the depth and the times, where a divemaster is already
 * writing the dive up.
 */
export const MAX_SEEN_CHIPS = 12;

/**
 * The species a crew is offered, for one site.
 *
 * **The shop's own list, narrowest first**: the site's field guide, then every
 * species the shop picked anywhere else, then DiveDay's catalog for a shop that
 * has never opened the site editor. That last fallback is what keeps the group
 * from being empty on the day a shop first takes a boat out, which is the day
 * it is most worth having.
 *
 * Already-logged species lead the row whatever their source, so a second turtle
 * is the same thumb movement as the first.
 */
export function seenChipSlugs(input: {
  /** This site's own field guide, in the shop's saved order. */
  siteGuide: readonly string[];
  /** Every species the shop picked on any of its sites, most-used first. */
  shopPicks: readonly string[];
  /** DiveDay's catalog, in catalog order — the fallback and nothing more. */
  catalog: readonly string[];
  /** What this departure has already logged here, so it stays in reach. */
  logged?: readonly string[];
}): string[] {
  const chips: string[] = [];
  for (const slug of [
    ...(input.logged ?? []),
    ...input.siteGuide,
    ...input.shopPicks,
    ...input.catalog,
  ]) {
    if (chips.length >= MAX_SEEN_CHIPS) break;
    if (!chips.includes(slug)) chips.push(slug);
  }
  return chips;
}
