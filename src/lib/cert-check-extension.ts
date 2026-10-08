/**
 * **The DiveDay browser extension, seen from the app** (H-105, ADR
 * 20261008-cert-check-extension).
 *
 * The extension (`extension/` at the repo root) checks a certification card on
 * the agency's own lookup page from the staffer's own browser. The app learns
 * it is there from a marker its content script sets on DiveDay's own pages,
 * and talks to it with `window.postMessage`, the one channel every browser's
 * extensions share. These names are the wire format: `extension/protocol.js`
 * holds the extension's copy, and `cert-check-extension.test.ts` holds the two
 * together.
 *
 * Client-safe on purpose: the diver record's client component imports it.
 */

/** Set on `<html>` by the extension's content script, to its version. */
export const EXTENSION_MARKER_ATTRIBUTE = "data-diveday-cert-check";
/** Dispatched on `window` once the marker is set, for a page already rendered. */
export const EXTENSION_READY_EVENT = "diveday-cert-check-ready";
/** `source` on a message the page sends. */
export const PAGE_MESSAGE_SOURCE = "diveday-page";
/** `source` on a message the extension sends back. */
export const EXTENSION_MESSAGE_SOURCE = "diveday-cert-check";
/** Look this diver's card up with this agency. */
export const CHECK_REQUEST_TYPE = "agency-check";
/** Look a course student up on the agency's eLearning page (H-106). */
export const ELEARNING_REQUEST_TYPE = "elearning-check";
export const CHECK_RESULT_TYPE = "agency-check-result";
/** Longer than a slow agency page, shorter than a staffer's patience. */
export const CHECK_TIMEOUT_MS = 45_000;

/**
 * The extension's Chrome Web Store listing, once it has one. Publishing it
 * needs DiveDay's own developer account, so it is Aaron's step (H-105); until
 * then Settings says whether this browser has the extension and offers no
 * install link.
 */
export const EXTENSION_STORE_URL: string | null = null;

/** What the extension hands back for one request. */
export type ExtensionCheckReply =
  | { ok: true; pageText: string }
  | { ok: false; reason: "unsupported" | "fill_failed" | "timeout" | "tab_failed" };

export function extensionVersion(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute(EXTENSION_MARKER_ATTRIBUTE);
}
