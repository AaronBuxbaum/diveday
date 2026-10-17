import { cache } from "react";
import { getTripBlowout, type TripBlowoutRecord } from "@/db/blowouts";
import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The page's heading, and its tab's title: the confirm before the call, then
 * the record in its cause's words, since a run's cancellation is not weather
 * (review, 2026-10-12; #2460).
 */
export function blowoutTitleKey(blowout: TripBlowoutRecord | null): StaffMessageKey {
  if (!blowout) return "blowout.confirm.title";
  return blowout.cause === "run_ended" ? "blowout.record.titleRunEnded" : "blowout.record.title";
}

/** One read per request: the tab's title and the page ask for the same record. */
export const readBlowout = cache(getTripBlowout);
