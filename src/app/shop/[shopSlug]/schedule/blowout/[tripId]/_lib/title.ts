import { cache } from "react";
import { getTripBlowout, type TripBlowoutRecord } from "@/db/blowouts";
import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The page's heading, and its tab's title: the confirm before the call, then
 * historical record after it. A weather record survives reinstatement, so its
 * title must not claim the departure is still canceled. A run's cancellation
 * keeps its cause-specific wording (review, 2026-10-12; #2460).
 */
export function blowoutTitleKey(blowout: TripBlowoutRecord | null): StaffMessageKey {
  if (!blowout) return "blowout.confirm.title";
  return blowout.cause === "run_ended" ? "blowout.record.titleRunEnded" : "blowout.record.title";
}

/** One read per request: the tab's title and the page ask for the same record. */
export const readBlowout = cache(getTripBlowout);
