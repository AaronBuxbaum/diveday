import { PgAsyncTransaction } from "drizzle-orm/pg-core";
import type { DbExecutor } from "./client";

// The query helpers every db module reaches for. They live apart from
// `client.ts` so that importing them does not import the module that opens,
// migrates and seeds the database: `client.ts` reaches the whole seed graph
// through `./dev-bootstrap`, and a db module that took `queryAll` from it put
// itself, and `client.ts`, in one import cycle (`src/db/import-cycles.test.ts`).

/**
 * Run several independent queries, concurrently only where that is real.
 *
 * A `DbExecutor` is either the pool — where two queries genuinely run at once,
 * on two connections — or a transaction, which is **one checked-out client**.
 * Handing that client concurrent queries buys nothing: `pg` queues them behind
 * each other and warns that it will stop accepting them in pg@9
 * ("Calling client.query() when the client is already executing a query is
 * deprecated"). The parallelism was never real; only the warning was.
 *
 * So a reader shared between a page render and a transaction cannot simply
 * choose. `src/db/trips-schedule.ts` met this first (issue #517) and went
 * sequential, which was right there because it only ever runs in a transaction.
 * `listTripsReadiness` is the other shape: the roster, the manifest and Today
 * all call it on the pool, where the fan-out is worth having, and
 * `checkInBooking` calls it inside its transaction, where it is the warning
 * seen in production on 2026-08-14. This lets one reader be correct in both
 * places instead of being written twice.
 */
export async function queryAll<T extends readonly unknown[] | []>(
  db: DbExecutor,
  queries: { [K in keyof T]: () => Promise<T[K]> },
): Promise<T> {
  if (!isTransactionExecutor(db)) return Promise.all(queries.map((run) => run())) as Promise<T>;
  const results = [];
  for (const run of queries) results.push(await run());
  return results as unknown as T;
}

/**
 * Whether this executor is a transaction — one pinned connection — rather than
 * the pool. Both drivers' transaction classes (`NodePgTransaction` in
 * production, `PgliteTransaction` in tests) extend drizzle's `PgAsyncTransaction`,
 * so the one check covers both.
 */
export function isTransactionExecutor(db: DbExecutor): boolean {
  return db instanceof PgAsyncTransaction;
}

/**
 * Every error in a thrown value's `.cause` chain, outermost first.
 *
 * A driver error never arrives bare: drizzle-orm wraps it in its own
 * `DrizzleQueryError`, whose top level carries **neither** `code` nor
 * `constraint` — both sit on the `pg`/PGlite error nested under `.cause`. Every
 * reader below walks the chain for that reason, and the depth bound keeps a
 * self-referential `cause` from spinning.
 */
function* errorChain(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object") return;
    yield current as Record<string, unknown>;
    current = "cause" in current ? current.cause : undefined;
  }
}

/**
 * Postgres's own SQLSTATE for a failed query — `"23505"`, `"23503"`, and so on
 * — or `undefined` for a failure that never reached the database.
 *
 * Worth having as one function rather than an inline `(error as {code}).code`
 * at each call site, because that inline form reads the *wrapper*, where the
 * field is always absent. `/api/cron/demo-refresh` shipped exactly that and its
 * failure log carried `sqlState: undefined` for every real query error — the
 * one field added (issue #517) so an operator would not have to open Sentry to
 * learn the shape of a failure.
 *
 * A closed vocabulary of five characters: it cannot carry a row value, so it is
 * safe in a structured log line under the no-PII rule.
 */
export function sqlStateOf(error: unknown): string | undefined {
  for (const link of errorChain(error)) {
    if (typeof link.code === "string") return link.code;
  }
  return undefined;
}

/**
 * True for a unique violation raised by one **named** index, so a caller can
 * turn that one collision into a worded refusal without also swallowing an
 * unrelated 23505 from another index the same write touched.
 */
export function violatesUniqueIndex(error: unknown, indexName: string): boolean {
  for (const link of errorChain(error)) {
    if (link.code === "23505" && link.constraint === indexName) return true;
  }
  return false;
}

/**
 * True for an exclusion-constraint violation (SQLSTATE 23P01) raised by one
 * **named** constraint. The sibling of `violatesUniqueIndex` for the other
 * constraint family: the gear-reservation double-booking guard is an
 * `EXCLUDE USING gist`, whose refusal a caller turns into a worded outcome
 * rather than a 500 (ADR 20260815-minimal-gear-register).
 */
export function violatesExclusionConstraint(error: unknown, constraintName: string): boolean {
  for (const link of errorChain(error)) {
    if (link.code === "23P01" && link.constraint === constraintName) return true;
  }
  return false;
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505), however
 * many wrapper layers deep the driver buried it.
 * Callers use this to turn a losing race against a concurrent insert into a
 * graceful re-read instead of an unhandled throw (CR-008).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  for (const link of errorChain(error)) {
    if (link.code === "23505") return true;
  }
  return false;
}
