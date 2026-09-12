/**
 * **Did a server refuse the statement, or was there no server?** — the one
 * question a fail-open `catch` around a query has to answer before it decides
 * how loudly to say so.
 *
 * `src/proxy.ts`'s public-namespace existence check is what forced this. It
 * catches everything and serves the page anyway, deliberately (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge), so the log line is the
 * only trace the failure leaves — and the two failures that reach it are not
 * alike. A shop slug and a course slug go into the lookup unfiltered and
 * length-unbounded on purpose, because the row decides and not a pattern; so
 * `/s/%00` reaches Postgres and comes back SQLSTATE 22021, once per request,
 * for as long as whoever is sending it cares to. The other failure is the
 * database being gone, which stops the edge check for every diver at once and
 * is the thing worth waking somebody for. One funnel logged both at `error`,
 * which made the second unfindable and the first free to write.
 *
 * **The split is the SQLSTATE.** A five-character code means a server received
 * the statement, parsed it and had an opinion — the connection worked, and
 * what is wrong is the statement or its parameters. Classes 08 (connection
 * exception), 53 (insufficient resources), 57 (operator intervention) and 58
 * (system error) are the exceptions a server raises about *itself*, and count
 * as unreachable even though one answered. An error carrying no SQLSTATE never
 * reached a server at all — `ECONNREFUSED`, a socket closed mid-query — and is
 * counted as unreachable too: a classifier that has to guess errs toward the
 * alarm rather than toward silence.
 *
 * **Nothing here carries a driver message.** Drizzle wraps every failure in a
 * `DrizzleQueryError` whose `message` is the SQL followed by the bound
 * parameters verbatim — for the case above that is the attacker's own string —
 * and the driver's own message quotes the offending value for most of class
 * 22. So the only thing reported is `code`, which is a SQLSTATE, a Node errno,
 * or `"unknown"`; anything else is reported as `"unknown"` rather than passed
 * through, since a log line shipped to CloudWatch unauthenticated is not a
 * place to find out what shape a string is.
 */

/** SQLSTATE is five characters, digits and capitals. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** A Node errno, or anything else short and closed enough to log as-is. */
const ERRNO = /^[A-Z][A-Z0-9_]{1,31}$/;

/** SQLSTATE classes a server raises about itself rather than about the query. */
const UNREACHABLE_CLASSES = new Set(["08", "53", "57", "58"]);

/**
 * Drizzle wraps the driver error, and a pooled driver may wrap again, so the
 * code is never on the error that was thrown. Bounded rather than a `while`:
 * a `cause` cycle is not a thing this should hang on.
 */
const MAX_CAUSE_HOPS = 5;

export interface DatabaseFailure {
  /** True when the query never got a verdict from a server that was there. */
  readonly unreachable: boolean;
  /** SQLSTATE, Node errno, or `"unknown"`. Never free text — see the header. */
  readonly code: string;
}

export function classifyDatabaseFailure(error: unknown): DatabaseFailure {
  const code = driverCode(error);
  if (code === null) return { unreachable: true, code: "unknown" };
  if (SQLSTATE.test(code)) {
    return { unreachable: UNREACHABLE_CLASSES.has(code.slice(0, 2)), code };
  }
  return { unreachable: true, code: ERRNO.test(code) ? code : "unknown" };
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
