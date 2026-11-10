import { getDb } from "@/db/client";
import { requireCronSecret } from "@/features/cron-auth";
import { flushLogs } from "@/features/log-shipping";
import { sentry } from "@/features/sentry-server";
import { configuredWalletPlatforms, pushChangedWalletPasses } from "@/features/wallet-pass";

export const maxDuration = 60;
const monitorSlug = "diveday-wallet-passes";
const monitorConfig = {
  schedule: { type: "crontab", value: "*/10 * * * *" },
  checkinMargin: 10,
  // Sentry timeout grace only; the execution ceiling above remains sixty seconds.
  maxRuntime: 2,
  timezone: "Etc/UTC",
} as const;

export async function GET(request: Request) {
  const refusal = requireCronSecret(request);
  if (refusal) return refusal;
  if (!configuredWalletPlatforms().length)
    return Response.json({ examined: 0, pushed: 0, failed: 0 });
  const checkInId = await sentry.captureCheckIn(
    { monitorSlug, status: "in_progress" },
    monitorConfig,
  );
  try {
    const summary = await pushChangedWalletPasses(await getDb());
    await sentry.captureCheckIn({
      checkInId,
      monitorSlug,
      status: summary.failed ? "error" : "ok",
    });
    return Response.json(summary, { status: summary.failed ? 500 : 200 });
  } catch {
    await sentry.captureCheckIn({ checkInId, monitorSlug, status: "error" });
    return Response.json({ error: "wallet_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
