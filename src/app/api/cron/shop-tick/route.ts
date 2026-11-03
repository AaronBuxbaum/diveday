import { getDb } from "@/db/client";
import {
  isShopTickScan,
  runShopTick,
  SHOP_TICK_SCANS,
  shopTickIsHealthy,
} from "@/features/shop-tick";
import { nowDate } from "@/lib/clock";
import { requireCronSecret } from "@/lib/cron-auth";
import { cronRoute } from "@/lib/cron-route";
import { SHOP_TICK_CRONTAB } from "@/lib/cron-schedule";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";

/** A whole boat's reminders or recaps can come due at once; keep the provider-bound pass bounded. */
export const maxDuration = 300;

/**
 * **Every shop cadence, hourly** (issue #2715): one route, one monitor, the
 * scans in `src/features/shop-tick`. Each scan is isolated, and a failed one
 * turns the check-in to error without costing the others their pass.
 */
const tick = cronRoute({
  id: "shop-tick",
  crontab: SHOP_TICK_CRONTAB,
  run: async () => runShopTick(await getDb(), nowDate(), SHOP_TICK_SCANS),
  healthy: shopTickIsHealthy,
});

/**
 * `?scan=<name>` (repeatable) reruns only those scans, by hand or from an
 * end-to-end test. It never checks in to the tick's monitor: a partial run
 * filling the hour's slot would hide a missed tick whose other scans never
 * ran. An unknown name is a 400 before anything runs, never a silent full
 * tick; a repeated name runs once. A scan that fails still logs
 * `cron_shop_tick.scan_failed`, because the failure is real.
 */
export async function GET(request: Request): Promise<Response> {
  const named = new URL(request.url).searchParams.getAll("scan");
  if (named.length === 0) return tick(request);

  const refusal = requireCronSecret(request);
  if (refusal) return refusal;
  const unknown = named.filter((scan) => !isShopTickScan(scan));
  if (unknown.length > 0) return Response.json({ error: "unknown_scan", unknown }, { status: 400 });
  try {
    const scans = [...new Set(named.filter(isShopTickScan))];
    const summary = await runShopTick(await getDb(), nowDate(), scans);
    log("cron_shop_tick.rerun_complete", "info", { scans: scans.join(",") });
    return Response.json(summary);
  } finally {
    await flushLogs();
  }
}
