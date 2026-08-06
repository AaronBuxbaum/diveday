import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { nowDate } from "@/lib/clock";
import {
  type CeilingEvaluation,
  ceilingAlertKey,
  ceilingPercent,
  evaluateCeilings,
  isAlertingLevel,
  periodBounds,
} from "@/lib/cost-guardrails";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { alertRecipient } from "@/lib/platform-mail";
import { claimUsageAlert, releaseUsageAlert } from "@/lib/usage/alert-ledger";
import { collectUsageSamples } from "@/lib/usage/collect";

/**
 * Four HTTP reads against two vendors' usage APIs, each already bounded by its
 * own `PROBE_TIMEOUT_MS`, plus at most a handful of SES sends. 60s is far above
 * the observed tick and still a bound: a provider that stops answering gets the
 * whole request killed rather than holding a function slot open, and the Sentry
 * check-in below then never lands its terminal status, so the monitor alerts.
 * Raise it only with evidence from `cron_usage.scan_complete`.
 */
export const maxDuration = 60;

/**
 * Sentry Cron Monitor identity for the usage poll. Its own monitor, separate
 * from the daily reminders tick and the weekly prune: a cost monitor that
 * silently stopped running is its own incident with its own urgency, and
 * folding it into another slug would hide exactly the failure this endpoint
 * exists to prevent — nobody watching, and nothing saying so.
 * `SENTRY_USAGE_CRON_MONITOR_SLUG` points at a per-environment monitor without
 * a deploy, matching the other two routes.
 */
const CRON_MONITOR_SLUG = process.env.SENTRY_USAGE_CRON_MONITOR_SLUG || "diveday-usage-guardrails";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json — Sentry uses it
 * to decide when a check-in is *missing*, which is the dead-man's switch on the
 * whole guardrail.
 *
 * 09:00 UTC, deliberately away from the other three entries (reminders at
 * 14:00, retention Sundays at 03:30, backup Mondays at 04:00): nothing here
 * needs to race them, and a spread schedule keeps one slow provider from
 * pushing another job's start time around. `checkinMargin` is generous because
 * a cost reading arriving a few hours late is not an incident; `maxRuntime`
 * sits above `maxDuration` so a run the platform killed reads as timed-out
 * rather than as still running.
 */
const CRON_SCHEDULE = "0 9 * * *";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: CRON_SCHEDULE },
  checkinMargin: 240,
  maxRuntime: 5,
  timezone: "Etc/UTC",
} as const;

/** Tags carried on every Sentry signal from this route, so one query finds them all. */
function ceilingTags(evaluation: CeilingEvaluation) {
  return {
    usage_ceiling: evaluation.ceilingId,
    usage_provider: evaluation.provider,
    usage_level: evaluation.level,
    usage_period: evaluation.periodKey,
  };
}

