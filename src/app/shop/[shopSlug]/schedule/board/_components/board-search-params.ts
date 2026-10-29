/**
 * What the schedule board reads off its URL. Kept beside the page rather than
 * inline in its signature, so the route file stays a page.
 */
export type BoardSearchParams = {
  /** Internal marker for the dedicated creation route. */
  _createPage?: string;
  after?: string;
  /** Every earlier page's cursor, oldest first (src/lib/schedule-pagination.ts). */
  back?: string;
  builder?: string;
  count?: string; // the number a builder notice names (`builderNoticeMessage`)
  /** The departure just created, named so the notice can say which. */
  created?: string;
  /** Gear assignments a move had to release — see `moveTrip`. */
  gear?: string;
  /** Unique marker for one real move result, removed after the notice is read. */
  result?: string;
  /** The reschedule notice a move held, and how many seats it tells. */
  held?: string;
  tell?: string;
  /** How many dates a repeating submission put up. */
  series?: string;
  /** Arrive with the add panel open: `1` quick, `full` already expanded. */
  add?: string;
  /** Pre-dates the add panel — the day a link meant, e.g. "another Saturday". */
  date?: string;
  /** Opens the add panel pointed at a course (the catalogue's own control). */
  course?: string;
  /** Comma-separated request ids carried from the Requests planning link. */
  requests?: string;
  /** Opens the add panel pointed at a dive site (the library's own control). */
  site?: string;
  /**
   * Which week the desktop grid draws, as any date inside it — normalised
   * to that week's Monday (`src/lib/week-board.ts`). Deliberately separate
   * from the stream's `after`/`back` cursor: the grid is a second *reading*
   * of the same departures, not a second stream, and the two never mix.
   * Slice 9e's staffing week reads the same parameter.
   */
  week?: string;
};

/** Result-only parameters are consumed by the board notice and scrubbed afterward. */
export const BOARD_RESULT_PARAMS = [
  "builder",
  "count",
  "created",
  "gear",
  "result",
  "series",
] as const;

export function clearBoardResultParams(url: URL): URL {
  for (const key of BOARD_RESULT_PARAMS) url.searchParams.delete(key);
  return url;
}

/** Preserve old add links and their context when moving to the creation page. */
export function legacyAddHref(shopSlug: string, params: BoardSearchParams): string | null {
  const { _createPage, add, date, course, requests, site, week } = params;
  if (_createPage === "1" || !(add || course || requests || site)) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({
    add: add === "full" ? add : undefined,
    date,
    course,
    requests,
    site,
    week,
  })) {
    if (value) query.set(key, value);
  }
  return `/shop/${shopSlug}/schedule/board/new${query.size ? `?${query}` : ""}`;
}
