import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  claimFounderDigest,
  departureRollCallEvents,
  listShopActivation,
  markStallsAlerted,
  releaseFounderDigest,
  syncShopMilestones,
} from "@/db/founder-metrics";
import {
  countDemoEntriesBySource,
  countSetupRequestsBySource,
  countUnnotifiedSetupRequests,
} from "@/db/funnel";
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
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { flushLogs } from "@/lib/observability";
import { founderDigestRecipient } from "@/lib/platform-mail";

/** A handful of grouped reads and, on Mondays, one mail. */
export const maxDuration = 60;

/**
 * Its own Sentry Cron Monitor: the founder's numbers going quiet is its own
 * failure, and folded into another job's slug nobody would see it.
 */
const CRON_MONITOR_SLUG = "diveday-founder-metrics";

/**
 * Must match this route's `crons` entry in vercel.json (the route test holds
 * them together): Sentry decides a check-in is missing from it.
 *
 * 11:00 UTC: past midnight across the Americas and the Caribbean, so a Monday
 * run reads every shop's Sunday as finished, and clear of the other jobs.
 */
const CRON_SCHEDULE = "0 11 * * *";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: CRON_SCHEDULE },
  checkinMargin: 240,
  maxRuntime: 5,
  timezone: "Etc/UTC",
} as const;

/**
 * **The founder's numbers, nightly** (ADR 20261007-founder-metrics).
 *
 * Every night: record each real shop's activation milestones that its own rows
 * now prove, and log the north star for the week so far to the drain
 * (`cron_founder_metrics.computed`), so the series exists between digests.
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
 * included.
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
    const db = await getDb();
    await syncShopMilestones(db);

    const thisWeek = currentWeek(now);
    const today = calendarDateInTimezone(now, "UTC");
    const soFar = countDiveDays(
      await departureRollCallEvents(db, { from: thisWeek.startDate, to: today }),
    );
    log("cron_founder_metrics.computed", "info", {
      weekStart: thisWeek.startDate,
      diveDays: soFar.diveDays,
      diveDayShops: soFar.shops,
    });

    const digest = isDigestDay(now) ? await sendDigest(now) : "not_today";
    log("cron_founder_metrics.digest", digest === "failed" ? "error" : "info", { digest });

    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: digest === "failed" ? "error" : "ok",
    });
    return NextResponse.json(
      { weekStart: thisWeek.startDate, diveDays: soFar.diveDays, digest },
      { status: digest === "failed" ? 500 : 200 },
    );
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "founder_metrics" } });
    log("cron_founder_metrics.failed", "error", {});
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "founder_metrics_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}

type DigestOutcome = "sent" | "already_sent" | "no_recipient" | "failed";

async function sendDigest(now: Date): Promise<DigestOutcome> {
  const to = founderDigestRecipient();
  if (!to) return "no_recipient";

  const db = await getDb();
  const week = previousWeek(now);
  if (!(await claimFounderDigest(db, week.startDate, now))) return "already_sent";

  try {
    const range = { startsAt: week.startsAt, endsAt: week.endsAt };
    const [events, demoEntries, setupRequests, unnotifiedSetupRequests, activation] =
      await Promise.all([
        departureRollCallEvents(db, { from: week.startDate, to: week.endDate }),
        countDemoEntriesBySource(db, range),
        countSetupRequestsBySource(db, range),
        countUnnotifiedSetupRequests(db, range),
        listShopActivation(db),
      ]);
    const northStar = countDiveDays(events);
    const stalls = activation.flatMap((shop) => {
      const stall = activationStall(shop.reached, now);
      if (!stall || shop.alerted.has(stall.lastReached)) return [];
      return [{ shop, stall }];
    });

    const delivery = await notify({
      kind: "founder_digest",
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
