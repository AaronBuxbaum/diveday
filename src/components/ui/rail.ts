/**
 * **A page rail's row's box alone**: its height, its inset and its corner,
 * for a stand-in that has to occupy a row without being a control. The
 * settings rail's loading skeleton draws each bar in one, so the rows land
 * where their bars were (K-345). `RAIL_ROW_CLASS` below is this and the row's
 * type, tone transition and inset ring.
 */
export const RAIL_ROW_BOX = "flex min-h-11 items-center rounded-lg px-3 py-2";

/**
 * **A page rail's row** — one 44px target with the inset focus ring that stays
 * inside the settings rail's flush, adjacent rows.
 */
export const RAIL_ROW_CLASS = `${RAIL_ROW_BOX} text-sm font-medium transition-colors focus-visible:focus-ring-inset`;

/** A row on offer. */
export const RAIL_ROW_IDLE = "text-muted hover:bg-surface-sunken hover:text-foreground";

/** The row the reader is on: the primary tint, never the accent. */
export const RAIL_ROW_CURRENT = "bg-primary-tint text-primary";
