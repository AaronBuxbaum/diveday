import type { ReadinessBlockerCode } from "@/lib/readiness";
import type {
  DaySummary,
  RollCallGapReason,
  TodayActionKind,
  TodayGreetingBand,
  TodaySeason,
  TodayUrgency,
} from "@/lib/today";
import { firstNameOf } from "@/lib/today";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/** Every `TodayUrgency` the queue groups by, to its section-heading key. */
export const URGENCY_KEYS: Record<TodayUrgency, StaffMessageKey> = {
  imminent: "shared.today.urgency.imminent",
  now: "shared.today.urgency.now",
  soon: "shared.today.urgency.soon",
  later: "shared.today.urgency.later",
};

/** Every `TodayActionKind` chip, to its label key. Tone stays in `src/lib/today.ts` (not copy). */
export const ACTION_KIND_KEYS: Record<TodayActionKind, StaffMessageKey> = {
  roll_call_missing_diver: "shared.today.actionKind.rollCallMissingDiver",
  roll_call_unfinished: "shared.today.actionKind.rollCallUnfinished",
  roll_call_departure_open: "shared.today.actionKind.rollCallDepartureOpen",
  roll_call_not_started: "shared.today.actionKind.rollCallNotStarted",
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
  stuck_payment_operation: "shared.today.actionKind.stuckPaymentOperation",
  failed_photo_deletion: "shared.today.actionKind.failedPhotoDeletion",
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

/** The remaining `src/db/today.ts` action rows, resolved through the same bundle-only rule. */

export function missingFitDetailText(t: StaffTranslator, count: number): string {
  return t("shared.today.detail.missingFit", { count });
}

export function ungatedNitroxDetailText(t: StaffTranslator, count: number): string {
  return t("shared.today.detail.ungatedNitrox", { count });
}

export function instructorMissingDetailText(t: StaffTranslator): string {
  return t("shared.today.detail.instructorMissing");
}

/**
 * The `over_ratio` half of `courseCrewGap` (src/lib/course-ratios.ts) — an
 * instructor is on the crew, but not enough for the booked count.
 *
 * Two functions, because the two ratios need different words: the entry-level
 * cap is PADI's published figure and a certified assistant raises it, while the
 * intro (DSD/Try Scuba) cap is the shop's own interim 4 per instructor that an
 * assistant does not move at all. Pick with the gap's `ratio` field — one
 * generic sentence told a manager looking at a cap of 4 that PADI publishes "8
 * per instructor, +2 per certified assistant", and prescribed a fix (add a
 * divemaster) that cannot move an intro cap at all.
 */
export function overRatioDetailText(t: StaffTranslator, booked: number, capacity: number): string {
  return t("shared.today.detail.overRatio", { booked, capacity });
}

/** The intro-session (`ratio: "intro"`) wording of the same gap. See `overRatioDetailText`. */
export function overRatioIntroDetailText(
  t: StaffTranslator,
  booked: number,
  capacity: number,
): string {
  return t("shared.today.detail.overRatioIntro", { booked, capacity });
}

/**
 * The unclosed head count (DOM-H3), one whole ICU message per case rather than
 * a sentence stitched from fragments (task 34's rule).
 *
 * There is deliberately **no shared string** across the four reasons. A diver
 * marked not back aboard after dive one and a dock count nobody finished are
 * different events, and wording them the same is what turns the row into
 * wallpaper — at which point the one that means "a person may be in the water"
 * stops being read at all.
 */
export function rollCallGapDetailText(
  t: StaffTranslator,
  gap: {
    reason: RollCallGapReason;
    diveNumber: number;
    uncounted: number;
    totalDivers: number;
    underway: boolean;
    stale: boolean;
  },
): string {
  const { dive, uncounted, total } = {
    dive: gap.diveNumber,
    uncounted: gap.uncounted,
    total: gap.totalDivers,
  };
  switch (gap.reason) {
    case "missing_diver":
      return t(
        gap.stale ? "shared.today.detail.missingDiverStale" : "shared.today.detail.missingDiver",
        { dive, uncounted, total },
      );
    case "after_dive_uncounted":
      return t(
        gap.stale
          ? "shared.today.detail.openRollCallStale"
          : gap.underway
            ? "shared.today.detail.openRollCallUnderway"
            : "shared.today.detail.openRollCall",
        { dive, uncounted, total },
      );
    case "departure_uncounted":
      return t("shared.today.detail.departureCountOpen", { uncounted, total });
    case "no_roll_call":
      return t("shared.today.detail.noRollCall", { total });
  }
}

/** The unclosed-roll-call row's action label — it opens the checkpoint that is open. */
export function openRollCallActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openRollCall");
}

export function missingContactDetailText(t: StaffTranslator, count: number): string {
  return t("shared.today.detail.missingContact", { count });
}

