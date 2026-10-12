import type { InWaterCrewCount, LapsedRung } from "@/lib/crew-roles";
import { formatTime } from "@/lib/format";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";

/** The shop's own calendar day an instant falls on, as a `YYYY-MM-DD` string. */
export function shopDay(date: Date, timeZone: string): string {
  return toDateInputValue(utcToWallTime(date, timeZone));
}

/** A departure's time of day on the shop's own clock, in the reader's words. */
export function at(date: Date, timeZone: string, locale: string): string {
  return formatTime(date, locale, timeZone);
}

/**
 * The supervision claim for one departure: the in-water counts with every
 * rostered professional's recorded ratings read, the roster's claim beside it
 * (the same count with none read), and who a lapse took down a rung and which
 * rung (issue #1853). A surface says a gap is a lapse's only when the two
 * claims disagree about that gap.
 */
export type SupervisionCrewCount = InWaterCrewCount & {
  roster: InWaterCrewCount;
  lapsed: { personId: string; fullName: string; lost: LapsedRung }[];
};

/** A departure nobody is rostered on: nobody in the water, nobody lapsed. */
export const NO_SUPERVISION: SupervisionCrewCount = {
  instructorCount: 0,
  assistantCount: 0,
  roster: { instructorCount: 0, assistantCount: 0 },
  lapsed: [],
};
