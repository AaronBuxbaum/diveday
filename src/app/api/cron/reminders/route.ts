import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { sendDueCheckoutRecoveries } from "@/db/checkout-recovery";
import { getDb } from "@/db/client";
import { retryPendingMediaDeletions } from "@/db/media-deletions";
import { drainNotificationRetries } from "@/db/notifications";
import { retryPendingProcessorErasures } from "@/db/processor-erasure";
import { sendDueReminders } from "@/db/reminders";
import { reapExpiredDemoShops } from "@/db/seed";
import { DAY_MS } from "@/lib/clock";
import { DAILY_TICK_CRONTAB } from "@/lib/cron-schedule";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";

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
 * Sentry Cron Monitor identity for the daily tick. The check-in is made
 * explicitly from this handler (see below) rather than by Sentry's automatic
 * Vercel-cron instrumentation, which does not reach App Router route handlers
 * under this repo's build — next.config.ts carries the full verification.
 *
 * `SENTRY_CRON_MONITOR_SLUG` lets an operator point at a differently-named
 * monitor (e.g. one per environment) without a deploy; the default is what a
 * fresh Sentry project gets on the first check-in, since Sentry upserts the
 * monitor from the config sent with the `in_progress` check-in.
 */
const CRON_MONITOR_SLUG = process.env.SENTRY_CRON_MONITOR_SLUG || "diveday-daily-tick";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json — Sentry uses it
 * to decide when a check-in is *missing*, which is the whole point of the
 * dead-man's switch. `checkinMargin` (minutes) is how late the tick may be
 * before Sentry calls it missed; `maxRuntime` (minutes) sits above
 * `maxDuration` above, so a run killed by the platform reads as timed-out
 * rather than as still running forever.
 *
 * "Must stay in lockstep" used to be this comment and nothing else. The
 * schedule now comes from `@/lib/cron-schedule`, whose own test reads
 * vercel.json and fails if the two disagree — the same constant the retry
 * bounds in `src/db/notifications.ts` derive from, so a cadence change moves
 * the dead-man's switch and the retry window together instead of leaving one
 * of them describing a schedule that no longer runs (OPS-6).
 */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: DAILY_TICK_CRONTAB },
  checkinMargin: 60,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * How long a minted demo shop lives before the reaper clears it. Defaults to 7
 * days (ADR 20260724-per-visitor-demo-shops); `DEMO_SHOP_TTL_DAYS` overrides it,
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
 * reminders, recaps, checkout recovery, media cleanup and demo reaping for as
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
    Sentry.captureException(error, { tags: { cron_scan: scan } });
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
 * (Vercel Cron, see vercel.json) hits this daily and the scans do their
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
 * And it sends abandoned-checkout recovery emails (ADR
 * 20260726-abandoned-checkout-recovery): on this daily cadence a recovery
 * fires at least `RECOVERY_DELAY_HOURS` after abandonment, same-day or the
 * next tick depending on cron alignment — looser than the ~2-hour timing a
 * finer-grained scheduler could offer, but never duplicated (dedup is a
 * durable row) and never sent for a session that already paid or expired
 * (each candidate is reconciled against Stripe first).
 *
 * Three layers of observability, each catching a failure the others can't:
 * per-scan Sentry issues (one scan broke), the `cron_reminders.scan_complete`
 * summary line plus a non-200 status (this run was partial), and the Sentry
 * Cron Monitor check-in (the run never happened at all — a deleted cron entry,
 * a rotated `CRON_SECRET`, a platform outage). Only the third can fire when
 * the handler is never invoked, which is the failure no amount of in-handler
 * logging can ever report on its own.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  // Dead-man's switch, half one: tell Sentry the tick started. Sentry upserts
  // the monitor from `CRON_MONITOR_CONFIG` on this call, so there is nothing to
  // create by hand — but if a check-in never arrives within `checkinMargin` of
  // the schedule, Sentry raises a missed-check-in alert. That is the only
  // signal that survives the endpoint never being called.
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );

  try {
    const db = await getDb();

    // Each scan is isolated: a throw in one is captured and the rest still run.
    const notificationRetries = await runScan("notificationRetries", () =>
      drainNotificationRetries(db),
    );
    const reminders = await runScan("reminders", () => sendDueReminders(db));
    const checkoutRecoveries = await runScan("checkoutRecoveries", () =>
      sendDueCheckoutRecoveries(db),
    );
    const mediaDeletions = await runScan("mediaDeletions", () => retryPendingMediaDeletions(db));
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
      reminders,
      checkoutRecoveries,
      mediaDeletions,
      processorErasures,
      demoShops,
    };
    const failedScans = Object.entries(scans)
      .filter(([, outcome]) => outcome.status === "error")
      .map(([name]) => name);

    const notificationRetriesCounts = resultOf(notificationRetries);
    const remindersCounts = resultOf(reminders);
    const checkoutRecoveriesCounts = resultOf(checkoutRecoveries);
    const mediaDeletionsCounts = resultOf(mediaDeletions);
    const processorErasuresCounts = resultOf(processorErasures);
    const demoShopsCounts = resultOf(demoShops);

    // The per-tick observability line: one entry per scan's own summary counts,
    // already computed above for the response body (docs product/
    // archive/specialist-optimization-audit-20260731.md §7). A scan that threw
    // contributes no counts at all — its absence, plus `failedScans`, is how a
    // reader tells "nothing was due" from "this never ran".
    log("cron_reminders.scan_complete", "info", {
      scansFailed: failedScans.length,
      failedScans: failedScans.length > 0 ? failedScans.join(",") : undefined,
      notificationRetriesScanned: notificationRetriesCounts?.scanned,
      notificationRetriesSent: notificationRetriesCounts?.sent,
      notificationRetriesFailed: notificationRetriesCounts?.failed,
      remindersScanned: remindersCounts?.scanned,
      remindersSent: remindersCounts?.sent,
      remindersFailed: remindersCounts?.failed,
      checkoutRecoveriesScanned: checkoutRecoveriesCounts?.scanned,
      checkoutRecoveriesSent: checkoutRecoveriesCounts?.sent,
      mediaDeletionsAttempted: mediaDeletionsCounts?.attempted,
      mediaDeletionsSucceeded: mediaDeletionsCounts?.succeeded,
      processorErasuresAttempted: processorErasuresCounts?.attempted,
      processorErasuresDischarged: processorErasuresCounts?.discharged,
      demoShopsDeleted: demoShopsCounts?.deleted,
    });

    // Dead-man's switch, half two.
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: failedScans.length > 0 ? "error" : "ok",
    });

    // A partial tick answers 500 so the scheduler's own invocation log and any
    // uptime check agree with Sentry that this run was not clean. Every scan is
    // idempotent, so a scheduler retry re-runs the failed one without
    // duplicating anything the successful ones already did.
    return NextResponse.json(scans, { status: failedScans.length > 0 ? 500 : 200 });
  } catch (error) {
    // Only reachable before any scan starts — `getDb()` failing to connect or
    // migrate. Nothing ran, so there are no counts to report; the check-in
    // still has to be closed out or the monitor would read this as a run that
    // is somehow still in progress.
    Sentry.captureException(error, { tags: { cron_scan: "bootstrap" } });
    log("cron_reminders.tick_failed", "error", { scan: "bootstrap" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    // See the identical block in the retention cron: a tick's log line is the
    // record of the pass, so it is shipped before the response rather than
    // after it (ADR 20260806-cloudwatch-log-shipping).
    await flushLogs();
  }
}
