import { checkpointGapLine } from "@/components/checkpoint-gap-words";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { homewardCheckpointGap } from "@/lib/checkpoint-gaps";
import { formatTime } from "@/lib/format";
import type { TripManifest } from "@/lib/manifests";
import { shopPath } from "@/lib/staff-notices";
import { boatStageOf, type MeetingWindow } from "@/lib/trip-phase";
import {
  STAGE_WORD_KEYS,
  TRIP_STAGES,
  type TripStage,
  type TripStageReading,
} from "@/lib/trip-stages";
import type { StageStripCopy } from "./StageStrip";

/** The word each stage takes on a phone, where five full words do not fit one row (B06). */
const STAGE_SHORT_WORD_KEYS = {
  boarding: "manifest.stage.shortBoarding",
  underway: "manifest.stage.shortUnderway",
  surface: "manifest.stage.shortSurface",
  heading_in: "manifest.stage.shortHeadingIn",
  home: "manifest.stage.shortHome",
} as const satisfies Record<TripStage, string>;

type GapManifest = Pick<TripManifest, "trip" | "checkpoint" | "summary" | "crew">;

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
  input: (
    | { trip: { startsAt: Date; endsAt: Date } }
    | {
        /**
         * The departure's manifests, dock first: the trip is the dock's, and
         * the last after-dive checkpoint is asked whether it has everyone
         * (`homewardCheckpointGap`, batch 6 item 4).
         */
        manifests: readonly GapManifest[];
        /** For the dive-count link a `not_counted` gap offers. */
        shopSlug: string;
      }
  ) & {
    stage: TripStageReading | null;
    now: Date;
    timeZone: string;
    locale: string;
    /** The run's real meeting windows, when it is a multi-day one (`meetingWindowsByTrip`). */
    meetingWindows?: readonly MeetingWindow[];
  },
): { current: TripStageReading["stage"] | null; copy: StageStripCopy } {
  const trip = "trip" in input ? input.trip : input.manifests[0]?.trip;
  if (!trip) throw new Error("stageStripProps: a departure has at least its dock manifest");
  const homewardGap = "manifests" in input ? homewardCheckpointGap(input.manifests) : null;
  // The dive count lives on the departure's Details tab (`TripDiveFields`): a
  // dive called off is a plan edit, and the floor (`updateTrip`) allows it
  // because nobody was counted there.
  const planHref =
    "manifests" in input && input.manifests[0]
      ? `${shopPath(input.shopSlug, "trips", input.manifests[0].trip.id)}?view=details#dives`
      : undefined;
  const shown = boatStageOf({
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    now: input.now,
    timeZone: input.timeZone,
    stage: input.stage,
    cancelled: false,
    meetingWindows: input.meetingWindows,
  });
  return {
    current: shown?.stage ?? null,
    copy: {
      legend: t("manifest.stage.legend"),
      errorRefusal: t("manifest.stage.errorRefusal"),
      taps: TRIP_STAGES.map((value) => ({
        stage: value,
        label: t(STAGE_WORD_KEYS[value]),
        shortLabel: t(STAGE_SHORT_WORD_KEYS[value]),
      })),
      recordedLine: shown
        ? t("manifest.stage.recordedLine", {
            name: shown.recordedByName ?? "",
            time: formatTime(shown.recordedAt, input.locale, input.timeZone),
          })
        : undefined,
      // A same-page address: the roll call is this manifest at that checkpoint.
      rollCallOpen: homewardGap
        ? {
            line: checkpointGapLine(t, homewardGap),
            openLabel: t("manifest.stage.openRollCall"),
            href: `?checkpoint=${homewardGap.checkpoint}`,
            plan:
              homewardGap.kind === "not_counted" && planHref
                ? { label: t("manifest.checkpointGap.setPlan"), href: planHref }
                : undefined,
          }
        : undefined,
    },
  };
}
