import type { ReadinessBlockerCode } from "@/lib/readiness";
import type {
  DaySummary,
  TodayActionKind,
  TodayGreetingBand,
  TodaySeason,
  TodayUrgency,
} from "@/lib/today";
import { firstNameOf } from "@/lib/today";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/** Every `TodayUrgency` the queue groups by, to its section-heading key. */
export const URGENCY_KEYS: Record<TodayUrgency, StaffMessageKey> = {
  now: "shared.today.urgency.now",
  soon: "shared.today.urgency.soon",
  later: "shared.today.urgency.later",
};

/** Every `TodayActionKind` chip, to its label key. Tone stays in `src/lib/today.ts` (not copy). */
export const ACTION_KIND_KEYS: Record<TodayActionKind, StaffMessageKey> = {
  medical_review: "shared.today.actionKind.medicalReview",
  readiness_unavailable: "shared.today.actionKind.readinessUnavailable",
  identity: "shared.today.actionKind.identity",
  certification: "shared.today.actionKind.certification",
  requirements: "shared.today.actionKind.requirements",
  waiver: "shared.today.actionKind.waiver",
  instructor_missing: "shared.today.actionKind.instructorMissing",
  nitrox_gate: "shared.today.actionKind.nitroxGate",
  dive_prep: "shared.today.actionKind.divePrep",
  payment: "shared.today.actionKind.payment",
  email_delivery: "shared.today.actionKind.emailDelivery",
  waitlist_seat: "shared.today.actionKind.waitlistSeat",
  last_minute_fill: "shared.today.actionKind.lastMinuteFill",
  emergency_contact: "shared.today.actionKind.emergencyContact",
};

/** A blocked row's one-tap fix, singular ("Send waiver"). */
const BLOCKER_ACTION_LABEL_KEYS: Record<ReadinessBlockerCode, StaffMessageKey> = {
  requirements_not_configured: "shared.today.blockerAction.setRequirements",
  identity_unconfirmed: "shared.today.blockerAction.confirmIdentity",
  under_minimum_age: "shared.today.blockerAction.checkDateOfBirth",
  waiver_not_sent: "shared.today.blockerAction.sendWaiver",
  waiver_pending: "shared.today.blockerAction.nudgeWaiver",
  waiver_expired: "shared.today.blockerAction.reissueWaiver",
  medical_review: "shared.today.blockerAction.reviewMedical",
  certification_missing: "shared.today.blockerAction.addCard",
  certification_pending: "shared.today.blockerAction.verifyCard",
  certification_expired: "shared.today.blockerAction.updateCard",
  certification_insufficient: "shared.today.blockerAction.reviewCard",
  specialty_missing: "shared.today.blockerAction.addSpecialty",
  specialty_pending: "shared.today.blockerAction.verifySpecialty",
  specialty_expired: "shared.today.blockerAction.updateSpecialty",
  specialty_import_unconfirmed: "shared.today.blockerAction.confirmSpecialty",
  nitrox_missing: "shared.today.blockerAction.addNitroxCard",
  nitrox_pending: "shared.today.blockerAction.verifyNitroxCard",
  payment_due: "shared.today.blockerAction.takePayment",
  payment_refunded: "shared.today.blockerAction.takePayment",
  readiness_unavailable: "shared.today.blockerAction.checkReadiness",
};

/** The same fix, worded for a row that stands for several divers ("Send waivers"). */
const BLOCKER_GROUP_LABEL_KEYS: Record<ReadinessBlockerCode, StaffMessageKey> = {
  requirements_not_configured: "shared.today.blockerGroup.setRequirements",
  identity_unconfirmed: "shared.today.blockerGroup.confirmIdentities",
  under_minimum_age: "shared.today.blockerGroup.checkDatesOfBirth",
  waiver_not_sent: "shared.today.blockerGroup.sendWaivers",
  waiver_pending: "shared.today.blockerGroup.nudgeWaivers",
  waiver_expired: "shared.today.blockerGroup.reissueWaivers",
  medical_review: "shared.today.blockerGroup.reviewMedicals",
  certification_missing: "shared.today.blockerGroup.reviewCards",
  certification_pending: "shared.today.blockerGroup.verifyCards",
  certification_expired: "shared.today.blockerGroup.updateCards",
  certification_insufficient: "shared.today.blockerGroup.reviewCards",
  specialty_missing: "shared.today.blockerGroup.reviewSpecialties",
  specialty_pending: "shared.today.blockerGroup.verifySpecialties",
  specialty_expired: "shared.today.blockerGroup.updateSpecialties",
  specialty_import_unconfirmed: "shared.today.blockerGroup.confirmImportedSpecialties",
  nitrox_missing: "shared.today.blockerGroup.reviewNitroxCards",
  nitrox_pending: "shared.today.blockerGroup.verifyNitroxCards",
  payment_due: "shared.today.blockerGroup.takePayments",
  payment_refunded: "shared.today.blockerGroup.takePayments",
  readiness_unavailable: "shared.today.blockerGroup.checkReadiness",
};

