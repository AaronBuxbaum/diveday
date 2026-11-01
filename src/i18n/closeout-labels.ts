import type { CloseoutDepartureStatus, CloseoutPlanChange, OpenCount } from "@/lib/closeout";
import { cachedListFormat } from "@/lib/intl-cache";
import type { PlanChangeReason } from "@/lib/plan-change";
import type { RollCallGapReason } from "@/lib/today";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The day's closing words, keyed by the codes `src/lib/closeout.ts` produces —
 * the same split `src/i18n/today-labels.ts` keeps for the queue: the lib
 * decides *what* is true, this file says where the words live, and the surface
 * does the `t()` call.
 *
 * The day's headline and its sentence used to be here too, one per
 * `CloseoutShape`. They went with the page they headlined (H-20260827-close-out-remain-own): the evening
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
 *
 * **The `all_home` fall-through has no count in it, on purpose** (issue
 * #1689). Its only caller reaches this function when the station is not
 * printing the homecoming numbers, which for an `all_home` station means
 * `sailed === 0` — an empty boat, or one whose whole roster stayed ashore. It
 * used to interpolate `booked` through a plural whose `one`/`other` branches
 * that guard made unreachable, and those branches said "10 divers, head count
 * closed" one line from "9 of 9 back". Unreachable copy carrying the wrong
 * meaning is a trap for whoever moves the guard next, so it is deleted rather
 * than left standing.
 */
export function closeoutDepartureDetailText(
  t: StaffTranslator,
  departure: {
    status: CloseoutDepartureStatus;
    gapReason: RollCallGapReason | null;
    uncounted: number;
    diveNumber: number;
    openCount?: OpenCount;
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
    case "still_out": {
      // A count still being taken keeps its dive and each half's open count
      // (src/lib/closeout.ts, `countStillBeingTaken`), so the station says it
      // is open and who is still to mark: people and crew, never folded.
      const open = departure.openCount;
      if (open && departure.diveNumber >= 1 && open.people + open.crew > 0) {
        const half = open.people > 0 && open.crew > 0 ? "both" : open.crew > 0 ? "crew" : "people";
        return t("closeout.departures.detail.stillOutCountOpen", {
          dive: departure.diveNumber,
          half,
          people: open.people,
          crew: open.crew,
          time,
        });
      }
      return t("closeout.departures.detail.stillOut", { time });
    }
    case "not_departed":
      return t("closeout.departures.detail.notDeparted", { time });
    default:
      return t("closeout.departures.detail.allHome");
  }
}

/**
 * The word for why the boat did not dive the plan.
 *
 * Deliberately 16d's own keys rather than a second set: the reason a diver's
 * dive log gives and the reason the evening gives are the same fact, and two
 * spellings of it would drift the first time somebody softened one.
 */
const PLAN_CHANGE_REASON_KEYS: Record<PlanChangeReason, StaffMessageKey> = {
  current: "manifest.planChange.reason.current",
  weather: "manifest.planChange.reason.weather",
  visibility: "manifest.planChange.reason.visibility",
  crew_call: "manifest.planChange.reason.crewCall",
};

/**
 * **The plan-change clause** (issue #1184, D24) — one per dive that moved,
 * joined the same way the open-seats clauses are.
 *
 * A dive that changed with no reason recorded still gets its clause, without
 * one. The reason is never inferred: a crew that moved the boat and said
 * nothing about why has a record saying the site changed, which is the true
 * half of it.
 */
export function planChangeText(
  t: StaffTranslator,
  locale: string,
  changes: readonly CloseoutPlanChange[],
): string | null {
  if (changes.length === 0) return null;
  const clauses = changes.map((change) =>
    change.reasonCode
      ? t("shopHome.spine.close.planChange.movedWithReason", {
          dive: change.diveNumber,
          site: change.siteName,
          reason: t(PLAN_CHANGE_REASON_KEYS[change.reasonCode]).toLocaleLowerCase(locale),
        })
      : t("shopHome.spine.close.planChange.moved", {
          dive: change.diveNumber,
          site: change.siteName,
        }),
  );
  // **One sentence, and the framing said once.** Each clause used to open with
  // "the plan changed:" in lower case, which put a second sentence-fragment on
  // the end of a station line that had already finished a sentence — and two
  // moved dives said it twice, joined by "and". The framing belongs to the
  // sentence; the clauses are what differ (principle 9).
  return t("shopHome.spine.close.planChange.sentence", {
    changes: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(clauses),
  });
}
