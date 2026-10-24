import type { MediaDeletionKind, PaymentOperationKind } from "@/db/schema";
import { calendarDateInTimezone, calendarDaysBetween } from "@/lib/calendar-date";
import { DSD_RATIO } from "@/lib/course-ratios";
import type { DepthUnit } from "@/lib/depth-units";
import { formatDateTimeTz, formatRelativeDay, formatShortDate, formatWeekday } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { firstNameOf } from "@/lib/person-name";
import type { ReadinessBlocker, ReadinessBlockerCode } from "@/lib/readiness";
import type { TemperatureUnit } from "@/lib/temperature-units";
import type { RollCallGapReason, TodayActionKind } from "@/lib/today";
import { awayDatesText } from "./away-labels";
import { SPECIALTY_KEYS } from "./readiness-labels";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/** Every `TodayActionKind` chip, to its label key. Tone stays in `src/lib/today.ts` (not copy). */
export const ACTION_KIND_KEYS: Record<TodayActionKind, StaffMessageKey> = {
  roll_call_missing_diver: "today.actionKind.rollCallMissingDiver",
  roll_call_missing_crew: "today.actionKind.rollCallMissingCrew",
  roll_call_unfinished: "today.actionKind.rollCallUnfinished",
  roll_call_crew_unfinished: "today.actionKind.rollCallCrewUnfinished",
  roll_call_departure_open: "today.actionKind.rollCallDepartureOpen",
  roll_call_not_started: "today.actionKind.rollCallNotStarted",
  medical_review: "today.actionKind.medicalReview",
  medical_not_cleared: "today.actionKind.medicalNotCleared",
  readiness_unavailable: "today.actionKind.readinessUnavailable",
  identity: "today.actionKind.identity",
  certification: "today.actionKind.certification",
  requirements: "today.actionKind.requirements",
  waiver: "today.actionKind.waiver",
  instructor_missing: "today.actionKind.instructorMissing",
  uncrewed_course: "today.actionKind.uncrewedCourse",
  uncrewed_departure: "today.actionKind.uncrewedDeparture",
  boat_clash: "today.actionKind.boatClash",
  crew_clash: "today.actionKind.crewClash",
  crew_clash_sailed: "today.actionKind.crewClashSailed",
  crew_away: "today.actionKind.crewAway",
  nitrox_gate: "today.actionKind.nitroxGate",
  high_wind_alert: "today.actionKind.highWindAlert",
  dive_prep: "today.actionKind.divePrep",
  help_request: "today.actionKind.helpRequest",
  payment: "today.actionKind.payment",
  email_delivery: "today.actionKind.emailDelivery",
  blocked_aboard: "today.actionKind.blockedAboard",
  seat_wanted: "today.actionKind.seatWanted",
  emergency_contact: "today.actionKind.emergencyContact",
  crew_below_target: "today.actionKind.crewBelowTarget",
  stuck_payment_operation: "today.actionKind.stuckPaymentOperation",
  failed_photo_deletion: "today.actionKind.failedPhotoDeletion",
  owed_refund: "today.actionKind.owedRefund",
  payment_dispute: "today.actionKind.paymentDispute",
  payments_restricted: "today.actionKind.paymentsRestricted",
  reviews_pending: "today.actionKind.reviewsPending",
  unanswered_messages: "today.actionKind.unansweredMessages",
  gear_overdue: "today.actionKind.gearOverdue",
  gear_due_back: "today.actionKind.gearDueBack",
  gear_service_due: "today.actionKind.gearServiceDue",
  boat_safety_kit: "today.actionKind.boatSafetyKit",
  boat_papers_due: "today.actionKind.boatPapersDue",
  boat_papers_lapsed: "today.actionKind.boatPapersLapsed",
  boat_safety_expired: "today.actionKind.boatSafetyExpired",
  boat_snag: "today.actionKind.boatSnag",
  incident_report_unfiled: "today.actionKind.incidentReportUnfiled",
  work_order_late: "today.actionKind.workOrderLate",
  work_order_uncollected: "today.actionKind.workOrderUncollected",
  staff_credential_due: "today.actionKind.staffCredentialDue",
  units_unconfirmed: "today.actionKind.unitsUnconfirmed",
  emergency_card_blank: "today.actionKind.emergencyCardBlank",
  lost_items_waiting: "today.actionKind.lostItemsWaiting",
  rental_fit_confirm: "today.actionKind.rentalFit",
};

/** A blocked row's one-tap fix, singular ("Send waiver"). */
const BLOCKER_ACTION_LABEL_KEYS: Record<ReadinessBlockerCode, StaffMessageKey> = {
  requirements_not_configured: "today.blockerAction.setRequirements",
  identity_unconfirmed: "today.blockerAction.confirmIdentity",
  under_minimum_age: "today.blockerAction.checkDateOfBirth",
  waiver_not_sent: "today.blockerAction.sendWaiver",
  waiver_lapsed: "today.blockerAction.sendWaiver",
  waiver_runs_out: "today.blockerAction.sendWaiver",
  waiver_pending: "today.blockerAction.nudgeWaiver",
  waiver_expired: "today.blockerAction.reissueWaiver",
  medical_review: "today.blockerAction.reviewMedical",
  // Not "review": there is nothing left to review. What the refusal creates
  // is a conversation about a seat this diver can no longer take, and the
  // label stops there rather than choosing refund or rebook for the shop.
  medical_not_cleared: "today.blockerAction.contactDiver",
  // The same tap as an expired link: a fresh link goes out, and this time it
  // asks the guardian to sign too (ADR 20260907-guardian-co-signature).
  guardian_signature_missing: "today.blockerAction.reissueWaiver",
  course_form_unsigned: "today.blockerAction.getCourseFormsSigned",
  course_form_guardian_missing: "today.blockerAction.getCourseFormsSigned",
  training_mark_invalid: "today.blockerAction.clearTrainingMark",
  certification_missing: "today.blockerAction.addCard",
  // Nothing to add or verify: the diver said there is no card. The fix is a
  // conversation before boarding (third UX review, item 23).
  certification_not_yet: "today.blockerAction.contactDiver",
  certification_pending: "today.blockerAction.verifyCard",
  // Never "Verify card": there is no number to look up with an agency, only a
  // level the diver typed. The work is getting the card in front of somebody.
  certification_self_declared: "today.blockerAction.askForCard",
  certification_insufficient: "today.blockerAction.reviewCard",
  // There is no card to review yet (issue #2058): the diver is on a course
  // that ends before this trip, and what is left is its result, the
  // instructor's tap on the course roster or a word with the diver.
  certification_in_training: "today.blockerAction.checkCourseResult",
  specialty_missing: "today.blockerAction.addSpecialty",
  specialty_pending: "today.blockerAction.verifySpecialty",
  specialty_import_unconfirmed: "today.blockerAction.confirmSpecialty",
  nitrox_missing: "today.blockerAction.addNitroxCard",
  nitrox_pending: "today.blockerAction.verifyNitroxCard",
  nitrox_self_declared: "today.blockerAction.askForNitroxCard",
  payment_due: "today.blockerAction.takePayment",
  payment_refunded: "today.blockerAction.takePayment",
  readiness_unavailable: "today.blockerAction.checkReadiness",
};

