import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import { boatStageOf } from "@/lib/trip-phase";
import { STAGE_WORD_KEYS, TRIP_STAGES, type TripStageReading } from "@/lib/trip-stages";
import type { StageStripCopy } from "./StageStrip";

/**
 * `StageStrip`'s selected word and copy, read once on the server.
 *
 * **One stage vocabulary** (UX review 2026-10-10, item 1): the strip selects
 * the word Today's card and the departure header print, by the one rule
 * `boatStageOf` keeps. A tap from before the departure's day, one from an
 * earlier day of a multi-day course, or one left standing once both the
 * return day and the hour past the return are over, selects nothing; the
 * diver-facing staleness rule
 * (`liveStageOf`) plays no part, so an overdue boat's strip still speaks.
 */
export function stageStripProps(
  t: StaffTranslator,
  input: {
    trip: { startsAt: Date; endsAt: Date };
    stage: TripStageReading | null;
    now: Date;
    timeZone: string;
    locale: string;
  },
): { current: TripStageReading["stage"] | null; copy: StageStripCopy } {
  const shown = boatStageOf({
    startsAt: input.trip.startsAt,
    endsAt: input.trip.endsAt,
    now: input.now,
    timeZone: input.timeZone,
    stage: input.stage,
    cancelled: false,
  });
  return {
    current: shown?.stage ?? null,
    copy: {
      legend: t("manifest.stage.legend"),
      errorRefusal: t("manifest.stage.errorRefusal"),
      taps: TRIP_STAGES.map((value) => ({ stage: value, label: t(STAGE_WORD_KEYS[value]) })),
      recordedLine: shown
        ? t("manifest.stage.recordedLine", {
            name: shown.recordedByName ?? "",
            time: formatTime(shown.recordedAt, input.locale, input.timeZone),
          })
        : undefined,
    },
  };
}
