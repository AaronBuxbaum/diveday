/**
 * **Is this failure about our deployment, or about the caller's own bytes?** —
 * the one question a fail-open `catch` around a query has to answer before it
 * decides how loudly to say so.
 *
 * `src/proxy.ts`'s public-namespace existence check is what forced this. It
 * catches everything and serves the page anyway, deliberately (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge), so the log line is the
 * only trace the failure leaves — and the two failures that reach it are not
 * alike. A shop slug and a course slug go into the lookup unfiltered and
 * length-unbounded on purpose, because the row decides and not a pattern; so
 * `/s/%00` reaches Postgres and comes back SQLSTATE 22021, once per request,
 * for as long as whoever is sending it cares to. Everything else that lands in
 * that `catch` stops the edge check for every diver at once and is the thing
 * worth waking somebody for. One funnel logged both at `error`, which made the
 * second unfindable and the first free to write.
 *
 * **The split is SQLSTATE class 22, and nothing else.** Class 22 is a data
 * exception — the server read a value and would not have it — which on this
 * path is a string off the wire and no statement of ours. Every other code is
 * about *us*: `28P01` (the database rejected our own credentials — a rotated or
 * mis-synced `DATABASE_URL`), `3D000` (wrong database name), `42501` (a grant
 * revoked), `42P01` (a table the code reads and the schema does not have),
 * `25006` (a read-only endpoint after a failover), and the classes a server
 * raises about itself — 08 (connection exception), 53 (insufficient resources),
 * 57 (operator intervention), 58 (system error). Each of those takes the edge
 * check back to fail-open soft 404s for every diver with nothing on a screen to
 * say so, so each one alarms. An error carrying no SQLSTATE never reached a
 * server at all — `ECONNREFUSED`, a socket closed mid-query — and alarms too: a
 * classifier that has to guess errs toward the alarm rather than toward
 * silence.
 *
 * This read the other way round until issue #1750: only 08, 53, 57 and 58
 * alarmed, because "a five-character code means a server answered" was taken
 * for "so the statement is what is wrong". That is true of the case the
 * classifier was written for and false for every code above — our credentials
 * being rejected was a `warn` line no metric counted.
 *
 * **Why widening it hands an anonymous caller no pager.**
 * `public_route.existence_unavailable` feeds `DatabaseUnavailable` at one
 * datapoint in five minutes (`infra/lib/observability.ts`), so a code a
 * stranger can produce is a stranger holding the pager, and the inversion is
 * only safe while class 22 is the whole of what a stranger reaches. Checked
 * against the four readers `publicRouteLookup` calls
 * (`src/db/public-route-existence.ts`): `shopIdBySlug`, `getCourseBySlug`,
 * `getDiveSiteBySlug` and `tripExistsForShop` each issue one **constant**
 * statement and bind the caller's string as a parameter, so nothing about the
 * *statement* varies with the request. That is what rules out the classes
 * raised about a statement rather than a value — class 54
 * (`program_limit_exceeded`) included, which is the one an unbounded slug
 * length looks like a lever on, and which Postgres raises about an index tuple
 * being written or a statement's own size and not about a search key. What is
 * left is the parameter's bytes, and that is class 22: `22021` on a NUL,
 * `22P05` on an untranslatable character. The site slug is held to
 * `parseDiveSiteSlug` and the trip id to `uuidParam` before either reaches a
 * query, so `22P02` is not reachable either. The one code a caller still has
 * any influence over is `57014`, a lookup cancelled by `statement_timeout`
 * under load — class 57 alarmed before this change as well, and a flood that
 * exhausts the pool is a real incident rather than a false one.
 *
 * **`42P01` alarms during a deploy, and that is the intent.** A table missing
 * mid-release is the noisiest code in the set, and also the loudest possible
 * statement that the code and the schema have diverged. Nothing here tolerates
 * that by design: expand/contract and the destructive-migration guard exist so
 * that the previous release keeps reading everything it reads while a migration
 * runs (`.claude/rules/db.md`). A `42P01` out of this lookup is that discipline
 * having been broken, which is worth the page.
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

/**
 * The one SQLSTATE class that is about a value the caller supplied rather than
 * about us: data exception. The header says why it is the whole of what an
 * anonymous caller reaches through this path, and why nothing may be added
 * here without re-checking that.
 */
const CALLER_DATA_CLASS = "22";

/**
 * Drizzle wraps the driver error, and a pooled driver may wrap again, so the
 * code is never on the error that was thrown. Bounded rather than a `while`:
 * a `cause` cycle is not a thing this should hang on.
 */
const MAX_CAUSE_HOPS = 5;

export interface DatabaseFailure {
  /**
   * True when the failure is ours — the database gone, its credentials, its
   * grants, its schema, or no server at all — and so worth an alarm. False only
   * for a statement a server refused over a value the caller supplied, which is
   * an anonymous GET away and must never page anybody.
   */
  readonly alarming: boolean;
  /** SQLSTATE, Node errno, or `"unknown"`. Never free text — see the header. */
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
