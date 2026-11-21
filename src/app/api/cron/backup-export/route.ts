import { getDb } from "@/db/client";
import { cronRoute } from "@/features/platform/cron-route";
import { sentry } from "@/features/platform/sentry-server";
import {
  backupPeriodKey,
  listShopsDueForBackup,
  runShopBackup,
} from "@/features/records/backup-export";
import { toDiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { publicAppUrl } from "@/lib/notifications/app-url";

/**
 * A pass is one bundle build and one PUT per due shop — bounded work, but a
 * photo-heavy shop's bundle is real megabytes and the upload crosses the open
 * internet to whatever bucket the shop configured. 300s matches the reminders
 * cron's ceiling; the per-upload timeout inside the feature module (120s) is
 * what actually keeps one wedged destination from eating the slot.
 */
export const maxDuration = 300;

/**
 * The weekly shop-owned backup pass (ADR 20260804-shop-owned-backup-export):
 * for every shop with a configured destination that this ISO week's scheduled
 * delivery has not yet reached, build the full export bundle (trips.ics riding
 * along) and PUT it to the shop's own bucket.
 *
 * Idempotent per shop per week — a re-invoked tick skips shops already
 * delivered or held by another live invocation, and each scheduled attempt has
 * its own object key so a late worker cannot replace a newer bundle. Failures
 * become recorded delivery rows the settings page shows; the pass
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
export const GET = cronRoute({
  id: "backup-export",
  // `checkinMargin` is generous because a weekly backup being hours late is not
  // an incident; `maxRuntime` sits above `maxDuration`.
  crontab: "7 4 * * 1",
  checkinMargin: 240,
  maxRuntime: 10,
  run: async (request) => {
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
        await sentry.captureMessage("backup export delivery failed", {
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
    return {
      periodKey,
      shopsDue: due.length,
      delivered,
      failed,
      failedShops:
        outcomes
          .filter((outcome) => outcome.status === "failed")
          .map((outcome) => outcome.shop)
          .join(",") || undefined,
      outcomes,
    };
  },
  healthy: (summary) => summary.failed === 0,
});
