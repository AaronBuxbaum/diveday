/**
 * **The segmented grammar's parts: a sunken track, and segments laid on it.**
 *
 * `SegmentedControl` is the one segmented *navigation* — a `<nav>` of links.
 * A segmented *choice* inside a form (the booking's party size, the embed
 * page's look) cannot be that component, because a radio's value has to reach
 * `FormData` and a link's never does; it stays a radio group. But the two are
 * one grammar on screen, and the `rounded-inset` track had been spelled three
 * times, each copy carrying the same mis-nested corner. So that track is
 * spelled here once, and `SegmentedControl`, the booking's party size and the
 * embed page's look all take it. **A `rounded-inset` segmented track or its
 * segment is never spelled at a call site**; if one looks wrong, fix it here.
 *
 * **One segmented group is a capsule and does not take this recipe:** the
 * glare picker in `AmbientGlareDetector.tsx`, a `rounded-full` track holding
 * `rounded-full` segments. Its corners nest without a derivation, because a
 * capsule inside a capsule is concentric at any inset. It keeps its own
 * selected ink (`text-foreground`) and has no hover fill (#1975), and
 * `segmented.test.ts`'s scan cannot see it, by design: the scan looks for
 * the `rounded-inset` track.
 *
 * What stays with the caller is what differs between them: the target size
 * (`SegmentedControl`'s 44px and boat 56px, the party picker's square 44px
 * numerals), the width behaviour (`fill`, `w-fit`, wrapping), and what focus
 * draws on a label that wraps a visually hidden radio.
 */

/** The well every track is, whatever lays its segments out. */
const TRACK_WELL = "gap-1 rounded-inset border border-border bg-surface-sunken p-1";

/**
 * The track: a sunken well with one hairline and one step of padding, its
 * segments a step apart. Block-level `flex` — see `SegmentedControl` for why
 * never `inline-flex`.
 */
export const segmentedTrackClass = `flex ${TRACK_WELL}`;

/**
 * The same well laid out as a grid — `SegmentedControl`'s shape once its
 * options wrap, so every line shares its column edges. A class swapped for
 * the track's `flex`, never an inline `display`: an inline declaration beats a
 * stylesheet rule that is not `!important`, so a gridded track stopped obeying
 * `print:hidden` and printed on the counter's and the manifest's pages.
 */
export const segmentedGridTrackClass = `grid ${TRACK_WELL}`;

/**
 * **The corner of anything laid on the track: the track's corner less the
 * track's inset.** A segment sits one border and one padding step inside the
 * track, 1px + 4px, so a curve concentric with the track's 12px corner is
 * 12 − 5 = 7px — spelled from the same tokens the track is, so the two cannot
 * drift apart without `segmented.test.ts` saying so.
 *
 * It was `rounded-lg`, the 12px control rung, on every segment and on
 * `SegmentedControl`'s sliding pill. A 12px curve 5px inside a 12px curve does
 * not run parallel to it: the sunken band between them is 5px along each side
 * and fattens toward the corner, so the selected pill read as a separate
 * rounded tile dropped on the track. The pixel probe flagged it on the pill
 * (`nested-corners`, 73 flags) and on the options' hover fill (`fill-corners`,
 * 57) across 42 captures, and on both hand-rolled radio tracks.
 *
 * One value serves the pill and the options because they share one box: the
 * pill is measured off its option. (It sat 1px lower and further right than
 * its option until the same change, which is why the probe measured the pill
 * 6px inside the track and the options 5px; that was a placement bug in
 * `SegmentedControl`, not a second inset.)
 *
 * **It is also a menu row's corner.** `MENU_PANEL` in `ui/menu.ts` takes the
 * track's inset on purpose, one hairline and one `p-1` step, so the rows of
 * the three header menus nest at this same 7px rather than at a second
 * derived value. `menu.test.ts` fails if the two insets part.
 */
export const SEGMENT_CORNER = "rounded-[calc(var(--radius-inset)-var(--spacing)-1px)]";

/** The raised pill's own look — the one place the selected fill is spelled. */
export const SEGMENT_RAISED = "bg-surface shadow-sm";

/**
 * One segment's corner and ink. Both states share one weight, so choosing a
 * segment never reflows the row; selection is the pill — fill, shadow and
 * the primary ink — never weight and never colour alone.
 *
 * A selected segment draws the pill on itself unless `raised: false` —
 * which `SegmentedControl` passes once its sliding pill has measured, so the
 * pill carries the fill from there. An unselected segment is never raised.
 */
export function segmentClass({
  selected,
  raised = true,
}: {
  selected: boolean;
  raised?: boolean;
}): string {
  if (!selected)
    return `${SEGMENT_CORNER} font-semibold text-muted hover:bg-surface hover:text-foreground`;
  return `${SEGMENT_CORNER} font-semibold text-primary${raised ? ` ${SEGMENT_RAISED}` : ""}`;
}
