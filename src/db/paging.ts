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
