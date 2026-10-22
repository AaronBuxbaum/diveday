/**
 * **A thin 2025** (market sheet 2026-10-22, item 4): six sailings a year and
 * more back, so Reports has a last year to compare with and says "by this
 * date in 2025" on the month and the year. A shop's first season on DiveDay's
 * books, so thin on purpose. Sailed by `seedHistory`, which writes them like
 * every other past boat: seats, payments, releases, roll call, hull and kind.
 */
export const LAST_YEAR_SAILINGS: readonly {
  daysAgo: number;
  hour: number;
  title: string;
  capacity: number;
  priceCents: number;
  booked: number;
}[] = [
  // A day past a year ago, then one a week or two apart before it: enough
  // for "by this date" a year back on the month and on the year.
  {
    daysAgo: 366,
    hour: 8,
    title: "Two-Tank Reef — Molasses & French",
    capacity: 12,
    priceCents: 12000,
    booked: 6,
  },
  {
    daysAgo: 373,
    hour: 8,
    title: "Wreck Trip — Benwood & City of Washington",
    capacity: 10,
    priceCents: 17000,
    booked: 5,
  },
  {
    daysAgo: 387,
    hour: 8,
    title: "Two-Tank Reef — Benwood",
    capacity: 12,
    priceCents: 12000,
    booked: 4,
  },
  {
    daysAgo: 401,
    hour: 19,
    title: "Night Dive — Molasses",
    capacity: 8,
    priceCents: 13000,
    booked: 4,
  },
  {
    daysAgo: 415,
    hour: 8,
    title: "Reef Day — Christ of the Abyss",
    capacity: 12,
    priceCents: 11500,
    booked: 5,
  },
  {
    daysAgo: 436,
    hour: 8,
    title: "Two-Tank Reef — Pickles",
    capacity: 10,
    priceCents: 12000,
    booked: 3,
  },
];
