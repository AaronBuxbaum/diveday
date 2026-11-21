import { getDb } from "@/db/client";
import { retryPendingMediaDeletions } from "@/db/media-deletions";
import { drainNotificationRetries } from "@/db/notifications";
import { reapExpiredDemoShops } from "@/db/seed";
import { cleanupPrivatePersonPhotos } from "@/features/people/person-photo";
import { cronRoute } from "@/features/platform/cron-route";
import { sentry } from "@/features/platform/sentry-server";
import { retryPendingProcessorErasures } from "@/features/records/processor-erasure";
import { DAY_MS } from "@/lib/clock";
import { DAILY_TICK_CRONTAB } from "@/lib/cron-schedule";
import { log } from "@/lib/log";

/**
 * Six scans run one after another, several of which can send email/SMS through a
 * third-party provider one recipient at a time. The platform default is a
 * moving target set by the hosting plan, not by what this endpoint actually
 * needs, so state it here: 300s is Vercel Pro's default function ceiling, an
 * order of magnitude above the observed tick, and still a bound — a provider
 * that stops answering gets the whole request killed instead of silently
 * holding a function open, and the Sentry check-in below then never lands its
 * terminal status, so the monitor alerts. Raise this only alongside evidence
 * from `cron_reminders.scan_complete`, never to paper over a hanging call.
 */
export const maxDuration = 300;

/**
 * How long a minted demo shop may sit without a sign-in or staff input before
 * the reaper clears it. Defaults to 7 days (ADR 20260724-per-visitor-demo-shops); `DEMO_SHOP_TTL_DAYS` overrides it,
 * ignoring any non-positive or non-numeric value.
 */
function demoShopMaxAgeMs(): number | undefined {
  const days = Number(process.env.DEMO_SHOP_TTL_DAYS);
  return Number.isFinite(days) && days > 0 ? days * DAY_MS : undefined;
}

/**
 * One scan's outcome, kept deliberately coarse: either it ran and produced its
 * own summary counts, or it threw and there is nothing to count. Callers (the
 * response body and the summary log) must be able to tell those two apart —
 * "zero reminders sent" and "the reminder scan exploded" look identical
 * otherwise, and that ambiguity is exactly what hid a broken tick before.
 */
type ScanOutcome<T> = { status: "ok"; result: T } | { status: "error" };

/**
 * Runs one scan in isolation. Before this, the scans were bare sequential
 * awaits with no try/catch anywhere: the first throw aborted the request, so
 * every later scan silently never ran that day and the one summary log line
 * never fired either — a single bad row in the earliest scan could stop
 * reminders, recaps, media cleanup and demo reaping for as
 * long as nobody noticed. Each scan is independent and idempotent, so a
 * failure in one has no business starving the rest.
 *
 * The throw is reported to Sentry tagged with the scan name (so the issue is
 * attributable without opening the request body) and echoed as a structured
 * `error` line, which goes to `console.error` and therefore never disturbs the
 * single `console.log` summary line the tick is asserted on.
 */
async function runScan<T>(scan: string, run: () => Promise<T>): Promise<ScanOutcome<T>> {
  try {
    return { status: "ok", result: await run() };
  } catch (error) {
    await sentry.captureException(error, {
      tags: { cron_scan: scan },
    });
    log("cron_reminders.scan_failed", "error", { scan });
    return { status: "error" };
  }
}

/** The counts of a scan that ran, or `undefined` for one that threw. */
function resultOf<T>(outcome: ScanOutcome<T>): T | undefined {
  return outcome.status === "ok" ? outcome.result : undefined;
}

/**
 * The scheduled pre-trip-notification entry point. The app holds no timer by
 * design (docs ADR 20260721-scheduled-reminder-cadence); an external scheduler
 * (EventBridge, see config/crons.json) hits this daily and the scans do their
 * idempotent work. Post-trip recaps have their own hourly route: a daily pass
 * cannot keep the four-hour floor visible on Close-out meaningful.
 *
 * Fails closed: a `CRON_SECRET` must be configured and presented as a bearer
 * token. Without the secret set the endpoint is unavailable (503) rather than
 * open, so nothing can trigger sends in a deployment that forgot to set it.
 * The auth gate runs *before* the Sentry check-in on purpose — an unauthorized
 * probe must never be able to tell the monitor that the tick happened.
 *
 * The same daily tick also drives CR-012's bounded orphan-media cleanup: a
 * provider delete that failed or never resolved gets retried automatically
 * here, so a transient Blob outage doesn't require a human to notice the
 * reports-page reconciliation panel and click "Retry" by hand.
 *
 * It also reaps disposable demo shops past their TTL (ADR
 * 20260724-per-visitor-demo-shops): "Try the live demo" mints a fresh seeded
 * shop per visitor, and this daily pass deletes the expired ones so the database
 * doesn't grow without bound. The canonical blue-mantis demo is never reaped.
 *
 * Three layers of observability, each catching a failure the others can't:
 * per-scan Sentry issues (one scan broke), the `cron_reminders.scan_complete`
 * summary line plus an error check-in (this run was partial), and the Sentry
 * Cron Monitor check-in (the run never happened at all — a deleted cron entry,
 * a rotated `CRON_SECRET`, a platform outage). Only the third can fire when
 * the handler is never invoked, which is the failure no amount of in-handler
 * logging can ever report on its own.
 */