/**
 * A blocked row's action-button word, the verb when one tap sends in place
 * ("Send waiver"). Used by the Today queue (`src/lib/today.ts`) through
 * `blockerDestination`, the one blocker→fix rule.
 */
export function blockerActionLabelText(t: StaffTranslator, code: ReadinessBlockerCode): string {
  return t(BLOCKER_ACTION_LABEL_KEYS[code]);
}

/**
 * A label for a row whose fix lives on another screen: it points, it does not
 * command ("Open Priya's record", "Open roster"). Card work waits on the
 * person record; everything else on the trip roster.
 */
export function pointingLabelText(
  t: StaffTranslator,
  target: "trip" | "diver",
  fullName: string,
): string {
  return target === "diver"
    ? // Falls back to the whole name rather than a word: this is a pointing
      // label ("Open Priya's record"), so an unsplittable name is still the
      // best thing to point at.
      t("today.pointingLabel.diver", { name: firstNameOf(fullName, fullName) })
    : t("today.pointingLabel.trip");
}

/** A Today row's short blocker sentence, keyed by code (`today.blockerRow.*`). */
const BLOCKER_ROW_KEYS: Record<ReadinessBlockerCode, StaffMessageKey> = {
  requirements_not_configured: "today.blockerRow.requirementsNotConfigured",
  identity_unconfirmed: "today.blockerRow.identityUnconfirmed",
  waiver_not_sent: "today.blockerRow.waiverNotSent",
  waiver_lapsed: "today.blockerRow.waiverLapsed",
  waiver_runs_out: "today.blockerRow.waiverRunsOut",
  waiver_pending: "today.blockerRow.waiverPending",
  waiver_expired: "today.blockerRow.waiverExpired",
  medical_review: "today.blockerRow.medicalReview",
  medical_not_cleared: "today.blockerRow.medicalNotCleared",
  guardian_signature_missing: "today.blockerRow.guardianSignatureMissing",
  course_form_unsigned: "today.blockerRow.courseFormUnsigned",
  course_form_guardian_missing: "today.blockerRow.courseFormUnsigned",
  training_mark_invalid: "today.blockerRow.trainingMarkInvalid",
  certification_missing: "today.blockerRow.certificationMissing",
  certification_not_yet: "today.blockerRow.certificationNotYet",
  certification_pending: "today.blockerRow.certificationPending",
  certification_self_declared: "today.blockerRow.certificationSelfDeclared",
  certification_insufficient: "today.blockerRow.certificationInsufficient",
  certification_in_training: "today.blockerRow.certificationInTraining",
  specialty_missing: "today.blockerRow.specialtyMissing",
  specialty_pending: "today.blockerRow.specialtyPending",
  specialty_import_unconfirmed: "today.blockerRow.specialtyImportUnconfirmed",
  nitrox_missing: "today.blockerRow.nitroxMissing",
  nitrox_pending: "today.blockerRow.nitroxPending",
  nitrox_self_declared: "today.blockerRow.nitroxSelfDeclared",
  under_minimum_age: "today.blockerRow.underMinimumAge",
  payment_due: "today.blockerRow.paymentDue",
  payment_refunded: "today.blockerRow.paymentRefunded",
  readiness_unavailable: "today.blockerRow.readinessUnavailable",
};

/**
 * **A Today row says what is wrong in a few words, and the record says the
 * rest.** "Not certified for this trip" — never the levels or the count of
 * other blockers (Aaron, 2026-10-05). The full sentence
 * (`readinessBlockerText`) is one tap away on the roster and the diver
 * record, which is where it is read.
 */
export function blockerRowText(t: StaffTranslator, blocker: ReadinessBlocker, count = 1): string {
  const specialty = blocker.params?.specialty;
  return t(BLOCKER_ROW_KEYS[blocker.code], {
    count,
    specialty: specialty ? t(SPECIALTY_KEYS[specialty]) : "",
  });
}

/** The one-tap fix for a boat's waivers at once, by the code they share ("Send waivers"). */
const WAIVER_BATCH_LABEL_KEYS = {
  waiver_not_sent: "today.blockerGroup.sendWaivers",
  waiver_lapsed: "today.blockerGroup.sendWaivers",
  waiver_runs_out: "today.blockerGroup.sendWaivers",
  waiver_pending: "today.blockerGroup.nudgeWaivers",
  waiver_expired: "today.blockerGroup.reissueWaivers",
  guardian_signature_missing: "today.blockerGroup.reissueWaivers",
} as const satisfies Partial<Record<ReadinessBlockerCode, StaffMessageKey>>;

export type WaiverBatchCode = keyof typeof WAIVER_BATCH_LABEL_KEYS;

/** The batch waiver button's word for a code a one-tap send resolves. */
export function waiverBatchLabelText(t: StaffTranslator, code: WaiverBatchCode): string {
  return t(WAIVER_BATCH_LABEL_KEYS[code]);
}

/** A gap's short name in a diver's row, keyed by blocker code (`today.diverItem.*`). */
const BLOCKER_ITEM_KEYS: Record<ReadinessBlockerCode, StaffMessageKey> = {
  requirements_not_configured: "today.diverItem.requirements",
  identity_unconfirmed: "today.diverItem.identity",
  under_minimum_age: "today.diverItem.underMinimumAge",
  waiver_not_sent: "today.diverItem.waiver",
  waiver_lapsed: "today.diverItem.waiver",
  waiver_runs_out: "today.diverItem.waiver",
  waiver_pending: "today.diverItem.waiver",
  waiver_expired: "today.diverItem.waiver",
  guardian_signature_missing: "today.diverItem.guardianSignature",
  course_form_unsigned: "today.diverItem.courseForm",
  course_form_guardian_missing: "today.diverItem.courseForm",
  training_mark_invalid: "today.diverItem.trainingMark",
  medical_review: "today.diverItem.medicalReview",
  medical_not_cleared: "today.diverItem.medicalNotCleared",
  certification_missing: "today.diverItem.certificationMissing",
  certification_pending: "today.diverItem.certificationUnverified",
  certification_self_declared: "today.diverItem.certificationUnverified",
  certification_insufficient: "today.diverItem.certificationInsufficient",
  certification_not_yet: "today.diverItem.certificationNotYet",
  certification_in_training: "today.diverItem.certificationInTraining",
  specialty_missing: "today.diverItem.specialty",
  specialty_pending: "today.diverItem.specialty",
  specialty_import_unconfirmed: "today.diverItem.specialty",
  nitrox_missing: "today.diverItem.nitrox",
  nitrox_pending: "today.diverItem.nitrox",
  nitrox_self_declared: "today.diverItem.nitrox",
  payment_due: "today.diverItem.payment",
  payment_refunded: "today.diverItem.payment",
  readiness_unavailable: "today.diverItem.readiness",
};

