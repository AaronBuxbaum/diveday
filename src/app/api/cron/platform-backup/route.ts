import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  backupRunDate,
  listShopsForPlatformBackup,
  platformBackupConfigFromEnvironment,
  runPlatformBackup,
  storePlatformBackupCensus,
} from "@/features/backup-export";
import { toDiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { flushLogs } from "@/lib/observability";

/**
 * Same ceiling as the shop-owned pass: a bundle is real megabytes for a
 * photo-heavy shop and the upload crosses the network. The soft deadline below
 * is what actually keeps a pass from being killed mid-upload.
 */
export const maxDuration = 300;

/**
 * Stop starting new shops once this much of the slot is gone. A shop that has
 * begun is allowed to finish -- the alternative is a truncated zip PUT over a
 * good one -- so the margin has to cover one whole shop's build and upload, not
 * just the request teardown. 240s of a 300s ceiling leaves that minute.
 *
 * A pass that stops early is not a failure and does not alarm: the shops it
 * reached have this week's bundle, the ordering is stable so it reaches the same
 * ones next week, and the freshness watchdog in infra/ is what notices if the
 * *whole* run stops landing. What would be a failure is silence about it, which
 * is why `skipped` rides in the log line and the response.
 */
const SOFT_DEADLINE_MS = 240_000;

/** Its own Sentry monitor: a missed platform backup is a different incident from a missed shop one. */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_PLATFORM_BACKUP_CRON_MONITOR_SLUG || "diveday-platform-backup";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json. Generous
 * `checkinMargin` for the same reason as the shop-owned pass -- a weekly backup
 * running hours late is not an incident -- and `maxRuntime` above `maxDuration`
 * so a platform-killed run reads as timed-out rather than still running.
 */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "0 5 * * 1" },
  checkinMargin: 240,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * The weekly DiveDay-side logical export (ADR 20260812-platform-backup-runner,
 * closing the `TODO(owner)` that left docs/engineering/backup-and-restore-runbook.md
 * §2 a documented capability rather than a running backup).
 *
 * For every non-demo shop: build the full export bundle -- the same artifact
 * the staff download and the shop-owned backup produce -- and PUT it to
 * DiveDay's own private, versioned bucket at `exports/<date>/<slug>.zip`.
 *
 * Three properties worth stating because they are what make this safe to run
 * unattended:
 *
 *  - **One shop's failure never costs another its backup.** Every per-shop
 *    error is a code in the outcome list, never a throw.
 *  - **It is idempotent.** Object keys are deterministic per run date and the
 *    bucket is versioned, so a retried or double-fired pass overwrites its own
 *    objects additively.
 *  - **It never reports success it cannot see.** The uploader credential has no
 *    `ListBucket`, so this route knows only that each PUT was accepted. Whether
 *    the week's bundles are actually *there* is answered by the watchdog in
 *    infra/ §19, from a different principal, on a different schedule.
 *
 * Fails closed like the other crons: `CRON_SECRET` must be configured and
 * presented as a bearer token, or the endpoint answers 503 (unconfigured) /
 * 401 (wrong or missing token) and stores nothing. The auth gate runs *before*
 * the Sentry check-in so an unauthorized probe can never tell the monitor the
 * backup happened.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  // Before the check-in: a deployment with no uploader credential has no
  // platform backup, and saying "ok" to the monitor would be a lie that reads
  // as a healthy weekly backup forever. 501 rather than 503 -- this is "not
  // configured to do this at all", not "temporarily unable".
  const config = platformBackupConfigFromEnvironment();
  if (!config) {
    log("cron_platform_backup.not_configured", "warn", {});
    await flushLogs();
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );

  try {
    const db = await getDb();
    const now = nowDate();
    const runDate = backupRunDate(now);
    const startedAt = Date.now();
    // Event links inside trips.ics come from server configuration, never a
    // request header (src/lib/notifications/app-url.ts).
    const origin = publicAppUrl() ?? new URL(request.url).origin;

    const shops = await listShopsForPlatformBackup(db);
    const outcomes: { shop: string; status: string; errorCode?: string }[] = [];
    let stored = 0;
    let failed = 0;
    let skipped = 0;

    for (const shop of shops) {
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
        skipped += 1;
        continue;
      }
      const t = staffTranslator(toDiverLocale(shop.locale));
      const result = await runPlatformBackup(db, {
        shopId: shop.id,
        config,
        origin,
        now,
        icsLabels: {
          calendarName: t("feed.shopTripsName", { shop: shop.slug }),
          crew: t("feed.crew"),
          course: t("feed.course"),
          day: (dayNumber) => t("feed.day", { number: dayNumber }),
        },
      });
      if (result.status === "stored") stored += 1;
      if (result.status === "failed") {
        failed += 1;
        Sentry.captureMessage("platform backup failed for a shop", {
          level: "error",
          tags: { backup_shop: shop.slug, backup_error: result.errorCode },
        });
        outcomes.push({ shop: shop.slug, status: result.status, errorCode: result.errorCode });
        continue;
      }
      outcomes.push({ shop: shop.slug, status: result.status });
    }

    // The run's census, filed beside its bundles so the AWS-side watchdog can
    // tell a complete pass from a truncated one. Until this existed, a pass that
    // ran out of slot and backed up the oldest N shops every week looked
    // identical from the bucket to one that backed up all of them
    // (FU-20260812-backup-watchdog-cannot-see-a-short-run).
    //
    // Never allowed to fail the pass: every bundle above is already stored, and
    // reporting a good backup as broken because its receipt was refused is the
    // opposite of what this object is for. A refused census is a log line here
    // and a `census_missing` alarm from AWS a day later.
    const census = { shops: shops.length, stored, failed, skipped };
    const censusStored = await storePlatformBackupCensus({ config, census, now });
    if (!censusStored.ok) {
      log("cron_platform_backup.census_failed", "warn", { runDate, code: censusStored.errorCode });
    }

    // One line per run -- ids and codes only (LogContext's rule).
    log("cron_platform_backup.pass_complete", "info", {
      runDate,
      shops: shops.length,
      stored,
      failed,
      skipped,
      failedShops:
        outcomes
          .filter((outcome) => outcome.status === "failed")
          .map((outcome) => outcome.shop)
          .join(",") || undefined,
    });

    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: failed > 0 ? "error" : "ok",
    });

    // A partial pass answers 500 so the scheduler's log agrees with Sentry that
    // this run was not clean. Every arm is idempotent, so a retry is safe.
    // A soft-deadline stop is *not* a failure and answers 200 with a count.
    return NextResponse.json(
      { runDate, shops: shops.length, stored, failed, skipped, outcomes },
      { status: failed > 0 ? 500 : 200 },
    );
  } catch (error) {
    // Only reachable before the loop or between shops -- `getDb()` failing, or
    // the shop listing itself. The check-in still has to be closed out.
    Sentry.captureException(error, { tags: { cron_scan: "platform_backup_bootstrap" } });
    log("cron_platform_backup.pass_failed", "error", { scan: "bootstrap" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "backup_unavailable" }, { status: 503 });
  } finally {
    // A pass's log line is the record of what was stored, so it is shipped
    // before the response rather than after it (ADR 20260806-cloudwatch-log-shipping).
    await flushLogs();
  }
}
