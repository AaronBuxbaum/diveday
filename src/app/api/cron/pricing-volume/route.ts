import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { PRICING_CLOSE_CRONTAB } from "@/lib/billing/pricing-plans";
import {
  billingProviderFromEnvironment,
  percentBillingFromEnvironment,
} from "@/lib/billing/stripe-billing";
import { nowDate } from "@/lib/clock";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";
import { pricingConfig } from "@/lib/pricing-flags";
import { closePercentMonths } from "./close-pass";

/** One statement and at most one Stripe call per percent-plan shop. */
export const maxDuration = 300;

const CRON_MONITOR_SLUG = "diveday-pricing-volume";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: PRICING_CLOSE_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * **The percent plan's monthly close** (ADR 20261022-pricing-ab-test): last
 * month's statement for each percent-plan shop, and its fee reported to
 * Stripe's meter (`closePercentMonths`). Idempotent, so the 3rd's run retries
 * what the 2nd could not report and changes nothing else.
 */
export async function GET(request: Request) {
  const refused = requireCronSecret(request);
  if (refused) return refused;

  const checkInId = await sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );
  try {
    const summary = await closePercentMonths(await getDb(), {
      now: nowDate(),
      config: pricingConfig(),
      provider: billingProviderFromEnvironment(),
      percent: percentBillingFromEnvironment(),
    });
    log("cron_pricing_volume.close_complete", "info", summary);
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    await sentry.captureException(error, { tags: { cron_scan: "pricing-volume" } });
    log("cron_pricing_volume.close_failed", "error", { scan: "pricing-volume" });
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
