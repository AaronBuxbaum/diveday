/**
 * **The settings rail's geometry, owned once** — for the rail
 * (`SettingsRail`) and the skeleton that stands in for it while its reads
 * stream in (`SettingsRailSkeleton`).
 *
 * The skeleton used to hand-draw its own numbers, and every one was off:
 * `py-10` against the rail's `py-6`, `space-y-6` against `space-y-5`, 12px
 * label bars against a 24px label box, 16px rows on a 24px pitch against 44px
 * rows. The rail's first label landed 16px above the bar it replaced, and
 * each row further off (K-345; pixel-craft class 11, 0px of shift on load).
 * The row's own box is the page rail's one row, `RAIL_ROW_BOX` in
 * `src/components/ui/rail.ts`.
 *
 * Not in `SettingsRail.tsx`: that module is a client one, and a string
 * exported from it reaches the server layout as a client reference, not a
 * string.
 */

/** The rail's column: a fixed-width sibling of the pane, from `lg` only. */
export const SETTINGS_RAIL_COLUMN_CLASS = "hidden lg:block lg:w-[264px] lg:shrink-0";

/**
 * The column's sticky box: pinned under the bar at the bar's own height
 * token, no taller than the viewport beside it. The rail scrolls in it
 * (`overflow-y-auto`); the skeleton clips.
 */
export const SETTINGS_RAIL_FRAME_CLASS =
  "sticky top-(--chrome-h) max-h-[calc(100svh-var(--chrome-h))] pe-2";

/**
 * What the box holds: the groups `space-y-5` apart inside `py-6`. On the
 * content, never on the box: a sticky `top-0` label sticks at its scroller's
 * padding edge, so with `py-6` on the box a stuck label stood 24px under its
 * top and the rows scrolled past it showed through that strip (K-221).
 */
export const SETTINGS_RAIL_CONTENT_CLASS = "space-y-5 py-6";

/** A group label's gap to its first row. */
export const SETTINGS_RAIL_LABEL_CLASS = "mb-2";

/**
 * A group label's words: a 24px box, the text-xs line's 16px in `py-1`, inset
 * `px-3` onto the rows' text edge. A box of its own because it is what the
 * stuck label fills (`.settings-rail-label > span`, globals.css).
 */
export const SETTINGS_RAIL_LABEL_WORDS_CLASS = "block px-3 py-1";
