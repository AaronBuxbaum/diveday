import { SEGMENT_CORNER, segmentedGridTrackClass } from "@/components/ui/segmented";

/**
 * **The boat's one segmented control** (visual review 2026-10-24, B06): the
 * manifest's "Where the boat is" strip, its Dock / Dive 1 / Dive 2 switch,
 * and the saved copy's checkpoint switch wear one track, one segment and one
 * selected state, so two selectors stacked at the rail read as one idiom.
 *
 * - **One row, always.** Equal columns that never wrap 3 + 2 or 2 + 1; below
 *   `sm` each segment takes its short word, and a row still too wide for a
 *   phone (five Spanish stage words) scrolls inside its own track rather than
 *   breaking onto a second line. The page itself never scrolls sideways.
 * - **The selected segment is Boat mode's action color**, navy with yellow in
 *   daylight and yellow with navy at night (`--primary` under `.boat-mode`):
 *   the same fill as the one action a crew taps, so "where we are" is the
 *   loudest thing in the track and never only a shadow.
 * - **56px targets** (`min-h-14`), the rail's size for wet hands.
 *
 * Classes, not a component: one track holds server-action forms (the stage)
 * and the other links or buttons (the checkpoint), and each keeps its own
 * element. Never on paper: a control prints nothing.
 */
export const BOAT_SEGMENT_TRACK_CLASS = `${segmentedGridTrackClass} w-full grid-flow-col auto-cols-[minmax(3.5rem,1fr)] overflow-x-auto overscroll-x-contain sm:max-w-2xl print:hidden`;

export function boatSegmentClass(selected: boolean): string {
  return `${SEGMENT_CORNER} inline-flex min-h-14 min-w-14 touch-manipulation items-center justify-center px-2 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:focus-ring-inset sm:px-4 sm:text-base ${
    selected
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-muted hover:bg-surface hover:text-foreground"
  }`;
}