/** One blocker as an item of a diver's row: "waiver", "certification". */
export function blockerItemText(t: StaffTranslator, blocker: ReadinessBlocker): string {
  const specialty = blocker.params?.specialty;
  return t(BLOCKER_ITEM_KEYS[blocker.code], {
    specialty: specialty ? t(SPECIALTY_KEYS[specialty]) : "",
  });
}

/** The boat's own per-diver gaps as items of a diver's row. */
export function boatWorkItemText(
  t: StaffTranslator,
  gap: "missing_size" | "kit_unasked" | "ungated_nitrox" | "missing_contact",
): string {
  switch (gap) {
    case "missing_size":
      return t("today.diverItem.size");
    case "kit_unasked":
      return t("today.diverItem.kit");
    case "ungated_nitrox":
      return t("today.diverItem.nitrox");
    case "missing_contact":
      return t("today.diverItem.emergencyContact");
  }
}

/**
 * Every item open for one diver, in the row's order: "waiver, emergency
 * contact". A comma list in both locales, like `nameListText`'s leading names;
 * no conjunction, because the row is a list of gaps, not a sentence.
 */
export function diverItemsText(items: readonly string[]): string {
  return items.join(", ");
}

/**
 * A readiness blocker's own sentence, then every other gap open for the diver:
 * "Not cleared to dive by a physician; also waiver, emergency contact". The
 * blocker keeps its words because they say the state, which a topic cannot.
 */
export function diverAlsoText(t: StaffTranslator, lead: string, others: readonly string[]): string {
  return t("today.diverItem.also", {
    lead: lead.replace(/\.$/, ""),
    items: diverItemsText(others),
  });
}

/**
 * "Ana, Ben and 6 others" — enough to recognise the group, short enough to
 * scan. Here rather than in `src/lib/today.ts` because the joining words are
 * *words*: that version baked " and ", "other" and "others" into a string a
 * page renders verbatim, so a Spanish reader got English conjunctions inside an
 * otherwise translated sentence.
 *
 * `shown` is how many names survive before the tail collapses to a count. A
 * list only one longer than that prints in full, because "…and 1 other" costs
 * the same room as the name it withholds.
 */
export function nameListText(t: StaffTranslator, names: readonly string[], shown = 2): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length <= shown + 1) {
    return t("today.nameList.all", {
      leading: names.slice(0, -1).join(", "),
      last: names.at(-1) ?? "",
    });
  }
  return t("today.nameList.overflow", {
    leading: names.slice(0, shown).join(", "),
    rest: names.length - shown,
  });
}

/** The remaining `src/db/today.ts` action rows, resolved through the same bundle-only rule. */

/** One diver's sizes job: a blank size, or nobody has asked about their kit yet. */
export function missingFitNamedDetailText(t: StaffTranslator, unasked: boolean): string {
  return t(unasked ? "today.detail.kitUnaskedNamed" : "today.detail.missingSizeNamed");
}

/**
 * A boat's divers nobody has asked about their kit, on one row (Aaron
 * 2026-10-23). Every name is said: the row has no "and N more" to open.
 */
export function kitUnaskedGroupDetailText(t: StaffTranslator, names: readonly string[]): string {
  return t("today.detail.kitUnaskedGroup", { names: nameListText(t, names, names.length) });
}

export function ungatedNitroxNamedDetailText(t: StaffTranslator): string {
  return t("today.detail.ungatedNitroxNamed");
}

export function highWindAlertDetailText(
  t: StaffTranslator,
  speed: number,
  gusts: number | null,
  direction: string | null,
): string {
  return t("today.detail.highWindAlert", {
    speed,
    gusts: gusts ?? 0,
    hasGusts: gusts !== null && gusts > speed ? "yes" : "no",
    direction: direction ?? "",
    hasDirection: direction ? "yes" : "no",
  });
}

export function instructorMissingDetailText(t: StaffTranslator): string {
  return t("today.detail.instructorMissing");
}

/**
 * `divemasterRatioGap`'s `divemasterCount === 0` case (issue #732) — divers
 * booked, nobody rostered at all, course session or fun dive. A distinct
 * sentence from `crewBelowTargetDetailText`, not a shared one branching on
 * count: "nobody assigned" and "one short of target" are different problems
 * with different tone, and collapsing them is the failure this ticket exists
 * to fix on the trip page's own `underTargetNote` wording it deliberately
 * does not reuse verbatim — the trip page speaks to someone already looking
 * at the crew editor, this queue row is the fact that gets them there.
 */
export function uncrewedDepartureDetailText(t: StaffTranslator, divers: number): string {
  return t("today.detail.uncrewedDeparture", { divers });
}

/**
 * The people a departure shares with each other departure, one group per
 * other departure in the order first met, names joined the locale's way.
 * Per person per departure, a boat moved onto a busy morning read four
 * sentences of the same "also rostered on" — ten lines on a phone.
 */
function clashGroups(
  locale: string,
  clashes: readonly { fullName: string; otherTitle: string }[],
): { names: string; count: number; departure: string }[] {
  const byDeparture = new Map<string, string[]>();
  for (const clash of clashes) {
    const names = byDeparture.get(clash.otherTitle) ?? [];
    if (!names.includes(clash.fullName)) names.push(clash.fullName);
    byDeparture.set(clash.otherTitle, names);
  }
  const list = cachedListFormat(locale, { style: "long", type: "conjunction" });
  return [...byDeparture].map(([departure, names]) => ({
    names: list.format(names),
    count: names.length,
    departure,
  }));
}

/**
 * One sentence per other departure on the same hull (H-80, issue #2135), the
 * hull and the other departure named, in the words the departure page uses.
 */
