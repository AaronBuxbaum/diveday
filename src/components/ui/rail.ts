/**
 * **A page rail's row** — one box for the two rails that name the places on a
 * long page: the settings map (`SettingsRail`) and the long editor's section
 * rail (`EditorRail`).
 *
 * They are one control, and they were two hand-rolled strings: the settings
 * rows 36px tall at `px-2`, the editor's 44px at `px-3 py-2`, so the same
 * control stood at two heights and two insets (pixel-craft.md, class 12). The
 * settings rail had argued its 36px from "no finger ever reaches this
 * control", but both rails show from `lg` up, and 1024px is a landscape tablet
 * held in the hand, so the 44px floor (principles.md §2) is theirs as well.
 *
 * The ring is drawn inside the row: a rail's rows sit flush with the edge of
 * a scroll box that clips an outset ring, and they stack with no gap, so an
 * outset ring would also paint over the rows either side.
 *
 * Tones are separate so a caller can choose where the current row shows: the
 * settings rail lights it always, the editor's only from `lg`, where it is a
 * column beside the sections rather than a jump row above them.
 */
export const RAIL_ROW_CLASS =
  "flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:focus-ring-inset";

/** A row on offer. */
export const RAIL_ROW_IDLE = "text-muted hover:bg-surface-sunken hover:text-foreground";

/** The row the reader is on: the primary tint, never the accent. */
export const RAIL_ROW_CURRENT = "bg-primary-tint text-primary";
