import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  backupRunDate,
  claimPlatformBackupShop,
  finishPlatformBackupShop,
  listShopsForPlatformBackup,
  platformBackupConfigFromEnvironment,
  runPlatformBackup,
  storePlatformBackupCensus,
} from "@/features/backup-export";
import { toDiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";

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
 * A pass that stops early reports its skips. The durable attempt order puts
 * shops it did not reach ahead of shops it already attempted next time.
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
  schedule: { type: "crontab", value: "7 5 * * 1" },
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
 *    objects additively. Every invocation attempts all shops it can admit; the
 *    database checkpoint only rotates admission order.
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
  const refusal = requireCronSecret(request);
  if (refusal) return refusal;

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

  const checkInId = await sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );

  try {
    const db = await getDb();
    const now = nowDate();
    const runDate = backupRunDate(now);
    const startedAt = performance.now();
    // Event links inside trips.ics come from server configuration, never a
    // request header (src/lib/notifications/app-url.ts).
    const origin = publicAppUrl() ?? new URL(request.url).origin;

    const shops = await listShopsForPlatformBackup(db);
    const outcomes: { shop: string; status: string; errorCode?: string }[] = [];
    let stored = 0;
    let failed = 0;
    let skipped = 0;

    for (const shop of shops) {
      if (performance.now() - startedAt >= SOFT_DEADLINE_MS) {
        skipped += 1;
        outcomes.push({ shop: shop.slug, status: "skipped" });
        continue;
      }
      const claimToken = crypto.randomUUID();
      const claimed = await claimPlatformBackupShop(db, {
        shopId: shop.id,
        token: claimToken,
        now: nowDate(),
      });
      if (!claimed) {
        skipped += 1;
        outcomes.push({ shop: shop.slug, status: "skipped" });
        continue;
      }
      if (performance.now() - startedAt >= SOFT_DEADLINE_MS) {
        await finishPlatformBackupShop(db, {
          shopId: shop.id,
          token: claimToken,
          succeeded: false,
          now: nowDate(),
        });
        skipped += 1;
        outcomes.push({ shop: shop.slug, status: "skipped" });
        continue;
      }
      const t = staffTranslator(toDiverLocale(shop.locale));
      let result: Awaited<ReturnType<typeof runPlatformBackup>>;
      try {
        result = await runPlatformBackup(db, {
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
      } catch (error) {
        await finishPlatformBackupShop(db, {
          shopId: shop.id,
          token: claimToken,
          succeeded: false,
          now: nowDate(),
        });
        throw error;
      }
      await finishPlatformBackupShop(db, {
        shopId: shop.id,
        token: claimToken,
        succeeded: result.status === "stored",
        now: nowDate(),
      });
      if (result.status === "stored") stored += 1;
      if (result.status === "failed") {
        failed += 1;
        await sentry.captureMessage("platform backup failed for a shop", {
          level: "error",
          tags: { backup_shop: shop.slug, backup_error: result.errorCode },
        });
        outcomes.push({ shop: shop.slug, status: result.status, errorCode: result.errorCode });
        continue;
      }
      outcomes.push({ shop: shop.slug, status: result.status });
    }

    // The run's census, filed beside its bundles so the AWS-side watchdog can
    // tell a complete invocation from a truncated one. The progress checkpoint
    // changes future admission order; it does not turn a partial invocation
    // into a complete census or promise all shops finish within one period.
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

    await sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: failed > 0 || skipped > 0 ? "error" : "ok",
    });

    // A partial pass answers 500 so the scheduler's log agrees with Sentry that
    // this run was not clean. Every arm is idempotent, so a retry is safe.
    // A skipped shop leaves this invocation incomplete, even though its
    // checkpoint ensures it gets admission priority on the next invocation.
    return NextResponse.json(
      { runDate, shops: shops.length, stored, failed, skipped, outcomes },
      { status: failed > 0 || skipped > 0 ? 500 : 200 },
    );
  } catch (error) {
    // Only reachable before the loop or between shops -- `getDb()` failing, or
    // the shop listing itself. The check-in still has to be closed out.
    await sentry.captureException(error, { tags: { cron_scan: "platform_backup_bootstrap" } });
    log("cron_platform_backup.pass_failed", "error", { scan: "bootstrap" });
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "backup_unavailable" }, { status: 503 });
  } finally {
    // A pass's log line is the record of what was stored, so it is shipped
    // before the response rather than after it (ADR 20260806-cloudwatch-log-shipping).
    await flushLogs();
  }
}
