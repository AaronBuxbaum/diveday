import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { backupPeriodKey, listShopsDueForBackup, runShopBackup } from "@/features/backup-export";
import { toDiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { publicAppUrl } from "@/lib/notifications/app-url";

/**
 * A pass is one bundle build and one PUT per due shop — bounded work, but a
 * photo-heavy shop's bundle is real megabytes and the upload crosses the open
 * internet to whatever bucket the shop configured. 300s matches the reminders
 * cron's ceiling; the per-upload timeout inside the feature module (120s) is
 * what actually keeps one wedged destination from eating the slot.
 */
export const maxDuration = 300;

/** Separate Sentry monitor from the other crons — a missed backup pass is its own incident. */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_BACKUP_EXPORT_CRON_MONITOR_SLUG || "diveday-backup-export";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json. `checkinMargin`
 * is generous because a weekly backup being hours late is not an incident;
 * `maxRuntime` sits above `maxDuration` so a platform-killed run reads as
 * timed-out rather than still running.
 */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "0 4 * * 1" },
  checkinMargin: 240,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * The weekly shop-owned backup pass (ADR 20260804-shop-owned-backup-export):
 * for every shop with a configured destination that this ISO week's scheduled
 * delivery has not yet reached, build the full export bundle (trips.ics riding
 * along) and PUT it to the shop's own bucket.
 *
 * Idempotent per shop per week — a re-invoked tick skips shops already
 * delivered, and a retried shop overwrites its own deterministic object key.
 * Failures become recorded delivery rows the settings page shows; the pass
 * never retries a shop inside one tick, so a misconfigured bucket costs one
 * failed row per week, never a storm. One shop's failure never blocks the
 * next shop's backup.
 *
 * Fails closed exactly like `/api/cron/retention`: `CRON_SECRET` must be
 * configured and presented as a bearer token, or the endpoint answers 503
 * (unconfigured) / 401 (wrong or missing token) and uploads nothing. The auth
 * gate runs *before* the Sentry check-in so an unauthorized probe can never
 * tell the monitor the backup happened.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );

  try {
    const db = await getDb();
    const now = nowDate();
    const periodKey = backupPeriodKey(now);
    // Event links inside trips.ics come from server configuration, never a
    // request header (see src/lib/notifications/app-url.ts); the request's own
    // origin is only the local-dev fallback.
    const origin = publicAppUrl() ?? new URL(request.url).origin;

    const due = await listShopsDueForBackup(db, periodKey);
    const outcomes: { shop: string; status: string; errorCode?: string }[] = [];
    let delivered = 0;
    let failed = 0;

    for (const entry of due) {
      // The feed speaks each shop's own language, same as the subscription
      // feed: the "reader" of a backup is that shop's staff, not the cron.
      const t = staffTranslator(toDiverLocale(entry.shopLocale));
      const result = await runShopBackup(db, {
        shopId: entry.destination.shopId,
        trigger: "scheduled",
        origin,
        now,
        icsLabels: {
          calendarName: t("feed.shopTripsName", { shop: entry.shopSlug }),
          crew: t("feed.crew"),
          course: t("feed.course"),
          day: (dayNumber) => t("feed.day", { number: dayNumber }),
        },
      });
      if (result.status === "delivered") delivered += 1;
      if (result.status === "failed") {
        failed += 1;
        Sentry.captureMessage("backup export delivery failed", {
          level: "error",
          tags: { backup_shop: entry.shopSlug, backup_error: result.errorCode },
        });
      }
      outcomes.push({
        shop: entry.shopSlug,
        status: result.status,
        ...(result.status === "failed" ? { errorCode: result.errorCode } : {}),
      });
    }

    // One line per run — ids and codes only (LogContext's rule).
    log("cron_backup_export.pass_complete", "info", {
      periodKey,
      shopsDue: due.length,
      delivered,
      failed,
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

    // A partial pass answers 500 so the scheduler's invocation log agrees with
    // Sentry that this run was not clean. Every arm is idempotent — a retry
    // re-runs only the shops still due.
    return NextResponse.json(
      { periodKey, shopsDue: due.length, delivered, failed, outcomes },
      { status: failed > 0 ? 500 : 200 },
    );
  } catch (error) {
    // Only reachable before the loop or between shops — `getDb()` failing, or
    // the due-list query itself. The check-in still has to be closed out.
    Sentry.captureException(error, { tags: { cron_scan: "backup_export_bootstrap" } });
    log("cron_backup_export.pass_failed", "error", { scan: "bootstrap" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "backup_unavailable" }, { status: 503 });
  }
}
