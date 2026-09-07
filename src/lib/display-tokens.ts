/**
 * The departures board's framework-free rules (issue #1426, N-23).
 *
 * A **display link** is a revocable bearer URL a shop puts on a lobby TV or a
 * dock tablet: `/board/<token>`. The token itself comes from
 * `src/lib/bearer-tokens.ts`; the rows live in `display_tokens`
 * (`src/db/display-tokens.ts`); what the board may show is decided by the
 * reader in `src/db/departures-board.ts`. This module holds the three rules
 * that are neither storage nor rendering.
 */

/** A label is the shop's own word for which screen this is — one short line. */
export const DISPLAY_LABEL_MAX_LENGTH = 60;

/**
 * The board's path for a raw token. The token is base64url and survives a
 * path segment untouched, but it is encoded anyway so a caller can never hand
 * this a value that detaches the segment.
 */
export function boardPath(token: string): string {
  return `/board/${encodeURIComponent(token)}`;
}

/**
 * Collapses whitespace and bounds the length; `null` for a label that is
 * nothing but whitespace or too long. Refused rather than truncated: the label
 * is the only thing that tells two screens apart on the settings page, and a
 * silently shortened one could read as a different screen.
 */
export function normalizeDisplayLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0 || collapsed.length > DISPLAY_LABEL_MAX_LENGTH) return null;
  return collapsed;
}

export type BoardTitle = { kind: "title"; title: string } | { kind: "private" };

/**
 * **A private charter is never named on a public screen** — the same rule the
 * storefront's live-boat panel applies (`liveShopStage`, src/db/trip-stages.ts).
 * The boat still gets a row, because its divers are standing in the lobby too
 * and need the time and the dock; what the row carries instead of a client's
 * name is the bundle's own word for it.
 */
export function boardTitleFor(departure: { title: string; isPrivate: boolean }): BoardTitle {
  return departure.isPrivate ? { kind: "private" } : { kind: "title", title: departure.title };
}
