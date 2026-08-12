/**
 * The backup cadence's unit of idempotency: one ISO-8601 week, in UTC.
 *
 * The weekly cron may fire more than once inside a week — a platform retry, a
 * redeploy replaying the tick, an operator invoking it by hand — and "one
 * succeeded scheduled delivery per shop per period" is what turns those into
 * no-ops instead of duplicate uploads. ISO weeks rather than calendar dates so
 * the key is stable across however many days a retry drifts, and UTC rather
 * than each shop's timezone so one cron pass computes one key for every shop.
 */

/** "2026-W32" for any instant inside that ISO week (UTC). */
export function backupPeriodKey(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO weeks belong to the year of their Thursday: shift to this week's
  // Thursday, then count weeks from that year's January 1st.
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** "2026-08-12" — the UTC calendar date, which is what a platform run is filed under. */
export function backupRunDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Where one shop's bundle lands in DiveDay's *own* backup bucket:
 * `exports/<YYYY-MM-DD>/<shop-slug>.zip`.
 *
 * Date first, so a whole run is one prefix. That is not cosmetic — it is the
 * property the freshness watchdog depends on. The uploader credential is
 * write-only by design (no `ListBucket`, `infra/lib/infra-stack.ts` §11), so
 * nothing on the application side can ever see what landed; the check has to
 * come from a different principal in AWS, and a single `ListObjectsV2` with
 * `delimiter=/` over `exports/` returns the run dates as common prefixes that
 * sort lexicographically into chronological order. A key laid out any other way
 * would make that one cheap call into a full-bucket scan.
 *
 * Deterministic, like the shop-owned key: a re-run on the same day overwrites
 * its own objects rather than accumulating copies. The bucket is versioned, so
 * an overwrite adds a version instead of destroying the earlier bundle.
 */
export function platformBackupObjectKey(runDate: string, shopSlug: string): string {
  return `exports/${runDate}/${shopSlug}.zip`;
}

/**
 * Where the period's bundle lands inside the bucket. Deterministic on purpose:
 * a retried week overwrites its own object instead of accumulating copies, and
 * a shop browsing its bucket reads the week straight off the file name.
 */
export function backupObjectKey(prefix: string, shopSlug: string, periodKey: string): string {
  const cleaned = prefix.replace(/^\/+|\/+$/g, "");
  const name = `diveday-backup-${shopSlug}-${periodKey}.zip`;
  return cleaned ? `${cleaned}/${name}` : name;
}
