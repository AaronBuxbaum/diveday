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

/** The rail is compact on narrow screens and a fixed-width sibling from `lg`. */
export const SETTINGS_RAIL_COLUMN_CLASS = "w-full lg:block lg:w-[264px] lg:shrink-0 print:hidden";

/**
 * The column's sticky box: pinned under the bar at the bar's own height
 * token, no taller than the viewport beside it. On phones it is a one-line
 * horizontal bar; at desktop width it scrolls vertically. The skeleton clips.
 */
export const SETTINGS_RAIL_FRAME_CLASS =
  "max-h-[60svh] overflow-x-auto overscroll-x-contain border-b border-border bg-background px-4 lg:sticky lg:top-(--chrome-h) lg:max-h-[calc(100svh-var(--chrome-h))] lg:overflow-x-hidden lg:rounded-none lg:border-b-0 lg:px-0 lg:pe-2";

/**
 * What the box holds: a one-line horizontal list on phones, and the groups
 * `space-y-5` apart inside `py-6` at desktop width. On the content, never on
 * the box: a sticky `top-0` label sticks at its scroller's padding edge, so
 * with `py-6` on the box a stuck label stood 24px under its top and the rows
 * scrolled past it showed through that strip (K-221).
 */
export const SETTINGS_RAIL_CONTENT_CLASS =
  "flex w-max items-center gap-1 py-2 lg:block lg:w-auto lg:space-y-5 lg:py-6 lg:pb-28";

/** A group label's gap to its first row. */
export const SETTINGS_RAIL_LABEL_CLASS = "mb-2";

/**
 * A group label's words: a 24px box, the text-xs line's 16px in `py-1`, inset
 * `px-3` onto the rows' text edge. A box of its own because it is what the
 * stuck label fills (`.settings-rail-label > span`, globals.css). Filled
 * always, not only when the scroll-state query says the label is stuck:
 * where that query is missing or late, a stuck label's words printed over
 * the row beneath them (visual review 2026-10-24, A45). On the rail's own
 * ground (`bg-background` on the frame) the fill shows only over a row.
 */
export const SETTINGS_RAIL_LABEL_WORDS_CLASS = "block bg-background! px-3 py-1";