export function lastMinuteFillDetailText(t: StaffTranslator, seats: number): string {
  return t("shared.today.detail.lastMinuteFill", { seats });
}

export function waitlistSeatDetailText(t: StaffTranslator, seats: number, waiting: number): string {
  return t("shared.today.detail.waitlistSeat", { seats, waiting });
}

/**
 * The two email-delivery detail sentences, kept as four whole ICU messages
 * (waiver × confirmation, for each status) rather than one sentence stitched
 * from a fragment — task 34's de-fragmentation rule applies here too.
 */
export function emailDeliveryDetailText(
  t: StaffTranslator,
  isWaiver: boolean,
  // Widened past the two rows this action kind is meant for: the query's
  // provider-status branch can technically surface other delivery statuses,
  // and the original code's fallback branch treated all of them as "failed".
  status: "sent" | "failed" | "not_configured",
  attempts: number,
): string {
  if (status === "not_configured") {
    return t(
      isWaiver
        ? "shared.today.detail.emailNotConfigured.waiver"
        : "shared.today.detail.emailNotConfigured.confirmation",
    );
  }
  return t(
    isWaiver
      ? "shared.today.detail.emailFailed.waiver"
      : "shared.today.detail.emailFailed.confirmation",
    { attempts },
  );
}

/** A stuck operation's kind word ("Invoice", "Refund", "Checkout"), matching Reports' own wording. */
const STUCK_OPERATION_KIND_KEYS: Record<string, StaffMessageKey> = {
  checkout_session: "shared.today.opsAlert.operationKind.checkoutSession",
  invoice: "shared.today.opsAlert.operationKind.invoice",
  refund: "shared.today.opsAlert.operationKind.refund",
};

/** A stuck photo-deletion's media kind, matching Reports' own wording. */
const MEDIA_DELETION_KIND_KEYS: Record<string, StaffMessageKey> = {
  course_photo: "shared.today.opsAlert.mediaKind.coursePhoto",
  recap_photo: "shared.today.opsAlert.mediaKind.recapPhoto",
  // Queued by diver erasure (ADR 20260802-diver-data-erasure) — see the same
  // note on Reports' `MEDIA_KIND_KEYS`: a missing entry renders the raw enum.
  certification_card: "shared.today.opsAlert.mediaKind.certificationCard",
  waiver_document: "shared.today.opsAlert.mediaKind.waiverDocument",
};

/** A stuck operation's kind word, standalone — `src/db/today.ts` uses this for the row's `subject`. */
export function stuckOperationKindText(t: StaffTranslator, operationKind: string): string {
  return STUCK_OPERATION_KIND_KEYS[operationKind]
    ? t(STUCK_OPERATION_KIND_KEYS[operationKind])
    : operationKind;
}

/** A failed deletion's media kind word, standalone — `src/db/today.ts` uses this for the row's `subject`. */
export function mediaDeletionKindText(t: StaffTranslator, mediaKind: string): string {
  return MEDIA_DELETION_KIND_KEYS[mediaKind] ? t(MEDIA_DELETION_KIND_KEYS[mediaKind]) : mediaKind;
}

/**
 * A stuck Stripe operation's detail line (task 157) — the same "check it
 * against the Stripe dashboard" chore Reports' payment-ops panel already
 * explains, now also surfaced on Today as an `urgency: "now"` row. Two whole
 * ICU messages, not one stitched from a fragment (task 34's rule), because the
 * Stripe-id clause only exists on one branch.
 */
export function stuckPaymentOperationDetailText(
  t: StaffTranslator,
  operationKind: string,
  when: string,
  stripeObjectId: string | null,
): string {
  const kind = stuckOperationKindText(t, operationKind);
  return stripeObjectId
    ? t("shared.today.opsAlert.stuckDetail.withId", { kind, when, id: stripeObjectId })
    : t("shared.today.opsAlert.stuckDetail.withoutId", { kind, when });
}

/** A failed/stuck photo-deletion's detail line (task 157), mirroring Reports' media-deletions panel. */
export function failedPhotoDeletionDetailText(
  t: StaffTranslator,
  mediaKind: string,
  when: string,
): string {
  return t("shared.today.opsAlert.mediaDeletionDetail", {
    kind: mediaDeletionKindText(t, mediaKind),
    when,
  });
}

/** The ops-alert rows' action label when there's no trip to point at instead. */
export function openReportsActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openReports");
}

export function openPrepListActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openPrepList");
}

export function openTripActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openTrip");
}

export function openGuestsActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openGuests");
}

export function inviteFromWaitlistActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.inviteFromWaitlist");
}

export function emailResendActionText(t: StaffTranslator, isWaiver: boolean): string {
  return t(
    isWaiver
      ? "shared.today.actionLabel.resendWaiverLink"
      : "shared.today.actionLabel.resendConfirmation",
  );
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
