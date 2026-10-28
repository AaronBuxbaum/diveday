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
import { type PageShape, parsePageShape } from "./page-shape";

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
export const SSI_MANUAL_REQUEST_TYPE = "ssi-manual-fill";
/** Look a course student up on the agency's eLearning page (H-106). */
export const ELEARNING_REQUEST_TYPE = "elearning-check";
/** Which copy is here: its version and the agencies it checks. Answered with `CHECK_RESULT_TYPE`. */
export const HELLO_REQUEST_TYPE = "hello";
/** "Try the checks": fill a sample page the extension carries, for one agency. */
export const DRY_RUN_REQUEST_TYPE = "dry-run";
/** "Try the checks": whether a PADI Pros' Site tab in this browser is signed in. */
export const PADI_SESSION_REQUEST_TYPE = "padi-session";
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

/**
 * The oldest copy of the extension the app talks to. An older one is treated
 * as absent: the agency's link, never its button, and Settings says to update
 * it. Raise it when a fix must reach every browser before checks run again;
 * a staffer's browser may run whatever version was installed weeks ago.
 */
export const MIN_EXTENSION_VERSION = "1.5.0";

/** Whether `version` ("1.12.0") is at or above `minimum`, part by part; false for anything that is not one. */
export function versionAtLeast(version: string | null, minimum: string): boolean {
  const parts = (value: string | null) =>
    typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value)
      ? value.split(".").map(Number)
      : null;
  const have = parts(version);
  const need = parts(minimum);
  if (!have || !need) return false;
  for (let index = 0; index < 3; index += 1) {
    const a = have[index] ?? 0;
    const b = need[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** Whether this browser has the extension, and whether it is a copy the app talks to. */
export type ExtensionPresence =
  | { state: "absent" }
  | { state: "outdated"; version: string }
  | { state: "current"; version: string };

export function extensionPresence(version: string | null): ExtensionPresence {
  if (version === null) return { state: "absent" };
  return versionAtLeast(version, MIN_EXTENSION_VERSION)
    ? { state: "current", version }
    : { state: "outdated", version };
}

/**
 * Why the extension came back without a page. `signed_out` is a lookup behind
 * the shop's own sign-in (PADI) that landed on a sign-in page instead: the
 * staffer is told to sign in, not that the page could not be read. `captcha`
 * is a page asking whether the staffer is human, and `page_changed` a lookup
 * page with no box or button where the lookup expects one: each has its own
 * sentence, beside the agency's link.
 */
export const EXTENSION_FAILURE_REASONS = [
  "unsupported",
  "fill_failed",
  "timeout",
  "tab_failed",
  "signed_out",
  "captcha",
  "page_changed",
  "manual_opened",
] as const;
export type ExtensionFailureReason = (typeof EXTENSION_FAILURE_REASONS)[number];

/**
 * What the extension hands back for one request. A failure may carry the
 * page's shape (`page-shape.ts`), structure only, for DiveDay's log.
 */
export type ExtensionCheckReply =
  | { ok: true; pageText: string }
  | { ok: false; reason: ExtensionFailureReason; pageShape?: PageShape };

/** What a failed reply says, read with nothing taken on trust: a fixed reason, and a shape only if it parses. */
export function extensionFailure(
  data: Record<string, unknown>,
): Extract<ExtensionCheckReply, { ok: false }> {
  const reason = extensionFailureReason(data.reason);
  const pageShape = data.pageShape === undefined ? null : parsePageShape(data.pageShape);
  return pageShape ? { ok: false, reason, pageShape } : { ok: false, reason };
}

/** The extension's answer to hello: its version and the agencies it checks. */
export type ExtensionHello = { version: string; agencies: string[]; elearning: string[] };

const AGENCY_KEY = /^[a-z]{2,10}$/;

/** A hello answer, or null for anything that is not one. */
export function parseExtensionHello(data: Record<string, unknown>): ExtensionHello | null {
  if (data.ok !== true || typeof data.version !== "string") return null;
  if (!versionAtLeast(data.version, "0.0.0")) return null;
  const keys = (value: unknown) =>
    Array.isArray(value) && value.length <= 20 && value.every((key) => AGENCY_KEY.test(String(key)))
      ? (value as string[])
      : null;
  const agencies = keys(data.agencies);
  const elearning = keys(data.elearning);
  if (!agencies || !elearning) return null;
  return { version: data.version, agencies, elearning };
}

/** Whether this copy of the extension checks this agency: current, and listing it. */
export function extensionChecks(hello: ExtensionHello | null, agency: string): boolean {
  return (
    hello !== null &&
    versionAtLeast(hello.version, MIN_EXTENSION_VERSION) &&
    hello.agencies.includes(agency)
  );
}

/**
 * A sample page's dry run: what the filler found, typed and pressed, and
 * whether this browser lets the extension on the agency's own site (Chrome's
 * site access), without which a real check there can neither fill nor read.
 */
export type ExtensionDryRun =
  | {
      ok: true;
      filled: boolean;
      typed: boolean;
      submitted: boolean;
      manual?: boolean;
      hostAccess: boolean;
      missing: string[];
      pageShape?: PageShape;
    }
  | { ok: false; reason: ExtensionFailureReason };

export function parseExtensionDryRun(data: Record<string, unknown>): ExtensionDryRun {
  if (data.ok !== true) return { ok: false, reason: extensionFailureReason(data.reason) };
  const missing = Array.isArray(data.missing)
    ? data.missing.filter((field): field is string => /^[a-zA-Z]{1,20}$/.test(String(field)))
    : [];
  const pageShape = data.pageShape === undefined ? null : parsePageShape(data.pageShape);
  return {
    ok: true,
    filled: data.filled === true,
    typed: data.typed === true,
    submitted: data.submitted === true,
    ...(data.manual === true ? { manual: true } : {}),
    hostAccess: data.hostAccess === true,
    missing: missing.slice(0, 10),
    ...(pageShape ? { pageShape } : {}),
  };
}

/**
 * Whether a dry run did all it should: every box found, typed as the agency
 * wants, and sent, in a browser that lets the extension on the agency's site.
 */
export function dryRunPassed(run: ExtensionDryRun | null): boolean {
  return (
    run?.ok === true &&
    run.filled &&
    run.typed &&
    (run.manual ? !run.submitted : run.submitted) &&
    run.hostAccess
  );
}

/**
 * Whether a PADI Pros' Site tab in this browser is signed in, or (`no_access`)
 * whether this browser keeps the extension off PADI's hosts. Nothing was
 * looked up to say so.
 */
export type PadiSession = "signed_in" | "signed_out" | "no_tab" | "no_access";

const PADI_SESSIONS: readonly unknown[] = ["signed_in", "signed_out", "no_tab", "no_access"];

export function parsePadiSession(data: Record<string, unknown>): PadiSession | null {
  return data.ok === true && PADI_SESSIONS.includes(data.padi) ? (data.padi as PadiSession) : null;
}

/** The extension's reason, or `fill_failed` for anything it did not say plainly. */
export function extensionFailureReason(reason: unknown): ExtensionFailureReason {
  return (EXTENSION_FAILURE_REASONS as readonly unknown[]).includes(reason)
    ? (reason as ExtensionFailureReason)
    : "fill_failed";
}

export function extensionVersion(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute(EXTENSION_MARKER_ATTRIBUTE);
}
