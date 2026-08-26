import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { dispatchDueIntegrationDeliveries } from "@/features/integrations";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";

export const maxDuration = 300;
export const INTEGRATIONS_CRON_CRONTAB = "*/10 * * * *";

/** Drain the provider-neutral integration outbox. The bearer gate runs first. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }
  try {
    const summary = await dispatchDueIntegrationDeliveries(await getDb(), { limit: 50 });
    log("cron_integrations.scan_complete", "info", summary);
    return NextResponse.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "integrations" } });
    log("cron_integrations.scan_failed", "error", { scan: "integrations" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