/**
 * A blocked row's action-button word: the singular verb ("Send waiver") when
 * one tap sends in place, or the group verb ("Send waivers") when one row
 * stands for several divers on the same boat. Used by both the Today queue
 * (`src/lib/today.ts`) and the blocker queue (`src/lib/blockers.ts`), which
 * share the same blocker→fix rule.
 */
export function blockerActionLabelText(
  t: StaffTranslator,
  code: ReadinessBlockerCode,
  grouped: boolean,
): string {
  return t(grouped ? BLOCKER_GROUP_LABEL_KEYS[code] : BLOCKER_ACTION_LABEL_KEYS[code]);
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
    ? t("shared.today.pointingLabel.diver", { name: firstNameOf(fullName) })
    : t("shared.today.pointingLabel.trip");
}

/**
 * A blocked diver's headline blocker plus how many more they have to clear.
 * `detail` is already-translated sentence text (`readinessBlockerText`), so
 * this only supplies the trailing count clause.
 */
export function blockerDetailWithRemainingText(
  t: StaffTranslator,
  detail: string,
  remaining: number,
): string {
  return t("shared.today.blockerDetail.withRemaining", { detail, remaining });
}

/** A collapsed row's headline blocker plus the names it stands for. */
export function blockerDetailGroupText(t: StaffTranslator, detail: string, names: string): string {
  return t("shared.today.blockerDetail.group", { detail, names });
}

/** The one-line "how's my day?" headline, resolved from `summarizeDay`'s code. */
export function summarizeDayText(t: StaffTranslator, summary: DaySummary): string {
  switch (summary.code) {
    case "blocked":
      return t("shared.today.summary.blocked", {
        departures: summary.departures,
        blockedToday: summary.blockedToday,
      });
    case "clear":
      return t("shared.today.summary.clear", { departures: summary.departures });
    case "urgent":
      return t("shared.today.summary.urgent", {
        departures: summary.departures,
        urgent: summary.urgent,
      });
    case "ahead":
      return t("shared.today.summary.ahead", {
        departures: summary.departures,
        jobs: summary.jobs,
      });
  }
}

/** Every `TodayGreetingBand`, to its greeting key (`{name}` is the only placeholder). */
export const GREETING_KEYS: Record<TodayGreetingBand, StaffMessageKey> = {
  morning: "shared.today.greeting.morning",
  afternoon: "shared.today.greeting.afternoon",
  evening: "shared.today.greeting.evening",
  night: "shared.today.greeting.night",
};

const SEASONAL_BRIEFING_KEYS: Record<TodaySeason, StaffMessageKey> = {
  summer: "shared.today.seasonalBriefing.summer",
  autumn: "shared.today.seasonalBriefing.autumn",
  winter: "shared.today.seasonalBriefing.winter",
  spring: "shared.today.seasonalBriefing.spring",
};

/**
 * The seasonal briefing sentence for `season`, naming the shop when one is
 * given. `hasShop` drives the bundle's `select` so the "at {shopName}" clause
 * only appears when there is a name to put there.
 */
export function seasonalBriefingText(
  t: StaffTranslator,
  season: TodaySeason,
  shopName?: string,
): string {
  return t(SEASONAL_BRIEFING_KEYS[season], {
    hasShop: shopName ? "true" : "false",
    shopName: shopName ?? "",
  });
}