/**
 * Poll every provider usage ceiling and alert on the ones being approached
 * (OPS-9, docs ADR 20260806-provider-usage-guardrails).
 *
 * **Alert-only, always.** Nothing in this path disables, throttles, or degrades
 * anything, and it never will — the posture is inherited from ADR
 * 20260802-aws-cost-guardrails, whose reasoning is that a false-positive
 * shutoff is a far worse failure than a surprise bill. This endpoint reads
 * numbers and sends email.
 *
 * Fails closed exactly like `/api/cron/retention` and `/api/cron/reminders`:
 * `CRON_SECRET` must be configured and presented as a bearer token, or the
 * endpoint answers 503 (unconfigured) / 401 (wrong or missing token) and reads
 * nothing. The auth gate runs *before* the Sentry check-in so an unauthorized
 * probe can never tell the monitor the poll happened.
 *
 * Reports three ways, for the same reason the prune does: the response body
 * carries every ceiling's verdict, `cron_usage.scan_complete` carries the same
 * to the log drain, and the Sentry check-in catches the case no in-handler
 * logging can — the run never happening at all.
 *
 * **A ceiling nobody could measure never reads as `ok`.** `not_configured`,
 * `unavailable`, and `unobservable` survive intact into all three of those
 * outputs. That is the entire safety property: a monitor reporting "fine"
 * because it could not look is worse than no monitor.
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
    const now = nowDate();
    const samples = await collectUsageSamples({ now });
    const evaluations = evaluateCeilings(samples, now);
    const db = await getDb();

    let alertsSent = 0;
    let alertsSuppressed = 0;
    let alertsFailed = 0;

    for (const evaluation of evaluations) {
      // A probe that broke while holding a credential is its own signal: we are
      // blind on this ceiling, and nothing else in the system would say so.
      // Not an email — a blind probe is an engineering problem, and Sentry is
      // where DiveDay's engineering problems already land.
      if (evaluation.level === "unavailable") {
        Sentry.captureMessage("usage probe unavailable", {
          level: "warning",
          tags: { ...ceilingTags(evaluation), usage_reason: evaluation.reason ?? "unknown" },
        });
        continue;
      }
      if (!isAlertingLevel(evaluation.level)) continue;

      const percent = ceilingPercent(evaluation.fraction) ?? 0;
      Sentry.captureMessage("usage ceiling reached", {
        level: evaluation.level === "over" ? "error" : "warning",
        tags: ceilingTags(evaluation),
        extra: { percent, value: evaluation.value, ceiling: evaluation.ceiling },
      });

      const key = ceilingAlertKey(evaluation, evaluation.level);
      const { end } = periodBounds(evaluation.period, now);

      // Claim before sending, so two overlapping runs cannot both mail. A
      // claim that cannot be taken at all is treated as "send anyway": a cost
      // alert seen twice costs a duplicate email, a cost alert never seen costs
      // money, and the two are not close.
      let claimed = true;
      try {
        claimed = await claimUsageAlert(db, key, end, now);
      } catch (error) {
        Sentry.captureException(error, {
          tags: { ...ceilingTags(evaluation), usage_step: "claim" },
        });
      }
      if (!claimed) {
        alertsSuppressed += 1;
        continue;
      }

      const delivery = await notify({
        kind: "usage_ceiling_alert",
        to: alertRecipient(),
        ceilingId: evaluation.ceilingId,
        provider: evaluation.provider,
        metric: evaluation.metric,
        unit: evaluation.unit,
        level: evaluation.level,
        periodKey: evaluation.periodKey,
        value: evaluation.value ?? 0,
        ceiling: evaluation.ceiling,
        percent,
        overflow: evaluation.overflow,
      });

      if (delivery.status === "sent") {
        alertsSent += 1;
        continue;
      }

      // Nothing was delivered, so the period's alert must not stay spent —
      // release the claim and let tomorrow's pass try again.
      alertsFailed += 1;
      Sentry.captureMessage("usage alert not delivered", {
        level: "error",
        tags: { ...ceilingTags(evaluation), usage_delivery: delivery.status },
      });
      try {
        await releaseUsageAlert(db, key);
      } catch (error) {
        Sentry.captureException(error, {
          tags: { ...ceilingTags(evaluation), usage_step: "release" },
        });
      }
    }

    // One line per run naming every ceiling and its verdict — ids, codes, and
    // numbers about an invoice, which is all this pass ever knows (LogContext's
    // rule). Nothing here is about a person.
    log("cron_usage.scan_complete", "info", {
      ceilings: evaluations.length,
      alertsSent,
      alertsSuppressed,
      alertsFailed,
      blind: evaluations.filter((evaluation) => evaluation.level === "unavailable").length,
      unmeasured: evaluations.filter(
        (evaluation) =>
          evaluation.level === "not_configured" || evaluation.level === "unobservable",
      ).length,
      ...Object.fromEntries(
        evaluations.map((evaluation) => [`${evaluation.ceilingId}_level`, evaluation.level]),
      ),
      ...Object.fromEntries(
        evaluations
          .filter((evaluation) => evaluation.fraction !== null)
          .map((evaluation) => [
            `${evaluation.ceilingId}_percent`,
            ceilingPercent(evaluation.fraction) ?? 0,
          ]),
      ),
    });

    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: alertsFailed > 0 ? "error" : "ok",
    });

    // An undelivered alert answers 500 so the scheduler's invocation log agrees
    // with Sentry that this run was not clean. The claim has been released, so
    // a retry re-sends rather than double-sending.
    return NextResponse.json(
      {
        period: evaluations[0]?.periodKey,
        alertsSent,
        alertsSuppressed,
        alertsFailed,
        evaluations,
      },
      { status: alertsFailed > 0 ? 500 : 200 },
    );
  } catch (error) {
    // Only reachable before or around the loop — `getDb()` failing to connect,
    // or an unexpected throw the per-probe guards did not cover. The check-in
    // still has to be closed out or the monitor would read this as a run that
    // is somehow still in progress.
    Sentry.captureException(error, { tags: { cron_scan: "usage_bootstrap" } });
    log("cron_usage.scan_failed", "error", { scan: "bootstrap" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "usage_unavailable" }, { status: 503 });
  }
}
