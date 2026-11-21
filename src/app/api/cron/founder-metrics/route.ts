import { getDb } from "@/db/client";
import { listEmailBounces } from "@/features/messages/email-bounces";
import { cronRoute } from "@/features/platform/cron-route";
import {
  claimFounderDigest,
  departureRollCallEvents,
  listShopActivation,
  markStallsAlerted,
  releaseFounderDigest,
  syncShopMilestones,
} from "@/features/reports/founder-metrics";
import {
  countDemoEntriesBySource,
  countSetupRequestsBySource,
  countUnnotifiedSetupRequests,
} from "@/features/reports/funnel";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  activationStall,
  countDiveDays,
  currentWeek,
  isDigestDay,
  previousWeek,
  rankSources,
} from "@/lib/founder-metrics";
import { notify } from "@/lib/notifications";
import { founderDigestRecipient } from "@/lib/platform-mail";

/** A handful of grouped reads and, on Mondays, one mail. */
export const maxDuration = 60;

/**
 * **The founder's numbers, nightly** (ADR 20261007-founder-metrics).
 *
 * Every night: record each real shop's activation milestones that its own rows
 * now prove, and log the north star for the week so far to the drain
 * (`cron_founder_metrics.scan_complete`), so the series exists between digests.
 *
 * On Mondays, additionally: send the founder last week's digest — the north
 * star, demo entries and set-up requests by source, and every shop stalled
 * seven days or more between activation steps that has not been reported
 * before. The week is claimed before the send so two runs cannot both mail,
 * and given back when the mail did not leave so the next run retries; a stall
 * is marked reported only once the mail that reported it has left.
 *
 * Fails closed like every cron here: `CRON_SECRET` is required and presented
 * as a bearer token, checked before anything else, the Sentry check-in
 * included — through the shared constant-time check (`src/features/platform/cron-auth.ts`).
 */
export const GET = cronRoute({
  id: "founder-metrics",
  // 11:00 UTC: past midnight across the Americas and the Caribbean, so a Monday
  // run reads every shop's Sunday as finished, and clear of the other jobs.
  crontab: "7 11 * * *",
  checkinMargin: 240,
  maxRuntime: 5,
  run: async () => {
    const now = nowDate();
    const db = await getDb();
    await syncShopMilestones(db);

    const thisWeek = currentWeek(now);
    const today = calendarDateInTimezone(now, "UTC");
    const soFar = countDiveDays(
      await departureRollCallEvents(db, { from: thisWeek.startDate, to: today }),
    );
    const digest = isDigestDay(now) ? await sendDigest(now) : "not_today";
    return {
      weekStart: thisWeek.startDate,
      diveDays: soFar.diveDays,
      diveDayShops: soFar.shops,
      digest,
    };
  },
  healthy: (summary) => summary.digest !== "failed",
});

type DigestOutcome = "sent" | "already_sent" | "no_recipient" | "failed";

async function sendDigest(now: Date): Promise<DigestOutcome> {
  const to = founderDigestRecipient();
  if (!to) return "no_recipient";

  const db = await getDb();
  const week = previousWeek(now);
  if (!(await claimFounderDigest(db, week.startDate, now))) return "already_sent";

  try {
    const range = { startsAt: week.startsAt, endsAt: week.endsAt };
    const [events, demoEntries, setupRequests, unnotifiedSetupRequests, activation, bounces] =
      await Promise.all([
        departureRollCallEvents(db, { from: week.startDate, to: week.endDate }),
        countDemoEntriesBySource(db, range),
        countSetupRequestsBySource(db, range),
        countUnnotifiedSetupRequests(db, range),
        listShopActivation(db),
        listEmailBounces(db, range),
      ]);
    const northStar = countDiveDays(events);
    const stalls = activation.flatMap((shop) => {
      const stall = activationStall(shop.reached, now);
      if (!stall || shop.alerted.has(stall.lastReached)) return [];
      return [{ shop, stall }];
    });

    const delivery = await notify({
      kind: "operator_alert",
      event: "founder_digest",
      to,
      weekStart: week.startDate,
      weekEnd: week.endDate,
      diveDays: northStar.diveDays,
      diveDayShops: northStar.shops,
      demoEntries: rankSources(demoEntries),
      setupRequests: rankSources(setupRequests),
      unnotifiedSetupRequests,
      stalls: stalls.map(({ shop, stall }) => ({
        shopName: shop.shopName,
        shopSlug: shop.shopSlug,
        lastReached: stall.lastReached,
        since: calendarDateInTimezone(stall.since, "UTC"),
        waitingFor: stall.waitingFor,
      })),
      bounces,
    });
    if (delivery.status !== "sent") {
      await releaseFounderDigest(db, week.startDate);
      return "failed";
    }

    await markStallsAlerted(
      db,
      stalls.map(({ shop, stall }) => ({ shopId: shop.shopId, milestone: stall.lastReached })),
      now,
    );
    return "sent";
  } catch (error) {
    await releaseFounderDigest(db, week.startDate);
    throw error;
  }
}
