/**
 * Classify failures from the public-route existence lookup, whose catch serves
 * the page and relies on `public_route.existence_unavailable` to expose outages
 * (ADR 20260912-the-public-namespace-refuses-at-the-edge). SQLSTATE class 22
 * alone is a caller-data rejection; every other or unknown failure alarms.
 * This boundary assumes `publicRouteLookup` uses constant parameterized
 * statements; re-check it whenever its readers change. Log only a validated
 * SQLSTATE/errno or `unknown`, never a driver message or request value.
 * See `src/db/public-route-existence.ts`.
 */

/** SQLSTATE is five characters, digits and capitals. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** A Node errno, or anything else short and closed enough to log as-is. */
const ERRNO = /^[A-Z][A-Z0-9_]{1,31}$/;

/** SQLSTATE class for caller-supplied data exceptions. */
const CALLER_DATA_CLASS = "22";

/** Bound cause traversal in case wrappers form a cycle. */
const MAX_CAUSE_HOPS = 5;

export interface DatabaseFailure {
  /** Whether this failure should trigger the database-unavailable alarm. */
  readonly alarming: boolean;
  /** Validated SQLSTATE, Node errno, or `"unknown"`; never free text. */
  readonly code: string;
}

export function classifyDatabaseFailure(error: unknown): DatabaseFailure {
  const code = driverCode(error);
  if (code === null) return { alarming: true, code: "unknown" };
  if (SQLSTATE.test(code)) {
    return { alarming: code.slice(0, 2) !== CALLER_DATA_CLASS, code };
  }
  return { alarming: true, code: ERRNO.test(code) ? code : "unknown" };
}

/** The first `code` down the `cause` chain, or `null` if nothing carries one. */
function driverCode(error: unknown): string | null {
  let current = error;
  for (let hop = 0; hop < MAX_CAUSE_HOPS; hop += 1) {
    if (typeof current !== "object" || current === null) return null;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
