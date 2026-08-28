import type {
  CloseoutAdminTaskStatus,
  CloseoutDepartureStatus,
  LeftoverDecision,
} from "@/lib/closeout";
import type { RollCallGapReason } from "@/lib/today";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The day's closing words, keyed by the codes `src/lib/closeout.ts` produces —
 * the same split `src/i18n/today-labels.ts` keeps for the queue: the lib
 * decides *what* is true, this file says where the words live, and the surface
 * does the `t()` call.
 *
 * The day's headline and its sentence used to be here too, one per
 * `CloseoutShape`. They went with the page they headlined (H-62): the evening
 * is a state of the shop home, whose h1 is the standing time-aware greeting at
 * every hour and whose summary sentence is the spine's own.
 */

/** The state word beside a settled station's mark. Tone stays in `src/lib/closeout.ts`. */
export const CLOSEOUT_STATUS_KEYS: Record<CloseoutDepartureStatus, StaffMessageKey> = {
  all_home: "closeout.departures.status.allHome",
  unreconciled: "closeout.departures.status.unreconciled",
  still_out: "closeout.departures.status.stillOut",
  count_open: "closeout.departures.status.countOpen",
  not_departed: "closeout.departures.status.notDeparted",
};

/** The administrative task chip; its tone is derived in `src/lib/closeout.ts`. */
export const CLOSEOUT_ADMIN_STATUS_KEYS: Record<CloseoutAdminTaskStatus, StaffMessageKey> = {
  complete: "closeout.admin.status.complete",
  pending: "closeout.admin.status.pending",
  attention: "closeout.admin.status.attention",
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

/** The recorded decision's word on a snapshot leftover. */
export const CLOSEOUT_DECISION_KEYS: Record<LeftoverDecision, StaffMessageKey> = {
  carry: "closeout.record.carried",
  dismiss: "closeout.record.dismissed",
};