export function boatClashDetailText(
  t: StaffTranslator,
  clashes: readonly { boatName: string; otherTitle: string }[],
): string {
  return clashes
    .map((clash) =>
      t("today.detail.boatClash", { boat: clash.boatName, departure: clash.otherTitle }),
    )
    .join(" ");
}

/**
 * One sentence per other departure (H-80, issue #1776), naming everyone it
 * shares — the same "also rostered on" the Crew panel and the staffing week
 * say, so a staffer reads one fact in one set of words wherever they meet it.
 */
export function crewClashDetailText(
  t: StaffTranslator,
  locale: string,
  clashes: readonly { fullName: string; otherTitle: string }[],
): string {
  return clashGroups(locale, clashes)
    .map((group) => t("today.detail.crewClash", group))
    .join(" ");
}

/**
 * **Who on this departure said they are away on a day it meets** (fourth
 * review, item 12): one sentence a person, with the days, in the words the
 * staffing week and the board use (`awayDatesText`).
 */
export function crewAwayDetailText(
  t: StaffTranslator,
  locale: string,
  away: readonly { fullName: string; blocks: readonly { startsOn: string; endsOn: string }[] }[],
): string {
  return away
    .map((person) =>
      t("today.detail.crewAway", {
        name: person.fullName,
        dates: awayDatesText(person.blocks, locale),
      }),
    )
    .join(" ");
}

/**
 * The same fact once the boat has left (H-80, issue #1814): one sentence per
 * other departure saying who went out aboard while also rostered there, then
 * the one thing to do about it from ashore, said once.
 */
export function crewClashSailedDetailText(
  t: StaffTranslator,
  locale: string,
  clashes: readonly { fullName: string; otherTitle: string }[],
): string {
  return [
    ...clashGroups(locale, clashes).map((group) => t("today.detail.crewClashSailed", group)),
    t("today.detail.crewClashSailedConfirm"),
  ].join(" ");
}

/**
 * A course session with nobody in the water (issue #1338) — the state that is
 * {@link uncrewedDepartureDetailText} and {@link instructorMissingDetailText}
 * at once.
 *
 * It carries both facts because they are two different phone calls. "No crew"
 * alone invites rostering whoever is free, and a divemaster cannot run a
 * training dive or sign anybody off; "no instructor" alone reads, beside an
 * empty boat, as though a divemaster is already aboard. The chip
 * (`actionKind.uncrewedCourse`) is 21 characters, shorter than the
 * "Course needs instructor" that already fits the staffing week's 135px
 * column.
 */
export function uncrewedCourseDetailText(t: StaffTranslator, divers: number): string {
  return t("today.detail.uncrewedCourse", { divers });
}

/**
 * `divemasterRatioGap`'s `divemasterCount > 0` case — under the shop's own
 * target, but not empty. Quieter than {@link uncrewedDepartureDetailText}
 * (`crew_below_target`'s tone is neutral, its severity ranked with the other
 * purely-advisory rows) because the target "binds nothing"
 * (src/lib/divemaster-ratio.ts) — this is a nudge, not a problem.
 */
export function crewBelowTargetDetailText(
  t: StaffTranslator,
  divers: number,
  divemasterCount: number,
  ratio: number,
): string {
  return t("today.detail.crewBelowTarget", { divers, divemasterCount, ratio });
}

/**
 * Why a supervision row fired on a crew that looks complete (issue #1853):
 * the people rostered on it whose recorded rating lapses before the departure,
 * and so count for less than their role says. Without it the row read "No
 * instructor assigned" beside an instructor's name on the crew list.
 */
export function ratingLapsedDetailText(
  t: StaffTranslator,
  locale: string,
  lapsed: readonly { fullName: string }[],
): string {
  const names = cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
    lapsed.map((member) => member.fullName),
  );
  return t("today.detail.ratingLapsed", { names, count: lapsed.length });
}

/**
 * The `over_ratio` half of `courseCrewGap` (src/lib/course-ratios.ts) — an
 * instructor is on the crew, but not enough for the booked count.
 *
 * Two functions, because the two ratios need different words: the entry-level
 * cap is PADI's published Open Water training figure and a certified assistant
 * raises it, while the intro (DSD/Try Scuba) cap is PADI's tighter published
 * Discover Scuba open-water figure that an assistant does not move at all. Pick
 * with the gap's `ratio` field — one generic sentence told a manager looking at
 * a cap of 2 that PADI publishes "8 per instructor, +2 per certified
 * assistant", and prescribed a fix (add a divemaster) that cannot move an intro
 * cap at all.
 */
export function overRatioDetailText(t: StaffTranslator, booked: number, capacity: number): string {
  return t("today.detail.overRatio", { booked, capacity });
}

/**
 * The intro-session (`ratio: "intro"`) wording of the same gap. See
 * `overRatioDetailText`.
 *
 * The per-instructor figure is interpolated from `DSD_RATIO` rather than written
 * into the message bundle, so the sourced number (HD-6) lives in exactly one
 * place and the copy cannot drift away from the cap the gate enforces — which is
 * how the previous string ended up citing a figure the code no longer used.
 */
export function overRatioIntroDetailText(
  t: StaffTranslator,
  booked: number,
  capacity: number,
): string {
  return t("today.detail.overRatioIntro", {
    booked,
    capacity,
    perInstructor: DSD_RATIO.openWaterStudentsPerInstructor,
  });
}

/**
 * The unclosed head count (DOM-H3), one whole ICU message per case rather than
 * a sentence stitched from fragments (task 34's rule).
 *
 * There is deliberately **no shared string** across the reasons — including
 * between a diver's and a crew member's. A diver marked not back aboard after
 * dive one, a divemaster who has not surfaced, and a dock count nobody finished
 * are different events, and wording them the same is what turns the row into
 * wallpaper — at which point the one that means "a person may be in the water"
 * stops being read at all. The crew sentences say *crew*, because the first
 * thing the person reading it has to know is who to go looking for.
 */
