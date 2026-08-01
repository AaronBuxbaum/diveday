/**
 * Tuning for the `pg` `Pool` used by `src/db/client.ts`'s production
 * (Neon/Postgres) branch. `pg`'s own default `max` is 10 connections *per
 * `Pool` instance* — on serverless (Vercel functions), every concurrent cold
 * instance gets its own `Pool`, so that default multiplies badly against
 * Neon's shared per-database connection cap. `max: 5` keeps a single
 * instance's ceiling modest; `idleTimeoutMillis` releases idle connections
 * back to Neon promptly instead of pinning them for an instance's whole
 * lifetime; `connectionTimeoutMillis` fails a cold start fast instead of
 * hanging when Neon is unreachable. All three are overridable via env
 * (`DATABASE_POOL_MAX` / `DATABASE_POOL_IDLE_TIMEOUT_MS` /
 * `DATABASE_POOL_CONNECTION_TIMEOUT_MS`) for load testing or a different
 * provider's limits, without a code change.
 */
export type DbPoolConfig = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

const DEFAULT_POOL_MAX = 5;
const DEFAULT_IDLE_TIMEOUT_MILLIS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 5_000;

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function getDbPoolConfig(
  env: Record<string, string | undefined> = process.env,
): DbPoolConfig {
  return {
    max: positiveIntFromEnv(env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX),
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
