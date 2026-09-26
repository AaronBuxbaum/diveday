/**
 * **The week board's geometry, for the board and its loading skeleton alike**
 * (docs/design/pixel-craft.md, class 11: a skeleton has the loaded page's
 * geometry, so nothing shifts when content arrives). The skeleton drew the
 * seven-column grid for weeks after the board became one list of days
 * (#1923); spelled once here, a change to the rail or the row moves both.
 *
 * A plain module rather than exports of `WeekBoard.tsx`: that file is a
 * Client Component, and a Server Component importing a string from one gets a
 * client reference, not the string.
 */

/**
 * A day: the rail its label stands in, and the column its departures fill.
 * **One rail, 72px, at every width** (class 3). The phone's was 3rem, narrower
 * than the label it holds: "WED 22" ran 12–14px past it and today's disc was
 * squeezed to an oval. The widest label below `sm` is a weekday's fixed 32px,
 * its 6px gap and today's 32px disc — 70px — and from `sm` up the stacked
 * label was already 4.5rem wide.
 */
export const WEEK_DAY_GRID_CLASS =
  "grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 py-2 sm:gap-x-5";

/**
 * A departure's box on a day: the site mark, then its lines, 8px in from the
 * row's fill on every side.
 */
export const WEEK_ROW_BOX_CLASS = "flex items-start gap-2.5 rounded-lg px-2 py-2 sm:gap-3";