export function rollCallGapDetailText(
  t: StaffTranslator,
  gap: {
    reason: RollCallGapReason;
    diveNumber: number;
    uncounted: number;
    total: number;
    underway: boolean;
    stale: boolean;
  },
): string {
  const { dive, uncounted, total } = {
    dive: gap.diveNumber,
    uncounted: gap.uncounted,
    total: gap.total,
  };
  switch (gap.reason) {
    case "missing_diver":
      return t(gap.stale ? "today.detail.missingDiverStale" : "today.detail.missingDiver", {
        dive,
        uncounted,
        total,
      });
    case "missing_crew":
      return t(gap.stale ? "today.detail.missingCrewStale" : "today.detail.missingCrew", {
        dive,
        uncounted,
        total,
      });
    case "after_dive_uncounted":
      return t(
        gap.stale
          ? "today.detail.openRollCallStale"
          : gap.underway
            ? "today.detail.openRollCallUnderway"
            : "today.detail.openRollCall",
        { dive, uncounted, total },
      );
    case "crew_uncounted":
      return t(
        gap.stale
          ? "today.detail.openCrewRollCallStale"
          : gap.underway
            ? "today.detail.openCrewRollCallUnderway"
            : "today.detail.openCrewRollCall",
        { dive, uncounted, total },
      );
    case "departure_uncounted":
      return t("today.detail.departureCountOpen", { uncounted, total });
    case "no_roll_call":
      return t("today.detail.noRollCall", { total });
  }
}

/** The unclosed-roll-call row's action label — it opens the checkpoint that is open. */
export function openRollCallActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openRollCall");
}

/** The single-diver contact row leads with the diver's name; the detail then carries only the gap. */
export function missingContactNamedDetailText(t: StaffTranslator): string {
  return t("today.detail.missingContactNamed");
}

export function seatWantedDetailText(t: StaffTranslator, seats: number, waiting: number): string {
  return t("today.detail.seatWanted", { seats, waiting });
}

/**
 * The email-delivery row's sentence, for one diver or for a batch: whole ICU
 * messages per email kind and status, never a sentence stitched from a
 * fragment. A batch is every failed email of one kind and one status in the
 * window, so "3 confirmation emails didn’t send." is one row, not three.
 */
export function emailDeliveryDetailText(
  t: StaffTranslator,
  isWaiver: boolean,
  // Widened past the two rows this action kind is meant for: the query's
  // provider-status branch can technically surface other delivery statuses,
  // and the original code's fallback branch treated all of them as "failed".
  status: "sent" | "failed" | "not_configured",
  count: number,
): string {
  if (status === "not_configured") {
    return t(
      isWaiver ? "today.email.notConfigured.waiver" : "today.email.notConfigured.confirmation",
      { count },
    );
  }
  return t(isWaiver ? "today.email.failed.waiver" : "today.email.failed.confirmation", { count });
}

/**
 * A stuck operation's kind word ("Invoice", "Refund", "Checkout"), matching
 * Orders' own wording. Keyed by the `payment_operation_kind` enum rather than
 * by `string`, so a fourth kind is a compile error here instead of a Stripe
 * enum value standing in for a word on the queue.
 */
const STUCK_OPERATION_KIND_KEYS: Record<PaymentOperationKind, StaffMessageKey> = {
  checkout_session: "today.opsAlert.operationKind.checkoutSession",
  invoice: "today.opsAlert.operationKind.invoice",
  refund: "today.opsAlert.operationKind.refund",
};

/**
 * A stuck photo-deletion's media kind, matching Settings' own wording.
 *
 * Keyed by the `media_deletion_kind` enum, which is what closes the gap this
 * map shipped with: it held seven of the enum's nine kinds, and
 * `listPendingMediaDeletions` filters by shop and staleness and by nothing
 * else, so a stuck shop-logo or cover-photo deletion — both queued from
 * Settings' own image forms — put the raw `shop_logo` through as the Today
 * row's subject and again inside its sentence. `certification_card` is
 * unreachable and keeps its word anyway, for the reason `src/db/schema.ts`
 * gives at the enum: Postgres cannot drop an enum member, so a pre-release row
 * still renders.
 */
const MEDIA_DELETION_KIND_KEYS: Record<MediaDeletionKind, StaffMessageKey> = {
  course_photo: "today.opsAlert.mediaKind.coursePhoto",
  recap_photo: "today.opsAlert.mediaKind.recapPhoto",
  arrival_photo: "today.opsAlert.mediaKind.arrivalPhoto",
  // Queued by diver erasure (ADR 20260802-diver-data-erasure).
  certification_card: "today.opsAlert.mediaKind.certificationCard",
  waiver_document: "today.opsAlert.mediaKind.waiverDocument",
  dive_site_photo: "today.opsAlert.mediaKind.diveSitePhoto",
  shop_logo: "today.opsAlert.mediaKind.shopLogo",
  shop_hero: "today.opsAlert.mediaKind.shopHero",
  payment_receipt: "today.opsAlert.mediaKind.paymentReceipt",
};

/** A stuck operation's kind word, standalone — `src/db/today.ts` uses this for the row's `subject`. */
export function stuckOperationKindText(
  t: StaffTranslator,
  operationKind: PaymentOperationKind,
): string {
  return t(STUCK_OPERATION_KIND_KEYS[operationKind]);
}

/** A failed deletion's media kind word, standalone — `src/db/today.ts` uses this for the row's `subject`. */
export function mediaDeletionKindText(t: StaffTranslator, mediaKind: MediaDeletionKind): string {
  return t(MEDIA_DELETION_KIND_KEYS[mediaKind]);
}

/**
 * A stuck Stripe operation's detail line (task 157) — the chore the Orders
 * index's payment-ops panel owns, surfaced here as an `urgency: "now"` row.
 *
 * **No Stripe object id.** It used to end in "(Stripe: cs_e2e_stuck)", which
 * is the machinery wearing a staff sentence (principle 4, "never surface the
 * implementation"): nobody types a session id into anything from this page.
 * The id still rides the Orders queue, where the object it names is, and where
 * a reconciliation actually happens.
 */
export function stuckPaymentOperationDetailText(
  t: StaffTranslator,
  operationKind: PaymentOperationKind,
  when: string,
): string {
  return t("today.opsAlert.stuckDetail", {
    kind: stuckOperationKindText(t, operationKind),
    when,
  });
}

/**
 * A failed/stuck photo-deletion's detail line (task 157), mirroring Settings'
 * media-deletions queue. The media kind is the row's own `subject` and the
 * queued-at date is bookkeeping, so neither is repeated here: what a staffer
 * cannot see without the sentence is that the file outlived the record.
 */
export function failedPhotoDeletionDetailText(t: StaffTranslator): string {
  return t("today.opsAlert.mediaDeletionDetail");
}

/**
 * A refund the shop owes for a departure it cancelled — the diver's name is the
 * row's subject, so this line carries the amount and the departure it was for.
 */
export function owedRefundDetailText(
  t: StaffTranslator,
  input: { amount: string | null; tripTitle: string; when: string },
): string {
  return input.amount === null
    ? t("today.opsAlert.owedRefundDetailNoAmount", {
        tripTitle: input.tripTitle,
        when: input.when,
      })
    : t("today.opsAlert.owedRefundDetail", {
        amount: input.amount,
        tripTitle: input.tripTitle,
        when: input.when,
      });
}

