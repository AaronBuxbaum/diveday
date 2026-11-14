import type { AppDb } from "@/db/client";
import { readSafetyDeliveryMonitor } from "./delivery-monitor";
import { scanUnresolvedSafetyAlerts } from "./delivery-scan";
import type { SafetyReviewProvider } from "./delivery-worker";
import { unresolvedReviewAvailable } from "./review-availability";

/** The scheduler remains disabled until a verified provider is configured. */
export async function runUnresolvedSafetyAlertTick(db: AppDb, provider?: SafetyReviewProvider) {
  if (!unresolvedReviewAvailable()) return { status: "disabled" as const };
  if (!provider?.safetySingleAttemptAbortable)
    throw new Error("Unresolved safety alert delivery is not configured");
  const result = await scanUnresolvedSafetyAlerts(db, provider);
  if (result.status === "unavailable" || result.status === "lost_lease")
    throw new Error(`Unresolved safety alert scan ${result.status}`);
  const monitoring = await readSafetyDeliveryMonitor(db);
  return { ...result, monitoring };
}