export const GET = cronRoute({
  id: "reminders",
  // Sentry's automatic Vercel-cron instrumentation does not reach App Router
  // route handlers under this repo's build (next.config.ts carries the full
  // verification), so the check-in is explicit. The monitor predates the
  // `diveday-<id>` shape and keeps its slug and `SENTRY_CRON_MONITOR_SLUG`.
  crontab: DAILY_TICK_CRONTAB,
  monitorSlug: "diveday-daily-tick",
  slugEnv: "SENTRY_CRON_MONITOR_SLUG",
  checkinMargin: 60,
  maxRuntime: 10,
  run: async () => {
    const db = await getDb();

    // Each scan is isolated: a throw in one is captured and the rest still run.
    const notificationRetries = await runScan("notificationRetries", () =>
      drainNotificationRetries(db),
    );
    // **Pre-trip reminders no longer run here.** They moved to their own hourly
    // pass, a scan of `/api/cron/shop-tick`: a fixed daily UTC hour is 10am in
    // Florida and 03:00 in Fiji, so a shop in the picker's Asia-Pacific group
    // texted its divers in the middle of the night, every day (issue #697). The
    // scans left are durable-retry drains whose backoff bounds derive from
    // this tick's cadence (`src/lib/cron-schedule.ts`, OPS-6), which is exactly
    // why the cadence here did not change.
    const mediaDeletions = await runScan("mediaDeletions", () => retryPendingMediaDeletions(db));
    const privatePhotos = await runScan("privatePhotos", () => cleanupPrivatePersonPhotos(db));
    // The same bounded-retry shape one processor over: a Stripe customer delete
    // that erasure could not land (an outage, a dropped connection) gets tried
    // again here rather than waiting for an owner to notice the reports panel
    // (ADR 20260803-processor-erasure-obligations). Invoice-snapshot obligations
    // are never touched by this — no API reaches them.
    const processorErasures = await runScan("processorErasures", () =>
      retryPendingProcessorErasures(db),
    );
    // Clear disposable demo shops past their TTL so per-visitor minting doesn't
    // grow the database without bound (ADR 20260724-per-visitor-demo-shops).
    const maxAgeMs = demoShopMaxAgeMs();
    const demoShops = await runScan("demoShops", () =>
      reapExpiredDemoShops(db, maxAgeMs ? { maxAgeMs } : {}),
    );

    const scans = {
      notificationRetries,
      mediaDeletions,
      privatePhotos,
      processorErasures,
      demoShops,
    };
    const failedScans = Object.entries(scans)
      .filter(([, outcome]) => outcome.status === "error")
      .map(([name]) => name);

    const notificationRetriesCounts = resultOf(notificationRetries);
    const mediaDeletionsCounts = resultOf(mediaDeletions);
    const processorErasuresCounts = resultOf(processorErasures);
    const demoShopsCounts = resultOf(demoShops);

    // The per-tick observability line: one entry per scan's own summary counts,
    // already computed above for the response body (docs product/
    // archive/specialist-optimization-audit-20260731.md §7). A scan that threw
    // contributes no counts at all — its absence, plus `failedScans`, is how a
    // reader tells "nothing was due" from "this never ran".
    // One entry per scan's own summary counts. A scan that threw contributes no
    // counts at all: its absence, plus `failedScans`, is how a reader tells
    // "nothing was due" from "this never ran".
    return {
      scansFailed: failedScans.length,
      failedScans: failedScans.length > 0 ? failedScans.join(",") : undefined,
      notificationRetriesScanned: notificationRetriesCounts?.scanned,
      notificationRetriesSent: notificationRetriesCounts?.sent,
      notificationRetriesFailed: notificationRetriesCounts?.failed,
      mediaDeletionsAttempted: mediaDeletionsCounts?.attempted,
      mediaDeletionsSucceeded: mediaDeletionsCounts?.succeeded,
      processorErasuresAttempted: processorErasuresCounts?.attempted,
      processorErasuresDischarged: processorErasuresCounts?.discharged,
      demoShopsDeleted: demoShopsCounts?.deleted,
    };
  },
  // Every scan is idempotent, so a scheduler retry re-runs the failed one
  // without duplicating anything the successful ones already did.
  healthy: (summary) => summary.scansFailed === 0,
});