/**
 * The same money, for a departure that owes several divers at once (principle
 * 9). Five consecutive rows each repeating "You cancelled the departure and
 * the money couldn’t go back by card" is one fact said five times; the group
 * says it once and names who is waiting.
 */
export function owedRefundGroupSubjectText(t: StaffTranslator, count: number): string {
  return t("today.opsAlert.owedRefundGroupSubject", { count });
}

export function owedRefundGroupDetailText(
  t: StaffTranslator,
  input: { amount: string | null; tripTitle: string; when: string; names: string },
): string {
  return input.amount === null
    ? t("today.opsAlert.owedRefundGroupDetailNoAmount", {
        tripTitle: input.tripTitle,
        when: input.when,
        names: input.names,
      })
    : t("today.opsAlert.owedRefundGroupDetail", {
        amount: input.amount,
        tripTitle: input.tripTitle,
        when: input.when,
        names: input.names,
      });
}

/**
 * A stuck payment operation's action label when there's no trip to point at
 * instead — the Orders index, which carries the reconciliation panel these rows
 * mirror. (It used to say "Reports"; the queue moved when the monthly report
 * became only a report.)
 */
/**
 * The pending-reviews queue row: how many divers are waiting to be heard.
 *
 * The count *is* the row. The line under it ("Divers wrote about their trips.
 * Publish the good words or hide the rest.") taught the feature to somebody
 * who had already found it, every morning, forever — copy-restraint's fifth
 * deletion.
 */
/**
 * The unfiled incident report line (safety sheet 2026-10-15, item 3): how many
 * drafts sit unfiled, and who started the oldest and when. `day` says how
 * `when` reads: `relative` ("today", "yesterday"), `weekday` ("Tuesday"),
 * `date` ("Oct 12"), so each language can put its own word before a date.
 */
export function incidentReportUnfiledSubjectText(
  t: StaffTranslator,
  input: { count: number; name: string; when: string; day: "relative" | "weekday" | "date" },
): string {
  return t("today.incidentReportUnfiled.subject", input);
}

/**
 * When a draft was started, the way the desk says it: "today" or "yesterday",
 * the weekday within the past week ("Tuesday"), else the date ("Oct 12"). In
 * the shop's zone, by calendar day.
 */
export function incidentDraftStartedWhen(
  startedAt: Date,
  now: Date,
  locale: string,
  timeZone: string,
): { day: "relative" | "weekday" | "date"; when: string } {
  const daysAgo = calendarDaysBetween(
    calendarDateInTimezone(startedAt, timeZone),
    calendarDateInTimezone(now, timeZone),
  );
  if (daysAgo >= 0 && daysAgo <= 1) {
    return { day: "relative", when: formatRelativeDay(startedAt, now, locale, timeZone) };
  }
  if (daysAgo > 1 && daysAgo < 7) {
    return { day: "weekday", when: formatWeekday(startedAt, locale, timeZone) };
  }
  return { day: "date", when: formatShortDate(startedAt, locale, timeZone) };
}

export function openIncidentReportActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openIncidentReport");
}

export function reviewsPendingSubjectText(t: StaffTranslator, count: number): string {
  return t("today.reviewsPending.subject", { count });
}

export function openReviewsActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openReviews");
}

/**
 * The unanswered-inbox row (ADR 20260907-two-way-inbox): how many divers wrote
 * and are still waiting. One row for the whole inbox, never one per message —
 * the same shape the reviews queue above takes, and for the same reason. And,
 * for the same reason as the reviews row, the count is the whole row: the
 * second sentence named the surface the tap already opens.
 */
/** What is waiting on an answer: messages, open date requests, or both (issue #2658). */
export function unansweredMessagesSubjectText(
  t: StaffTranslator,
  { messages, dateRequests }: { messages: number; dateRequests: number },
): string {
  if (dateRequests === 0) return t("today.unansweredMessages.subject", { count: messages });
  if (messages === 0) {
    return t("today.unansweredMessages.subjectDateRequests", { count: dateRequests });
  }
  return t("today.unansweredMessages.subjectBoth", { messages, requests: dateRequests });
}

export function openDateRequestsActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openRequests");
}

export function openInboxActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openInbox");
}

/**
 * The units row: the one first-run question a trading shop can still have open.
 *
 * Worded as a question about *money, depth and temperature* (the three units
 * the first-run checklist names too, issue #2571), not about a settings page —
 * "confirm your units" says nothing a reader could act on, while the currency a
 * card is charged in is the fact that makes this worth a row at all (#835).
 */
export function unitsUnconfirmedSubjectText(
  t: StaffTranslator,
  input: { currency: string; depthUnit: DepthUnit; temperatureUnit: TemperatureUnit },
): string {
  return t("today.unitsUnconfirmed.subject", {
    currency: input.currency,
    depth: t(
      input.depthUnit === "feet" ? "today.unitsUnconfirmed.feet" : "today.unitsUnconfirmed.meters",
    ),
    temperature: t(
      input.temperatureUnit === "fahrenheit"
        ? "today.unitsUnconfirmed.fahrenheit"
        : "today.unitsUnconfirmed.celsius",
    ),
  });
}

export function unitsUnconfirmedDetailText(t: StaffTranslator): string {
  return t("today.unitsUnconfirmed.detail");
}

export function openUnitsActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openUnits");
}

export function openOrdersActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openOrders");
}

export function openOrderActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openOrder");
}

/**
 * A card dispute's row (ADR 20261009-stripe-reversals-reach-diveday). The
 * subject is the diver; this line is what the owner has to act on — how much,
 * and the day Stripe stops taking evidence. A dispute with no deadline (an
 * inquiry Stripe is still handling) says only where to answer it.
 */
export function paymentDisputeDetailText(
  t: StaffTranslator,
  input: { amount: string; due: string | null },
): string {
  return input.due === null
    ? t("today.opsAlert.disputeDetailNoDeadline", { amount: input.amount })
    : t("today.opsAlert.disputeDetail", { amount: input.amount, due: input.due });
}

/** A dispute's subject when no diver can be named for it. */
export function paymentDisputeSubjectText(t: StaffTranslator): string {
  return t("today.opsAlert.disputeSubject");
}

/** Stripe turned card payments off (batch 6 item 8): the row's subject. */
export function paymentsRestrictedSubjectText(t: StaffTranslator): string {
  return t("today.opsAlert.restrictedSubject");
}

