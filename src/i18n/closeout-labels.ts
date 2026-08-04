import type {
  CloseoutDepartureStatus,
  CloseoutShape,
  CloseoutSnapshotDeparture,
  LeftoverDecision,
} from "@/lib/closeout";
import type { RollCallGapReason } from "@/lib/today";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The close-out surface's words, keyed by the codes `src/lib/closeout.ts`
 * produces — the same split `src/i18n/today-labels.ts` keeps for the queue:
 * the lib decides *what* is true, this file says where the words live, and
 * the page does the `t()` call.
 */

/** The day's one-line headline, per shape. */
export const CLOSEOUT_HEADLINE_KEYS: Record<CloseoutShape, StaffMessageKey> = {
  all_clear: "closeout.headline.allClear",
  outstanding: "closeout.headline.outstanding",
  no_departures: "closeout.headline.noDepartures",
};

/** The sentence under the headline, per shape. */
export const CLOSEOUT_SUBTITLE_KEYS: Record<CloseoutShape, StaffMessageKey> = {
  all_clear: "closeout.subtitle.allClear",
  outstanding: "closeout.subtitle.outstanding",
  no_departures: "closeout.subtitle.noDepartures",
};

/** The chip on each departure card. Tone stays in `src/lib/closeout.ts`. */
export const CLOSEOUT_STATUS_KEYS: Record<CloseoutDepartureStatus, StaffMessageKey> = {
  all_home: "closeout.departures.status.allHome",
  unreconciled: "closeout.departures.status.unreconciled",
  still_out: "closeout.departures.status.stillOut",
  count_open: "closeout.departures.status.countOpen",
  not_departed: "closeout.departures.status.notDeparted",
};

/** Each gap reason's own sentence — deliberately never a shared one (DOM-H3). */
const GAP_DETAIL_KEYS: Record<RollCallGapReason, StaffMessageKey> = {
  missing_diver: "closeout.departures.detail.missingDiver",
  missing_crew: "closeout.departures.detail.missingCrew",
  after_dive_uncounted: "closeout.departures.detail.afterDiveUncounted",
  crew_uncounted: "closeout.departures.detail.crewUncounted",
  departure_uncounted: "closeout.departures.detail.departureUncounted",
  no_roll_call: "closeout.departures.detail.noRollCall",
};

/**
 * The sentence under a departure's status chip. `time` is the formatted
 * shop-local clock time the sentence needs — return time for `still_out`,
 * departure time for `not_departed` — already formatted by the caller for the
 * request locale.
 */
export function closeoutDepartureDetailText(
  t: StaffTranslator,
  departure: {
    status: CloseoutDepartureStatus;
    gapReason: RollCallGapReason | null;
    uncounted: number;
    diveNumber: number;
    booked: number;
  },
  time: string,
): string {
  if (departure.gapReason) {
    return t(GAP_DETAIL_KEYS[departure.gapReason], {
      count: departure.uncounted,
      dive: departure.diveNumber,
    });
  }
  switch (departure.status) {
    case "still_out":
      return t("closeout.departures.detail.stillOut", { time });
    case "not_departed":
      return t("closeout.departures.detail.notDeparted", { time });
    default:
      return t("closeout.departures.detail.allHome", { booked: departure.booked });
  }
}

/** A recorded snapshot departure's line — status word plus its gap sentence. */
export function closeoutRecordedDepartureText(
  t: StaffTranslator,
  departure: CloseoutSnapshotDeparture,
): string {
  return t(CLOSEOUT_STATUS_KEYS[departure.status]);
}

/** The recorded decision's word on a snapshot leftover. */
export const CLOSEOUT_DECISION_KEYS: Record<LeftoverDecision, StaffMessageKey> = {
  carry: "closeout.record.carried",
  dismiss: "closeout.record.dismissed",
};
