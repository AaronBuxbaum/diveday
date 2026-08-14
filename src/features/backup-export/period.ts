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

/** What one platform pass did, as counts. Never shop names -- see the census key. */
export type PlatformBackupCensus = {
  /** Every non-demo shop the pass was supposed to reach. */
  shops: number;
  /** Bundles it actually PUT. */
  stored: number;
  /** Shops whose bundle build or upload raised. */
  failed: number;
  /** Shops it never started, because the soft deadline came first. */
  skipped: number;
};

/**
 * The one object per run that says how big the run *should* have been:
 * `exports/<YYYY-MM-DD>/_run.shops-40.stored-25.failed-0.skipped-15`.
 *
 * ## Why the counts are in the key rather than the body
 *
 * The freshness watchdog (`infra/lib/infra-stack.ts` S19) could see that a run
 * prefix existed, was recent, and held at least one `.zip`. It could not see
 * how many bundles it *should* have found -- so the failure that gets worse as
 * the product succeeds was invisible: once the estate outgrows the pass's
 * 300-second slot, the run backs up the oldest N shops in `createdAt` order and
 * skips the rest, every week, forever. The prefix exists. It has bundles in it.
 * It is one day old. The watchdog says ok, and the newest-joined shops -- the
 * ones a growing business can least afford to lose -- have never been backed up
 * at all. Nobody finds out until a restore.
 *
 * The obvious fix is a `_manifest.json` the watchdog fetches. That costs a
 * `s3:GetObject`, and `infra/lib/backup-freshness.test.ts` asserts, on purpose
 * and in its own test, that this watchdog can never read, write or delete an
 * object. That property is load-bearing: the uploader credential is safe to
 * keep in Vercel precisely because no principal reachable from the app can read
 * a bundle back, and a weekly unattended function with GetObject on the bundles
 * is exactly the principal an attacker would want. Scoping the grant to one key
 * pattern would weaken a tested invariant to save an API call.
 *
 * So the census goes where the watchdog can already see it. It does one
 * `ListObjectsV2` over the run prefix to count `.zip`s, and a listing returns
 * **keys** -- so a key that carries the numbers is read for free, with no new
 * IAM, no second call, and the write-only posture untouched. That is continuous
 * with why the prefix is date-first in the first place (see
 * `platformBackupObjectKey`): this layout exists to be legible to a principal
 * that may only list.
 *
 * The object still gets a JSON body, which nothing automated reads. It is for
 * the operator who is already in the console during an incident and can open
 * it -- the key is the contract, the body is the courtesy.
 *
 * `_` leads the name so the census sorts above the letter-initial slugs a
 * listing mostly holds. Only mostly: `_` is 0x5F, so a shop whose slug starts
 * with a digit files above it. That is cosmetic -- the watchdog finds the
 * census by pattern, never by position. What is *not* cosmetic is that a census
 * can never be mistaken for a bundle, in either direction: the watchdog counts
 * only keys ending `.zip`, and this one never does.
 */
export function platformBackupCensusKey(runDate: string, census: PlatformBackupCensus): string {
  const { shops, stored, failed, skipped } = census;
  return `exports/${runDate}/_run.shops-${shops}.stored-${stored}.failed-${failed}.skipped-${skipped}`;
}

/**
 * The census key's fields, or `null` for any key that is not one.
 *
 * This is the *reference* implementation of the parse the watchdog's inline
 * Lambda performs (S19). Two copies exist because the Lambda cannot import from
 * `src/` -- it is a string of inline JavaScript in a CDK template -- so this one
 * is what the tests pin the format against, and the Lambda's regex is asserted
 * to match it in `infra/lib/backup-freshness.test.ts`. Change the format here
 * and that test fails until the Lambda agrees.
 */
export function parsePlatformBackupCensusKey(key: string): PlatformBackupCensus | null {
  const match = /_run\.shops-(\d+)\.stored-(\d+)\.failed-(\d+)\.skipped-(\d+)$/.exec(key);
  if (!match) return null;
  return {
    shops: Number(match[1]),
    stored: Number(match[2]),
    failed: Number(match[3]),
    skipped: Number(match[4]),
  };
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