/** Since when, and what divers do meanwhile; Stripe's reason stays in Stripe. */
export function paymentsRestrictedDetailText(t: StaffTranslator, when: string): string {
  return t("today.opsAlert.restrictedDetail", { when });
}

export function openPaymentSettingsActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openPaymentSettings");
}

/**
 * A stuck photo-deletion's action label — Settings' "Data"
 * group, where the retry button for it now lives.
 */
export function openDataSettingsActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openDataSettings");
}

export function openPrepListActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openPrepList");
}

/**
 * The small day-of hand-off row, kept as codes here so staff copy stays
 * localized. The row leads with the diver's name, as every person row does,
 * so the sentence never repeats it (fourth review, item 43).
 */
export function helpRequestDetailText(
  t: StaffTranslator,
  input: {
    kind: "carry_gear" | "first_timer" | "find_group";
    status: "requested" | "acknowledged";
    helperPersonName?: string | null;
  },
): string {
  const help = t(
    input.kind === "carry_gear"
      ? "today.helpRequest.kind.carryGear"
      : input.kind === "first_timer"
        ? "today.helpRequest.kind.firstTimer"
        : "today.helpRequest.kind.findGroup",
  );
  return t(
    input.helperPersonName
      ? "today.helpRequest.detailAssigned"
      : "today.helpRequest.detailRequested",
    input.helperPersonName ? { help, name: input.helperPersonName } : { help },
  );
}

/** One handled help request on the Today "Handled" line: who, what help, which departure, who helped. */
export function handledHelpRequestText(
  t: StaffTranslator,
  input: {
    kind: "carry_gear" | "first_timer" | "find_group";
    personName: string;
    tripLabel: string;
    helperPersonName: string | null;
  },
): string {
  const help = t(
    input.kind === "carry_gear"
      ? "today.helpRequest.kind.carryGear"
      : input.kind === "first_timer"
        ? "today.helpRequest.kind.firstTimer"
        : "today.helpRequest.kind.findGroup",
  );
  const values = { name: input.personName, help, trip: input.tripLabel };
  return input.helperPersonName
    ? t("today.helpRequest.handled.rowWithHelper", { ...values, helper: input.helperPersonName })
    : t("today.helpRequest.handled.row", values);
}

/** The label `HelpRequestControl` opens its crew choice with; the row hands it over. */
export function helpRequestActionText(
  t: StaffTranslator,
  helperPersonName: string | null | undefined,
): string {
  return t(helperPersonName ? "today.helpRequest.changeHelper" : "today.helpRequest.arrangeHelp");
}

/** Where the departure meets, as one bundle sentence the translator controls. */
export function helpRequestMeetingText(t: StaffTranslator, where: string): string {
  return t("today.helpRequest.meetingLine", { where });
}

export function openTripActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openTrip");
}

/**
 * A day station renders every row about one departure under one heading, so
 * two rows both saying "Open trip" are two links a screen reader announces
 * identically and that go to different places — the crew anchor and the
 * last-minute deal panel co-occur on exactly the departure that is short of
 * crew *and* short of divers. Each row's door names where it goes instead.
 */
export function openCrewActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openCrew");
}

export function offerSeatActionText(t: StaffTranslator): string {
  return t("today.actionLabel.offerSeat");
}

export function emailResendActionText(
  t: StaffTranslator,
  isWaiver: boolean,
  grouped = false,
): string {
  if (grouped) {
    return t(isWaiver ? "today.email.resendWaivers" : "today.email.resendConfirmations");
  }
  return t(
    isWaiver ? "today.actionLabel.resendWaiverLink" : "today.actionLabel.resendConfirmation",
  );
}

/**
 * The gear register's queue rows (ADR 20260815-minimal-gear-register). The
 * diver's name is an overdue/due-back row's subject, so the detail carries
 * the units and the window; a service row's subject is the unit itself.
 *
 * One row per diver, not per unit: three pieces of one kit that never came
 * home are one phone call, and three rows saying the same name read as three
 * people. The units are joined through `Intl.ListFormat`; a diver whose units
 * fell due on different days gets one sentence per day, because averaging the
 * date would invent one.
 */
export function gearOverdueDetailText(
  t: StaffTranslator,
  locale: string,
  input: { unitLabels: readonly string[]; dueOn: string },
): string {
  return t("today.gear.overdueDetail", gearUnitsParams(locale, input));
}

/**
 * **Who is bringing gear back today**, as one row's subject (Aaron,
 * 2026-10-09): up to three names, joined through `Intl.ListFormat`, else a
 * count. The units are not named; the Rentals list the row opens has them.
 */
export function gearDueBackSubjectText(
  t: StaffTranslator,
  locale: string,
  names: readonly string[],
): string {
  return names.length <= 3
    ? cachedListFormat(locale, { type: "conjunction" }).format(names)
    : t("today.gear.dueBackPeople", { count: names.length });
}

export function gearDueBackDetailText(t: StaffTranslator): string {
  return t("today.gear.dueBackDetail");
}

function gearUnitsParams<T extends { unitLabels: readonly string[] }>(
  locale: string,
  input: T,
): Omit<T, "unitLabels"> & { units: string; count: number } {
  const { unitLabels, ...rest } = input;
  return {
    ...rest,
    units: cachedListFormat(locale, { type: "conjunction" }).format(unitLabels),
    count: unitLabels.length,
  };
}

/**
 * The evening's rental-fit question (issue #1174, D14).
 *
 * It names the **size that went out**, never a direction. `gear_items.size` is
 * free text a shop writes for itself ("M", "3mm L"), so the app cannot know
 * that L is a size up from M, and the artboard's "went out a size up" is a
 * sentence only a human could have written truthfully.
 */
export function rentalFitConfirmDetailText(
  t: StaffTranslator,
  input: { personName: string; unitLabel: string; size: string },
): string {
  return t("today.gear.fitConfirmDetail", {
    name: input.personName,
    unitLabel: input.unitLabel,
    size: input.size,
  });
}

export function gearNeverPickedUpDetailText(
  t: StaffTranslator,
  locale: string,
  input: { unitLabels: readonly string[]; dueOn: string },
): string {
  return t("today.gear.neverPickedUpDetail", gearUnitsParams(locale, input));
}

export function gearServiceDueDetailText(
  t: StaffTranslator,
  input: { clockLabel: string; overdue: boolean; dueOn: string },
): string {
  return t(input.overdue ? "today.gear.serviceOverdueDetail" : "today.gear.serviceDueDetail", {
    clockLabel: input.clockLabel,
    dueOn: input.dueOn,
  });
}

