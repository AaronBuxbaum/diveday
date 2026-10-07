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
 * RDS endpoint after H-45 — keeps five, because there a client connection is a
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
