import { lt, sql } from "drizzle-orm";
import type { RateLimitStore } from "@/lib/rate-limit";
import { type DbExecutor, getDb } from "./client";
import { rateLimitBuckets } from "./schema";

/** A bucket idle this long has refilled past every configured window (15 min to 1 hour). */
const IDLE_BUCKET_MS = 24 * 60 * 60 * 1000;

/** One take in this many also sweeps idle buckets, so the table stays small without a cron. */
const SWEEP_ONE_IN = 200;

type Config = { capacity: number; refillPerMs: number };

/** The bucket's tokens after refilling since its last update, never past capacity. */
function refilled(config: Config, now: number) {
  return sql`least(${config.capacity}::double precision, ${rateLimitBuckets.tokens} + greatest(0, ${now}::bigint - ${rateLimitBuckets.updatedAt}) * ${config.refillPerMs}::double precision)`;
}

/**
 * Takes one token in a single atomic statement: a second instance racing on the same key
 * waits on the row lock and reads the first one's result, so two requests can never both
 * spend the same token. Returns whether a token was spent and what is left.
 */
export async function takeFromBucket(
  db: DbExecutor,
  key: string,
  config: Config,
  now: number,
): Promise<{ allowed: boolean; tokens: number }> {
  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key, tokens: config.capacity - 1, updatedAt: now, lastAllowed: true })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        tokens: sql`case when ${refilled(config, now)} >= 1 then ${refilled(config, now)} - 1 else ${refilled(config, now)} end`,
        lastAllowed: sql`${refilled(config, now)} >= 1`,
        updatedAt: now,
      },
    })
    .returning({ allowed: rateLimitBuckets.lastAllowed, tokens: rateLimitBuckets.tokens });
  if (Math.floor(Math.random() * SWEEP_ONE_IN) === 0) {
    await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.updatedAt, now - IDLE_BUCKET_MS));
  }
  return { allowed: row.allowed, tokens: row.tokens };
}

/** Gives one token back, refilled first and never past capacity. A key never seen stays unseen. */
export async function refundToBucket(
  db: DbExecutor,
  key: string,
  config: Config,
  now: number,
): Promise<void> {
  await db
    .update(rateLimitBuckets)
    .set({
      tokens: sql`least(${config.capacity}::double precision, ${refilled(config, now)} + 1)`,
      updatedAt: now,
    })
    .where(sql`${rateLimitBuckets.key} = ${key}`);
}

/**
 * The shared store a deployment installs as the rate limiter's default: every serverless
 * instance spends from the same buckets. A database error throws, which `checkRateLimit`'s
 * fail-open wrapper turns into `{ allowed: true }` (and the doctor's date-of-birth gate into a
 * refusal).
 */
export function postgresRateLimitStore(): RateLimitStore {
  return {
    async take(key, config, now) {
      const { allowed, tokens } = await takeFromBucket(await getDb(), key, config, now);
      if (allowed) return { allowed: true, retryAfterMs: 0 };
      const retryAfterMs =
        config.refillPerMs > 0
          ? Math.ceil((1 - tokens) / config.refillPerMs)
          : Number.POSITIVE_INFINITY;
      return { allowed: false, retryAfterMs };
    },
    async refund(key, config, now) {
      await refundToBucket(await getDb(), key, config, now);
    },
  };
}
