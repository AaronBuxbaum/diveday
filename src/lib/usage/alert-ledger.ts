import { eq, lte } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { notificationRateLimitState } from "@/db/schema";
import { nowDate } from "@/lib/clock";

/**
 * "Has this exact alert already been sent this period?" — the one durable fact
 * the usage monitor needs to keep.
 *
 * ## Why this needs a claim at all
 *
 * The obvious answer is that `notification_send_queue.idempotency_key` is
 * unique, so keying the alert on ceiling + period + level already gives
 * once-per-period. It does not, and the reason is worth stating because it is
 * easy to believe otherwise from reading `sendNotification`: **a row only ever
 * enters that queue when a send fails and is retryable** (`queueRetry`, called
 * from the failure branch). A *successful* send writes nothing. So the unique
 * key deduplicates retries of a failed message and nothing else — a cron that
 * sent successfully yesterday would send again today, and again every day for
 * the rest of the month, which is precisely the daily-noise failure this
 * feature was asked to avoid.
 *
 * ## Why this table
 *
 * `notification_rate_limit_state` already exists, is empty, and is exactly the
 * shape needed: a text `key` and a `next_allowed_at` instant. Its original
 * purpose — a coordinated per-second permit clock for a provider needing one —
 * was never taken up (`src/db/schema.ts` says so), and "this notification may
 * not be sent again before T" is the same question the column was named for.
 * Reusing it costs no migration and adds no table, which matters more than
 * naming purity for a monitor whose entire job is to be cheap.
 *
 * ## Semantics
 *
 * One statement, so two overlapping runs cannot both win. `INSERT … ON CONFLICT
 * DO UPDATE … WHERE next_allowed_at <= now` updates only an expired claim; a
 * live one leaves the row untouched and `RETURNING` comes back empty, which is
 * the caller's "already alerted". A fresh key inserts and returns.
 */

/**
 * Try to claim the right to send one alert until `until`.
 *
 * `true` — the caller won the claim and should send. `false` — somebody
 * already holds it for this period.
 *
 * Nothing here is a gate on anything a diver or a shop can see; the worst a
 * bug costs is a duplicate email or a missed one, which is why the caller is
 * free to treat a *throw* as "send anyway" (a cost alert nobody sees is more
 * expensive than a cost alert seen twice).
 */
export async function claimUsageAlert(
  db: AppDb,
  key: string,
  until: Date,
  now: Date = nowDate(),
): Promise<boolean> {
  const [claimed] = await db
    .insert(notificationRateLimitState)
    .values({ key, nextAllowedAt: until })
    .onConflictDoUpdate({
      target: notificationRateLimitState.key,
      set: { nextAllowedAt: until },
      setWhere: lte(notificationRateLimitState.nextAllowedAt, now),
    })
    .returning({ key: notificationRateLimitState.key });
  return claimed !== undefined;
}

/**
 * Give a claim back, because the send it was taken for did not happen.
 *
 * Without this, a period's alert is spent the moment it is *attempted*: SES
 * unconfigured, a throttle, a transient 5xx — and the ceiling stays silent for
 * the rest of the month having never told anyone anything. That is the same
 * false-quiet this whole feature exists to prevent, arriving through the dedup
 * instead of through a probe. Claim before sending so two runs cannot both
 * send; release after a failure so tomorrow's run tries again.
 */
export async function releaseUsageAlert(db: AppDb, key: string): Promise<void> {
  await db.delete(notificationRateLimitState).where(eq(notificationRateLimitState.key, key));
}
