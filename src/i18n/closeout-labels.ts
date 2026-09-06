import type {
  CloseoutAdminTaskStatus,
  CloseoutDepartureStatus,
  CloseoutPlanChange,
  LeftoverDecision,
} from "@/lib/closeout";
import { cachedListFormat } from "@/lib/intl-cache";
import type { OpenSeatsDebrief } from "@/lib/open-seats";
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

/**
 * **The open-seats debrief, as one sentence** (issue #1207, D47).
 *
 * One to three clauses joined by the locale's own conjunction, wrapped in the
 * sentence that leads with the count. `cachedListFormat` rather than a bare
 * `new Intl.ListFormat`: a formatter costs about twelve times what reusing one
 * does, and this file formats on essentially every evening render
 * (`pnpm check:intl-cache`).
 *
 * Null when there is no clause to make, which is the ADR's standing rule that
 * a widening renders nothing when it is not true. `openSeatsDebrief` has
 * already refused a departure that filled and one that never sailed, so
 * anything arriving here has seats to explain.
 */
export function openSeatsDebriefText(
  t: StaffTranslator,
  locale: string,
  debrief: OpenSeatsDebrief,
  input: { comparableDate: string },
): string | null {
  const clauses: string[] = [];
  if (debrief.lastBookingDaysOut !== null) {
    clauses.push(
      t("shopHome.spine.close.openSeats.lastBooking", { days: debrief.lastBookingDaysOut }),
    );
  }
  // Only the *absent* deal is a clause. A deal that went out is the shop having
  // already done the thing, which needs no sentence about it.
  if (!debrief.dealSent) clauses.push(t("shopHome.spine.close.openSeats.noDeal"));
  if (debrief.comparable) {
    clauses.push(
      t(
        debrief.comparable.samePrice
          ? "shopHome.spine.close.openSeats.comparableSamePrice"
          : "shopHome.spine.close.openSeats.comparableOtherPrice",
        { title: debrief.comparable.title, date: input.comparableDate },
      ),
    );
  }
  if (clauses.length === 0) return null;
  return t("shopHome.spine.close.openSeats.sentence", {
    seats: debrief.openSeats,
    facts: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(clauses),
  });
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
  return cachedListFormat(locale, { style: "long", type: "conjunction" }).format(clauses);
}

/** The recorded decision's word on a snapshot leftover. */
export const CLOSEOUT_DECISION_KEYS: Record<LeftoverDecision, StaffMessageKey> = {
  carry: "closeout.record.carried",
  dismiss: "closeout.record.dismissed",
};