export function openGearRegisterActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openGearRegister");
}

export function openRentalsActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openRentals");
}

export function openGearUnitActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openGearUnit");
}

/** A departure's Boat tab, where the pre-departure check names the kit aboard. */
/**
 * A snag's row (fifth-loop ideas, item 1): the line and what is wrong, then
 * who wrote it and how many departures have sailed with it since.
 */
export function boatSnagDetailText(
  t: StaffTranslator,
  snag: { itemLabel: string; note: string; notedByName: string; departuresSince: number },
): string {
  return t("today.detail.boatSnag", {
    item: snag.itemLabel,
    // The sentence closes the note itself; a crew's own full stop would double it.
    note: snag.note.replace(/[.\s]+$/u, ""),
    name: snag.notedByName,
    count: snag.departuresSince,
  });
}

export function openBoatCheckActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openBoatCheck");
}

/** The fleet page, where a boat's papers are renewed. */
export function openBoatsActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openBoats");
}

/** A bench ticket still being worked after the day the shop promised it. */
export function workOrderLateDetailText(t: StaffTranslator, input: { promisedOn: string }): string {
  return t("benchFollowUp.today.pastPromise", { date: input.promisedOn });
}

/** A bench ticket ready for a week or more that nobody has collected. */
export function workOrderUncollectedDetailText(
  t: StaffTranslator,
  input: { readyOn: string },
): string {
  return t("benchFollowUp.today.uncollected", { date: input.readyOn });
}

export function openWorkOrderActionText(t: StaffTranslator): string {
  return t("benchFollowUp.today.openTicket");
}

/** Where a row about one diver points when its own control is not the answer. */
export function openDiverActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openDiver");
}

export function staffCredentialDueDetailText(
  t: StaffTranslator,
  input: { credential: string; dueOn: string; overdue: boolean },
): string {
  return t(
    input.overdue ? "today.staffCredential.overdueDetail" : "today.staffCredential.dueDetail",
    { credential: input.credential, dueOn: input.dueOn },
  );
}

export function openStaffingActionText(t: StaffTranslator): string {
  return t("today.actionLabel.openStaffing");
}

/** The one-line "how's my day?" headline, resolved from `summarizeDay`'s code. */
/**
 * The day spine's one summary sentence: how many boats today, how many things
 * are still open, and the next departure that has not left yet — "3 boats
 * today. 2 things need you before the 7:00 AM leaves the dock." (ADR
 * 20260827-clearwater-surface-language, decision 4).
 *
 * Two clauses, two keys, because the second one has a different sentence once
 * every boat is away: "before the 7:00 leaves the dock" is a deadline, and a
 * deadline that has passed is not a smaller version of itself. `time` is
 * already formatted in the shop's own zone by the caller — this file never
 * touches a clock.
 *
 * It renders nothing for a shop still in first-run: it has nothing true to say
 * that the setup ledger beneath it does not already say (issue #711), and
 * nothing at all on a day with no departures, where the page collapses to its
 * own quiet state instead (principles.md's whole-page-empty rule).
 */
export function daySpineSummaryText(
  t: StaffTranslator,
  summary: {
    boats: number;
    blocked?: number;
    blockedTomorrow?: number;
    jobs: number;
    nextDepartureTime: string | null;
  },
): string | null {
  if (summary.boats === 0) return null;
  // **The blocked figures add up to the Today row's badge** (UX audit
  // 2026-10-07, item 1; `blockedOnNextBoatDay`). `blocked` is today's: the
  // cards' "N blocked" while a boat is still to sail, plus divers blocked
  // aboard a boat still out. `blockedTomorrow` is set once today's boats are
  // all away, when the badge has moved on to tomorrow's departures, so the
  // sentence names that day rather than counting tomorrow's divers as today's.
  const blocked = summary.blocked ?? 0;
  const tomorrow = summary.blockedTomorrow ?? 0;
  const boats =
    blocked > 0 && tomorrow > 0
      ? t("shopHome.spine.summaryBoatsBlockedAboardAndTomorrow", {
          count: summary.boats,
          blocked,
          tomorrow,
        })
      : tomorrow > 0
        ? t("shopHome.spine.summaryBoatsBlockedTomorrow", { count: summary.boats, tomorrow })
        : blocked > 0
          ? t("shopHome.spine.summaryBoatsBlocked", { count: summary.boats, blocked })
          : t("shopHome.spine.summaryBoats", { count: summary.boats });
  const jobs = summary.nextDepartureTime
    ? t("shopHome.spine.summaryNext", {
        count: summary.jobs,
        time: summary.nextDepartureTime,
      })
    : t("shopHome.spine.summaryAfter", { count: summary.jobs });
  // The boat count is a clause of this paragraph, not a standalone status.
  // Its bundle period separates it from the job sentence in both locales.
  return `${boats} ${jobs}`;
}

/** Who the stale-roll-call alert reached, and when (the owners' time first), or null. */
export function rollCallAlertedText(
  t: StaffTranslator,
  gap: { alertedAt?: Date | null; shoreAlertedAt?: Date | null },
  locale: string,
  timeZone: string,
): string | null {
  const owners = gap.alertedAt ?? null;
  const shore = gap.shoreAlertedAt ?? null;
  if (owners && shore) {
    return t("today.detail.rollCallAlertedWithShore", {
      time: formatDateTimeTz(owners, locale, timeZone),
    });
  }
  if (owners) {
    return t("today.detail.rollCallAlerted", { time: formatDateTimeTz(owners, locale, timeZone) });
  }
  if (shore) {
    return t("today.detail.rollCallShoreAlerted", {
      time: formatDateTimeTz(shore, locale, timeZone),
    });
  }
  return null;
}

/**
 * The blank emergency card's row (fifth loop, item 3): what is missing, and the
 * first boat that would sail without it, by its time and day.
 */
export function emergencyCardBlankText(
  t: StaffTranslator,
  input: { time: string; day: string },
): { subject: string; detail: string; actionLabel: string } {
  return {
    subject: t("today.emergencyCard.subject"),
    detail: t("today.emergencyCard.detail", input),
    actionLabel: t("today.emergencyCard.action"),
  };
}

/** Found items still waiting for their owners (fifth loop, item 7), as one count. */
export function lostItemsWaitingText(
  t: StaffTranslator,
  count: number,
): { subject: string; actionLabel: string } {
  return {
    subject: t("today.lostItems.subject", { count }),
    actionLabel: t("today.lostItems.action"),
  };
}
