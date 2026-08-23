/**
 * The one offset-paging shape every staff list query returns.
 *
 * Four grammars used to coexist across the staff surfaces — numbered
 * prev/next on Orders and the by-departure view, forward-only cursors on
 * Divers/Reports/Reviews (a staffer on page 3 could not go back one page), a
 * cursor *stack* on the schedule board, and "go look at the board" on the
 * add-booking picker. Everything except the board (whose "Show earlier"
 * semantics are deliberate — see its own comment) now answers with
 * {@link OffsetPage}, so one pager component can render all of them and staff
 * learn one grammar.
 *
 * Keyset cursors are still the right tool where the list is a *stream* the
 * reader walks forward through; `./cursor.ts` stays for those. What they are
 * not is a way to say "page 4 of 7", which is exactly what a staffer working a
 * roster or a moderation queue needs.
 */

/**
 * **How much is on a page**, as a named set rather than a number per list.
 *
 * ADR 20260803-one-pagination-model unified the pager *control* and the query
 * shape, and it worked — every paged staff list wears the same component. What
 * it never said was how deep a page should be, so nineteen constants accreted
 * holding seven different values, and the two extremes sat one nav tab apart:
 * `/divers` served **10** of 139 divers under "Page 1 of 14" while `/orders`
 * served **50** of 155 under "Page 1 of 4". Same header, same pager, same table
 * shell, and a roster that took fourteen clicks to walk beside a ledger that
 * took four. No list looks wrong on its own; you only feel it moving between
 * them, which is why nothing caught it (issue 763).
 *
 * The tiers are named for **what the list is to its page**, not for how it is
 * drawn, because that is the thing that actually decides the number:
 *
 * - `list` — the list *is* the page. A roster, a ledger, a catalogue, a
 *   moderation queue. Already the modal value: eight of the nineteen picked 20
 *   independently, which is the closest thing to evidence available here.
 * - `section` — one paged section of a page that is about something else, where
 *   the surrounding content still has to be reachable by scrolling past it.
 * - `preview` — a strip whose full list lives elsewhere, sized to be seen
 *   rather than read.
 *
 * **There is deliberately no card-grid tier.** The obvious fourth — "24, so it
 * divides across two, three and four columns" — has no members: all three lists
 * that had picked 24 (the dive-site library, the published site catalogue, the
 * add-booking departure picker) render single-column tables or stacked rows.
 * The library was explicitly converted from a card grid to a table in issue
 * #608 and kept the grid's number. A tier with nothing in it is a guess about a
 * surface nobody has built; add it with its first real member.
 *
 * A list may still keep a local number, but only with the reason written at the
 * constant. Two do, and both are units other than "a record": the schedule
 * board pages a keyset *stream over days*, and the by-departure view's unit is a
 * departure with its whole roster underneath it.
 */
export const PAGE_SIZE = {
  list: 20,
  section: 10,
  preview: 4,
} as const;

export type OffsetPage<T> = {
  rows: T[];
  /** The page actually served — clamped into `[1, pageCount]`. */
  page: number;
  pageCount: number;
  pageSize: number;
  /** Every row matching the filter, not just this page's. */
  total: number;
};

/**
 * Runs one page of a filtered list plus its unfiltered-by-page count.
 *
 * The row query and the count run together, because that is the common case
 * and the count is what makes "page 4 of 7" sayable at all. A request past the
 * end costs one extra query and lands on the last real page: a bookmarked
 * `?page=9` on a list that shrank to four pages must show the last four rows
 * under an honest "Page 4 of 4", never an empty table under a heading that
 * cannot be true.
 *
 * `page` below 1, fractional, or `NaN` reads as page 1 rather than reaching a
 * driver as a negative or `NaN` offset. The routes guard their `?page=` too;
 * this is the layer that must not depend on their having done so.
 */
export async function offsetPage<T>(options: {
  page?: number;
  pageSize: number;
  countRows: () => Promise<number>;
  fetchRows: (offset: number, limit: number) => Promise<T[]>;
}): Promise<OffsetPage<T>> {
  const pageSize = Math.max(1, Math.floor(options.pageSize) || 1);
  const asked = Math.floor(options.page ?? 1);
  const requested = Number.isFinite(asked) ? Math.max(1, asked) : 1;

  const [rows, total] = await Promise.all([
    options.fetchRows((requested - 1) * pageSize, pageSize),
    options.countRows(),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (requested <= pageCount) return { rows, page: requested, pageCount, pageSize, total };

  return {
    rows: await options.fetchRows((pageCount - 1) * pageSize, pageSize),
    page: pageCount,
    pageCount,
    pageSize,
    total,
  };
}
