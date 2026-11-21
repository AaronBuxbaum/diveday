import { getDb } from "@/db/client";
import { claudeSpendUsdBetween } from "@/features/ai/assists";
import { cronRoute } from "@/features/platform/cron-route";
import { sentry } from "@/features/platform/sentry-server";
import { collectUsageSamples } from "@/features/platform/usage";
import { claimUsageAlert, releaseUsageAlert } from "@/features/platform/usage-alert-ledger";
import { nowDate } from "@/lib/clock";
import {
  type CeilingEvaluation,
  ceilingAlertKey,
  ceilingPercent,
  evaluateCeilings,
  isAlertingLevel,
  periodBounds,
} from "@/lib/cost-guardrails";
import { notify } from "@/lib/notifications";
import { alertRecipient } from "@/lib/platform-mail";

/**
 * Four HTTP reads against two vendors' usage APIs and one sum over `claude_usage`, each already bounded by its
 * own `PROBE_TIMEOUT_MS`, plus at most a handful of SES sends. 60s is far above
 * the observed tick and still a bound: a provider that stops answering gets the
 * whole request killed rather than holding a function slot open, and the Sentry
 * check-in below then never lands its terminal status, so the monitor alerts.
 * Raise it only with evidence from `cron_usage.scan_complete`.
 */
export const maxDuration = 60;

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
export const GET = cronRoute({
  id: "usage",
  monitorSlug: "diveday-usage-guardrails",
  crontab: "7 9 * * *",
  // A cost reading arriving a few hours late is not an incident; `maxRuntime`
  // sits above `maxDuration`, so a killed run reads as timed-out.
  checkinMargin: 240,
  maxRuntime: 5,
  run: async () => {
    const now = nowDate();
    const db = await getDb();
    const samples = await collectUsageSamples({
      now,
      readAnthropicSpendUsd: (start, end) => claudeSpendUsdBetween(db, start, end),
    });
    const evaluations = evaluateCeilings(samples, now);

    let alertsSent = 0;
    let alertsSuppressed = 0;
    let alertsFailed = 0;

    for (const evaluation of evaluations) {
      // A probe that broke while holding a credential is its own signal: we are
      // blind on this ceiling, and nothing else in the system would say so.
      // Not an email — a blind probe is an engineering problem, and Sentry is
      // where DiveDay's engineering problems already land.
      if (evaluation.level === "unavailable") {
        await sentry.captureMessage("usage probe unavailable", {
          level: "warning",
          tags: { ...ceilingTags(evaluation), usage_reason: evaluation.reason ?? "unknown" },
        });
        continue;
      }
      if (!isAlertingLevel(evaluation.level)) continue;

      const percent = ceilingPercent(evaluation.fraction) ?? 0;
      await sentry.captureMessage("usage ceiling reached", {
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
        await sentry.captureException(error, {
          tags: { ...ceilingTags(evaluation), usage_step: "claim" },
        });
      }
      if (!claimed) {
        alertsSuppressed += 1;
        continue;
      }

      const delivery = await notify({
        kind: "operator_alert",
        event: "usage_ceiling",
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
      await sentry.captureMessage("usage alert not delivered", {
        level: "error",
        tags: { ...ceilingTags(evaluation), usage_delivery: delivery.status },
      });
      try {
        await releaseUsageAlert(db, key);
      } catch (error) {
        await sentry.captureException(error, {
          tags: { ...ceilingTags(evaluation), usage_step: "release" },
        });
      }
    }

    // Every ceiling's verdict, as flat fields (ids, codes and numbers about an
    // invoice, which is all this pass ever knows; LogContext's rule) plus the
    // evaluations themselves. The helper logs this as `cron_usage.scan_complete`.
    return {
      period: evaluations[0]?.periodKey,
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
      evaluations,
    };
  },
  // An undelivered alert flags the monitor; the claim has been released, so a
  // retry re-sends rather than double-sending.
  healthy: (summary) => summary.alertsFailed === 0,
});
