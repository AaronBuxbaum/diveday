/**
 * **"What you might see in March"**: the species this shop's crews have logged
 * most often in one calendar month, across every season they have recorded
 * (batch 4, K4).
 *
 * The arithmetic only. A species leaves here as a catalog slug and becomes a
 * word through `src/i18n/marine-life-labels.ts`; the sentence around it comes
 * from the diver bundle. It informs and gates nothing.
 *
 * **It is a frequency, never a forecast.** The numerator is how many of the
 * shop's departures in that month logged the species; the denominator is how
 * many departures in that month left any record at all (a dive log or a
 * sighting), the same honest denominator the trip page's "Seen here this
 * month" uses (`src/lib/sightings.ts`). The words say "seen on 9 of our 14
 * March trips" and never "you will see".
 *
 * **It stays silent without enough evidence.** See {@link MIN_MONTH_TRIPS}.
 */

/**
 * How many recorded departures a calendar month needs before the shop's page
 * says anything about it: **eight**.
 *
 * Eight is one month of an ordinary twice-a-week boat, the smallest schedule a
 * shop with a storefront runs. Below it, one departure moves every fraction by
 * more than twelve points, so "seen on 2 of our 3 March trips" is an anecdote
 * printed as a rate, and a diver reads a rate as a promise. At eight, a species
 * needs to turn up on at least two of them (see {@link MIN_SPECIES_TRIPS}) to
 * be named, which is a pattern rather than one lucky dive. The threshold is
 * counted across every past season of that month together, so a shop that
 * logged five Marches last year and four this year has said enough.
 */
export const MIN_MONTH_TRIPS = 8;

/**
 * A species is named only when it was logged on at least two of the month's
 * departures. One sighting is a story the crew tells, not something a diver
 * reading the shop's page should plan around.
 */
export const MIN_SPECIES_TRIPS = 2;

/** How many species the section names: enough to be a list, few enough to read. */
export const MAX_MONTH_SPECIES = 4;

/** One species' tally for the month. */
export type MonthSpeciesTally = {
  speciesSlug: string;
  /** How many of the month's departures logged it. */
  trips: number;
};

/** The section's whole answer, or nothing worth saying. */
export type MonthSightings = {
  /** 1–12, the calendar month in the shop's own timezone. */
  month: number;
  /** Departures in that month that left a record: the denominator. */
  trips: number;
  species: MonthSpeciesTally[];
};

/**
 * Rank a month's tallies and decide whether they are worth saying.
 *
 * Null below {@link MIN_MONTH_TRIPS} recorded departures, or when no species
 * reaches {@link MIN_SPECIES_TRIPS}. Ordered by how many departures saw it,
 * then by slug so two identical months read the same. A tally is clamped to
 * the denominator: a numerator above it is the one output here that would be a
 * lie rather than an approximation, so it is made impossible.
 */
export function rankMonthSightings(input: {
  month: number;
  trips: number;
  tallies: readonly MonthSpeciesTally[];
}): MonthSightings | null {
  if (input.trips < MIN_MONTH_TRIPS) return null;
  const species = input.tallies
    .map((tally) => ({ ...tally, trips: Math.min(tally.trips, input.trips) }))
    .filter((tally) => tally.trips >= MIN_SPECIES_TRIPS)
    .sort((a, b) => b.trips - a.trips || a.speciesSlug.localeCompare(b.speciesSlug))
    .slice(0, MAX_MONTH_SPECIES);
  if (species.length === 0) return null;
  return { month: input.month, trips: input.trips, species };
}
