import { log } from "./log";

/**
 * Tuning for the `pg` `Pool` used by `src/db/client.ts`'s production
 * (Neon/Postgres) branch. `pg`'s own default `max` is 10 connections *per
 * `Pool` instance* — on serverless (Vercel functions), every concurrent cold
 * instance gets its own `Pool`, so an un-tuned pool multiplies against the
 * database's connection cap. `idleTimeoutMillis` releases idle connections
 * back promptly instead of pinning them for an instance's whole lifetime;
 * `connectionTimeoutMillis` fails a cold start fast instead of hanging when
 * the database is unreachable. All three are overridable via env
 * (`DATABASE_POOL_MAX` / `DATABASE_POOL_IDLE_TIMEOUT_MS` /
 * `DATABASE_POOL_CONNECTION_TIMEOUT_MS`) for load testing or a different
 * provider's limits, without a code change.
 *
 * **`max` depends on what the URL points at** (app audit 2026-10-07, item 5).
 * The cap that `max: 5` was protecting is Postgres's own `max_connections`,
 * which a *direct* connection spends one of per pooled client. Neon's pooled
 * URL — the `-pooler` host ADR 20260718-vercel-neon-hosting puts on the
 * request path — is PgBouncer in transaction mode, which accepts up to 10,000
 * client connections and multiplexes them onto its own bounded server pool, so
 * a client connection there costs PgBouncer a socket, not Postgres a backend.
 * Against that, five was a ceiling on how much of one *render* could run at
 * once: the shop home, the trip page and Today's queue each fan out fifteen or
 * sixteen reads in one `Promise.all`, which five connections ran in four
 * waves. Ten runs them in two. Any other URL — a direct Neon connection, an
 * RDS endpoint after H-20260907-far-diveday-migrate-onto — keeps five, because there a client connection is a
 * Postgres backend and the reasoning above still holds.
 */
export type DbPoolConfig = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

/** A direct Postgres connection: each pooled client is one server backend. */
const DEFAULT_POOL_MAX = 5;
/** Neon's PgBouncer endpoint: client connections are cheap, server ones are its own. */
const DEFAULT_POOLER_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MILLIS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 5_000;

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * Whether a connection string names Neon's pooled (PgBouncer) endpoint, whose
 * host carries `-pooler` in its first label (`ep-x-123-pooler.region.aws.neon.tech`).
 * An unparseable string is treated as direct, the cautious answer.
 */
export function isPgBouncerUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.split(".")[0]?.endsWith("-pooler") ?? false;
  } catch {
    return false;
  }
}

export function getDbPoolConfig(
  env: Record<string, string | undefined> = process.env,
): DbPoolConfig {
  const defaultMax = isPgBouncerUrl(env.DATABASE_URL) ? DEFAULT_POOLER_POOL_MAX : DEFAULT_POOL_MAX;
  return {
    max: positiveIntFromEnv(env.DATABASE_POOL_MAX, defaultMax),
    idleTimeoutMillis: positiveIntFromEnv(
      env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      DEFAULT_IDLE_TIMEOUT_MILLIS,
    ),
    connectionTimeoutMillis: positiveIntFromEnv(
      env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MILLIS,
    ),
  };
}

/**
 * Whether a failure to *open* a connection is worth one more attempt.
 *
 * Only ever asked of an error from `pool.connect()`, so no statement was sent: a retry here cannot
 * run a query twice. What it filters out is the refusal another attempt cannot change. A
 * five-character SQLSTATE means the server (or Neon's proxy) answered, and only three of those
 * answers are passing: class 08 (connection exception), 57P03 (`cannot_connect_now`, the database
 * starting up) and 53300 (`too_many_connections`). Everything else with a SQLSTATE -- a wrong
 * password (class 28), a missing database (3D000) -- fails the same way twice. An error without one
 * is a timeout or a socket error (`ETIMEDOUT`, `ECONNRESET`, pg-pool's "timeout exceeded when trying
 * to connect"), which is what a suspended Neon compute waking up looks like. A pool that has been
 * ended is never retried.
 */
export function isRetryableConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith("Cannot use a pool after calling end")) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !/^[0-9A-Z]{5}$/.test(code)) return true;
  return code.startsWith("08") || code === "57P03" || code === "53300";
}

type ConnectCallback = (error: Error | undefined, client?: unknown, done?: unknown) => void;

/** The one method of a `pg` Pool this wraps; typed narrowly so `src/lib` needs no `pg` import. */
interface ConnectingPool {
  connect: (...args: never[]) => unknown;
}

/**
 * Try a failed connection once more before anyone sees the error (pre-mortem 2026-10-23, item 6).
 *
 * Neon suspends the compute after five idle minutes (ADR 20260919-health-check-does-not-wake-the-database),
 * and the hourly crons keep it awake only about eleven minutes in sixty, so the first desk request
 * after a lull usually lands on a cold database. Waking usually takes well under a second and can
 * outlast the five-second `connectionTimeoutMillis` above; a second attempt then finds the compute
 * awake. Aaron chose this over paying to keep the compute always on (H-20261023-no-always-on-database).
 *
 * **Only the connection is retried, never a statement.** This replaces the pool's own `connect`,
 * which both `pool.query` (it calls `this.connect` with a callback) and a transaction's checkout
 * (the promise form) go through, and an error from `connect` means no statement was sent. A query
 * that fails after its connection opened reaches the caller unchanged, because it may have run.
 * One retry, no delay: pg-pool's own timeout already spent five seconds waiting.
 */
export function retryConnectOnce(pool: ConnectingPool): void {
  const connect = pool.connect.bind(pool) as (callback?: ConnectCallback) => unknown;
  const noteRetry = (error: Error) => {
    const code = (error as { code?: unknown }).code;
    log("db_pool.connect_retried", "warn", {
      name: error.name,
      code: typeof code === "string" ? code : null,
    });
  };
  const retrying = (callback?: ConnectCallback): unknown => {
    if (callback) {
      connect((error, client, done) => {
        if (error && isRetryableConnectError(error)) {
          noteRetry(error);
          connect(callback);
          return;
        }
        callback(error, client, done);
      });
      return undefined;
    }
    return (connect() as Promise<unknown>).catch((error: unknown) => {
      if (!isRetryableConnectError(error)) throw error;
      noteRetry(error as Error);
      return connect();
    });
  };
  pool.connect = retrying as ConnectingPool["connect"];
}

/** The one event of a `pg` Pool this listens to; typed narrowly so `src/lib` needs no `pg` import. */
interface PoolErrorEmitter {
  on(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * Give the pool an `"error"` listener, so a dropped idle connection is a log
 * line instead of the end of the process.
 *
 * A `pg` Pool re-emits an error from any *idle* client — Neon suspending its
 * compute, a network blip, a server-side `idle_session_timeout` — and Node
 * treats an `EventEmitter`'s `"error"` with no listener as an uncaught
 * exception. With none attached, the first idle connection Neon closed took
 * down the whole server instance, every in-flight request with it. The pool
 * has already discarded the broken client by the time this runs, and the next
 * query opens a fresh one, so logging is all there is to do.
 *
 * `warn`, not `error`, and counted by no alarm: Neon closing idle connections
 * when it scales to zero is routine, and a database that is really gone shows
 * up on the query path (`DatabaseUnavailable`). Codes only — a `pg` error
 * message can quote a statement.
 */
export function listenForPoolErrors(pool: PoolErrorEmitter): void {
  pool.on("error", (error) => {
    const code = (error as { code?: unknown }).code;
    log("db_pool.idle_client_error", "warn", {
      name: error.name,
      code: typeof code === "string" ? code : null,
    });
  });
}
