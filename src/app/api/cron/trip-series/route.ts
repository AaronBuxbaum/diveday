import { getDb } from "@/db/client";
import { clearFinishedRehearsals } from "@/db/rehearsals";
import { clearPassedReopensOn } from "@/db/shops";
import { rollAllSeriesForward } from "@/db/trips";
import { rollSailedSeriesInterests } from "@/features/bookings/interest-roll";
import { voidStalePublicPackageInvoices } from "@/features/money/stale-package-invoices";
import { cronRoute } from "@/features/platform/cron-route";
import { sentry } from "@/features/platform/sentry-server";
import { nowDate } from "@/lib/clock";
import { errorClassToken } from "@/lib/error-token";
import { log } from "@/lib/log";
import { SERIES_HORIZON_DAYS } from "@/lib/recurrence";

/**
 * A pass is one bounded transaction per still-running series, and each writes
 * at most a handful of rows — a weekly series adds seven dates on the day it
 * crosses the horizon and nothing on the six days either side. 60s is far above
 * the observed tick and still kills a pass that has wedged. Raise it only with
 * evidence from `cron_trip_series.scan_complete`.
 */
export const maxDuration = 60;

/**
 * Run one step of the nightly pass so its failure costs the others nothing: a
 * throw is reported to Sentry under the step's name, the step is recorded in
 * `stepsFailed`, and the pass carries on with `fallback`. Every step is
 * idempotent, so tomorrow's pass tries again.
 */
async function isolated<T>(step: string, failed: string[], fallback: T, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    failed.push(step);
    await sentry.captureException(error, { tags: { cron_scan: `trip_series_${step}` } });
    // The CloudWatch CronPassFailures alarm reads this line, not Sentry.
    log("cron_trip_series.scan_failed", "error", { scan: step, errorName: errorClassToken(error) });
    return fallback;
  }
}

/**
 * Keep every open-ended series' next `SERIES_HORIZON_DAYS` on the board.
 *
 * This is what makes a recurring trip unlimited rather than a batch of dates
 * somebody has to re-schedule every season (ADR
 * 20260810-open-ended-recurring-trips). It creates the cadence dates that are
 * missing and nothing else: an instance staff edited, moved, or cancelled is
 * already spoken for, and one they deleted is held open by a skip row, so a
 * pass that runs twice in a night is a no-op the second time.
 *
 * Daily rather than weekly: the roll is cheap and idempotent, and a daily pass
 * means the board's far edge advances by a day at a time instead of arriving in
 * a lump.
 *
 * The five steps are isolated from each other (`isolated`): the roll, the
 * rehearsal sweep, the reopen-date sweep, the waitlist roll and the stale
 * invoice void. One failing is named in `stepsFailed`, flags the monitor, and
 * leaves the rest of the night's work done. `checkinMargin` is generous because
 * a roll a day or two late costs a shop nothing a diver can see.
 */
export const GET = cronRoute({
  id: "trip-series",
  monitorSlug: "diveday-trip-series-roll",
  crontab: "7 3 * * *",
  checkinMargin: 240,
  maxRuntime: 5,
  run: async () => {
    const db = await getDb();
    const failed: string[] = [];
    const none = {
      seriesConsidered: 0,
      seriesExtended: 0,
      tripsCreated: 0,
      failures: 0,
      deferred: 0,
      yardDatesLeftOff: 0,
    };
    const summary = await isolated("roll", failed, none, () => rollAllSeriesForward(db));
    // Finished rehearsals come off the board once fly-safe no longer reads
    // them (ADR 20261012-rehearsal-departures).
    const rehearsalsCleared = await isolated("rehearsals", failed, 0, () =>
      clearFinishedRehearsals(db),
    );
    // A "Back on the water" date that has passed comes off Settings; the
    // storefront had already stopped reading it.
    const reopensCleared = await isolated("reopens", failed, 0, () => clearPassedReopensOn(db));
    // Interests nobody invited on a series date that sailed roll onto the run's
    // next date (third UX review, item 12).
    const waitlist = await isolated("waitlist", failed, { rolled: 0, invited: 0 }, () =>
      rollSailedSeriesInterests(db),
    );
    // A dive package bought on the public pages and left unpaid past its
    // window is voided at Stripe and on the order (issue #2304).
    const staleInvoices = await isolated(
      "stale_package_invoices",
      failed,
      { considered: 0, voided: 0, refreshed: 0, failed: 0, unread: 0, stuck: 0 },
      () => voidStalePublicPackageInvoices(db, { now: nowDate() }),
    );
    // An invoice Stripe has refused to void night after night needs a person:
    // raised once, on the night it reaches the limit.
    if (staleInvoices.stuck > 0) {
      await sentry.captureMessage("a stale package invoice could not be voided", {
        level: "warning",
        tags: { stale_invoices_stuck: String(staleInvoices.stuck) },
      });
    }
    // A series that cannot be rolled will fail the same way every night until
    // somebody looks (every instance deleted, its course archived). A warning,
    // not an error: the shop's existing dates are all still on the board.
    if (summary.failures > 0) {
      await sentry.captureMessage("trip series could not be rolled forward", {
        level: "warning",
        tags: { series_failures: String(summary.failures) },
      });
    }
    return {
      horizonDays: SERIES_HORIZON_DAYS,
      seriesConsidered: summary.seriesConsidered,
      seriesExtended: summary.seriesExtended,
      tripsCreated: summary.tripsCreated,
      seriesFailed: summary.failures,
      // Never silently capped: a pass that hit `SERIES_SWEEP_LIMIT` says how
      // many runs it left for tomorrow.
      seriesDeferred: summary.deferred,
      // Dates a hull in the yard kept off the board (issue #3948): left off
      // rather than closed, so they read again nightly.
      yardDatesLeftOff: summary.yardDatesLeftOff,
      rehearsalsCleared,
      reopensCleared,
      waitlistRolled: waitlist.rolled,
      waitlistInvited: waitlist.invited,
      staleInvoicesVoided: staleInvoices.voided,
      staleInvoicesRefreshed: staleInvoices.refreshed,
      staleInvoicesFailed: staleInvoices.failed,
      staleInvoicesUnread: staleInvoices.unread,
      stepsFailed: failed.join(",") || undefined,
    };
  },
  healthy: (summary) => summary.seriesFailed === 0 && summary.stepsFailed === undefined,
});
