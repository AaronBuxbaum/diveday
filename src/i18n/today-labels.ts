import { DSD_RATIO } from "@/lib/course-ratios";
import { firstNameOf } from "@/lib/person-name";
import type { ReadinessBlockerCode } from "@/lib/readiness";
import type {
  RollCallGapReason,
  TodayActionKind,
  TodayGreetingBand,
  TodaySeason,
} from "@/lib/today";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/** Every `TodayActionKind` chip, to its label key. Tone stays in `src/lib/today.ts` (not copy). */
export const ACTION_KIND_KEYS: Record<TodayActionKind, StaffMessageKey> = {
  roll_call_missing_diver: "shared.today.actionKind.rollCallMissingDiver",
  roll_call_missing_crew: "shared.today.actionKind.rollCallMissingCrew",
  roll_call_unfinished: "shared.today.actionKind.rollCallUnfinished",
  roll_call_crew_unfinished: "shared.today.actionKind.rollCallCrewUnfinished",
  roll_call_departure_open: "shared.today.actionKind.rollCallDepartureOpen",
  roll_call_not_started: "shared.today.actionKind.rollCallNotStarted",
  medical_review: "shared.today.actionKind.medicalReview",
  medical_not_cleared: "shared.today.actionKind.medicalNotCleared",
  readiness_unavailable: "shared.today.actionKind.readinessUnavailable",
  identity: "shared.today.actionKind.identity",
  certification: "shared.today.actionKind.certification",
  requirements: "shared.today.actionKind.requirements",
  waiver: "shared.today.actionKind.waiver",
  instructor_missing: "shared.today.actionKind.instructorMissing",
  uncrewed_course: "shared.today.actionKind.uncrewedCourse",
  uncrewed_departure: "shared.today.actionKind.uncrewedDeparture",
  nitrox_gate: "shared.today.actionKind.nitroxGate",
  high_wind_alert: "shared.today.actionKind.highWindAlert",
  dive_prep: "shared.today.actionKind.divePrep",
  help_request: "shared.today.actionKind.helpRequest",
  payment: "shared.today.actionKind.payment",
  email_delivery: "shared.today.actionKind.emailDelivery",
  waitlist_seat: "shared.today.actionKind.waitlistSeat",
  last_minute_fill: "shared.today.actionKind.lastMinuteFill",
  emergency_contact: "shared.today.actionKind.emergencyContact",
  crew_below_target: "shared.today.actionKind.crewBelowTarget",
  stuck_payment_operation: "shared.today.actionKind.stuckPaymentOperation",
  failed_photo_deletion: "shared.today.actionKind.failedPhotoDeletion",
  owed_refund: "shared.today.actionKind.owedRefund",
  reviews_pending: "shared.today.actionKind.reviewsPending",
  gear_overdue: "shared.today.actionKind.gearOverdue",
  gear_due_back: "shared.today.actionKind.gearDueBack",
  gear_service_due: "shared.today.actionKind.gearServiceDue",
  staff_credential_due: "shared.today.actionKind.staffCredentialDue",
  units_unconfirmed: "shared.today.actionKind.unitsUnconfirmed",
  say_hello: "shared.today.actionKind.sayHello",
  rental_fit_confirm: "shared.today.actionKind.rentalFit",
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
  // Not "review": there is nothing left to review. What the refusal creates
  // is a conversation about a seat this diver can no longer take, and the
  // label stops there rather than choosing refund or rebook for the shop.
  medical_not_cleared: "shared.today.blockerAction.contactDiver",
  certification_missing: "shared.today.blockerAction.addCard",
  certification_pending: "shared.today.blockerAction.verifyCard",
  // Never "Verify card": there is no number to look up with an agency, only a
  // level the diver typed. The work is getting the card in front of somebody.
  certification_self_declared: "shared.today.blockerAction.askForCard",
  certification_insufficient: "shared.today.blockerAction.reviewCard",
  specialty_missing: "shared.today.blockerAction.addSpecialty",
  specialty_pending: "shared.today.blockerAction.verifySpecialty",
  specialty_import_unconfirmed: "shared.today.blockerAction.confirmSpecialty",
  nitrox_missing: "shared.today.blockerAction.addNitroxCard",
  nitrox_pending: "shared.today.blockerAction.verifyNitroxCard",
  nitrox_self_declared: "shared.today.blockerAction.askForNitroxCard",
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
  medical_not_cleared: "shared.today.blockerGroup.contactDivers",
  certification_missing: "shared.today.blockerGroup.reviewCards",
  certification_pending: "shared.today.blockerGroup.verifyCards",
  certification_self_declared: "shared.today.blockerGroup.askForCards",
  certification_insufficient: "shared.today.blockerGroup.reviewCards",
  specialty_missing: "shared.today.blockerGroup.reviewSpecialties",
  specialty_pending: "shared.today.blockerGroup.verifySpecialties",
  specialty_import_unconfirmed: "shared.today.blockerGroup.confirmImportedSpecialties",
  nitrox_missing: "shared.today.blockerGroup.reviewNitroxCards",
  nitrox_pending: "shared.today.blockerGroup.verifyNitroxCards",
  nitrox_self_declared: "shared.today.blockerGroup.askForNitroxCards",
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
    ? // Falls back to the whole name rather than a word: this is a pointing
      // label ("Open Priya's record"), so an unsplittable name is still the
      // best thing to point at.
      t("shared.today.pointingLabel.diver", { name: firstNameOf(fullName, fullName) })
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
    return t("shared.today.nameList.all", {
      leading: names.slice(0, -1).join(", "),
      last: names.at(-1) ?? "",
    });
  }
  return t("shared.today.nameList.overflow", {
    leading: names.slice(0, shown).join(", "),
    rest: names.length - shown,
  });
}

/** A collapsed multi-diver row's subject — "6 divers", pluralised by the bundle. */
export function diverGroupSubjectText(t: StaffTranslator, count: number): string {
  return t("shared.today.subject.diverGroup", { count });
}

/** The remaining `src/db/today.ts` action rows, resolved through the same bundle-only rule. */

export function missingFitDetailText(t: StaffTranslator, count: number): string {
  return t("shared.today.detail.missingFit", { count });
}

export function ungatedNitroxDetailText(t: StaffTranslator, count: number): string {
  return t("shared.today.detail.ungatedNitrox", { count });
}

export function highWindAlertDetailText(
  t: StaffTranslator,
  speed: number,
  gusts: number | null,
  direction: string | null,
): string {
  return t("shared.today.detail.highWindAlert", {
    speed,
    gusts: gusts ?? 0,
    hasGusts: gusts !== null && gusts > speed ? "yes" : "no",
    direction: direction ?? "",
    hasDirection: direction ? "yes" : "no",
  });
}

export function instructorMissingDetailText(t: StaffTranslator): string {
  return t("shared.today.detail.instructorMissing");
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
  return t("shared.today.detail.uncrewedDeparture", { divers });
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
  return t("shared.today.detail.uncrewedCourse", { divers });
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
  return t("shared.today.detail.crewBelowTarget", { divers, divemasterCount, ratio });
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
  return t("shared.today.detail.overRatio", { booked, capacity });
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
  return t("shared.today.detail.overRatioIntro", {
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
      return t(
        gap.stale ? "shared.today.detail.missingDiverStale" : "shared.today.detail.missingDiver",
        { dive, uncounted, total },
      );
    case "missing_crew":
      return t(
        gap.stale ? "shared.today.detail.missingCrewStale" : "shared.today.detail.missingCrew",
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
    case "crew_uncounted":
      return t(
        gap.stale
          ? "shared.today.detail.openCrewRollCallStale"
          : gap.underway
            ? "shared.today.detail.openCrewRollCallUnderway"
            : "shared.today.detail.openCrewRollCall",
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

/** The single-diver contact row leads with the diver's name; the detail then carries only the gap. */
export function missingContactNamedDetailText(t: StaffTranslator): string {
  return t("shared.today.detail.missingContactNamed");
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
  arrival_photo: "shared.today.opsAlert.mediaKind.arrivalPhoto",
  // Queued by diver erasure (ADR 20260802-diver-data-erasure) — see the same
  // note on Reports' `MEDIA_KIND_KEYS`: a missing entry renders the raw enum.
  certification_card: "shared.today.opsAlert.mediaKind.certificationCard",
  waiver_document: "shared.today.opsAlert.mediaKind.waiverDocument",
  dive_site_photo: "shared.today.opsAlert.mediaKind.diveSitePhoto",
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

/**
 * A refund the shop owes for a departure it cancelled — the diver's name is the
 * row's subject, so this line carries the amount and the departure it was for.
 */
export function owedRefundDetailText(
  t: StaffTranslator,
  input: { amount: string | null; tripTitle: string; when: string },
): string {
  return input.amount === null
    ? t("shared.today.opsAlert.owedRefundDetailNoAmount", {
        tripTitle: input.tripTitle,
        when: input.when,
      })
    : t("shared.today.opsAlert.owedRefundDetail", {
        amount: input.amount,
        tripTitle: input.tripTitle,
        when: input.when,
      });
}

/**
 * A stuck payment operation's action label when there's no trip to point at
 * instead — the Orders index, which carries the reconciliation panel these rows
 * mirror. (It used to say "Reports"; the queue moved when the monthly report
 * became only a report.)
 */
/** The pending-reviews queue row: how many divers are waiting to be heard. */
export function reviewsPendingSubjectText(t: StaffTranslator, count: number): string {
  return t("shared.today.reviewsPending.subject", { count });
}

export function reviewsPendingDetailText(t: StaffTranslator): string {
  return t("shared.today.reviewsPending.detail");
}

export function openReviewsActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openReviews");
}

/**
 * The units row: the one first-run question a trading shop can still have open.
 *
 * Worded as a question about *money and depth*, not about a settings page —
 * "confirm your units" says nothing a reader could act on, while the currency a
 * card is charged in is the fact that makes this worth a row at all (#835).
 */
export function unitsUnconfirmedSubjectText(t: StaffTranslator): string {
  return t("shared.today.unitsUnconfirmed.subject");
}

export function unitsUnconfirmedDetailText(t: StaffTranslator, currency: string): string {
  return t("shared.today.unitsUnconfirmed.detail", { currency });
}

export function openUnitsActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openUnits");
}

export function openOrdersActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openOrders");
}

/**
 * A stuck photo-deletion's action label — Settings' "Data & integrations"
 * group, where the retry button for it now lives.
 */
export function openDataSettingsActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openDataSettings");
}

export function openPrepListActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openPrepList");
}

/** The small day-of hand-off row, kept as codes here so staff copy stays localized. */
export function helpRequestDetailText(
  t: StaffTranslator,
  input: {
    personName: string;
    kind: "carry_gear" | "first_timer" | "find_group";
    status: "requested" | "acknowledged";
  },
): string {
  const help = t(
    input.kind === "carry_gear"
      ? "shared.today.helpRequest.kind.carryGear"
      : input.kind === "first_timer"
        ? "shared.today.helpRequest.kind.firstTimer"
        : "shared.today.helpRequest.kind.findGroup",
  );
  return t(
    input.status === "acknowledged"
      ? "shared.today.helpRequest.detailAcknowledged"
      : "shared.today.helpRequest.detailRequested",
    { name: input.personName, help },
  );
}

export function helpRequestActionText(
  t: StaffTranslator,
  status: "requested" | "acknowledged",
): string {
  return t(
    status === "acknowledged"
      ? "shared.today.helpRequest.markHandled"
      : "shared.today.helpRequest.acknowledge",
  );
}

export function openTripActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openTrip");
}

/** The Say hello row's door — the departure's Guests tab (issue #1182). */
export function openGuestsActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openGuests");
}

/**
 * A day station renders every row about one departure under one heading, so
 * two rows both saying "Open trip" are two links a screen reader announces
 * identically and that go to different places — the crew anchor and the
 * last-minute deal panel co-occur on exactly the departure that is short of
 * crew *and* short of divers. Each row's door names where it goes instead.
 */
export function openCrewActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openCrew");
}

/** See {@link openCrewActionText}. */
export function openLastMinuteDealActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openLastMinuteDeal");
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

/**
 * The gear register's queue rows (ADR 20260815-minimal-gear-register). The
 * diver's name is an overdue/due-back row's subject, so the detail carries
 * the unit and the window; a service row's subject is the unit itself.
 */
export function gearOverdueDetailText(
  t: StaffTranslator,
  input: { unitLabel: string; dueOn: string },
): string {
  return t("shared.today.gear.overdueDetail", input);
}

export function gearDueBackDetailText(t: StaffTranslator, input: { unitLabel: string }): string {
  return t("shared.today.gear.dueBackDetail", input);
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
  return t("shared.today.gear.fitConfirmDetail", {
    name: input.personName,
    unitLabel: input.unitLabel,
    size: input.size,
  });
}

export function gearNeverPickedUpDetailText(
  t: StaffTranslator,
  input: { unitLabel: string; dueOn: string },
): string {
  return t("shared.today.gear.neverPickedUpDetail", input);
}

export function gearServiceDueDetailText(
  t: StaffTranslator,
  input: { clockLabel: string; overdue: boolean; dueOn: string },
): string {
  return t(
    input.overdue ? "shared.today.gear.serviceOverdueDetail" : "shared.today.gear.serviceDueDetail",
    { clockLabel: input.clockLabel, dueOn: input.dueOn },
  );
}

export function openGearRegisterActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openGearRegister");
}

export function openGearUnitActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openGearUnit");
}

/** Where a row about one diver points when its own control is not the answer. */
export function openDiverActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openDiver");
}

export function staffCredentialDueDetailText(
  t: StaffTranslator,
  input: { credential: string; dueOn: string; overdue: boolean },
): string {
  return t(
    input.overdue
      ? "shared.today.staffCredential.overdueDetail"
      : "shared.today.staffCredential.dueDetail",
    { credential: input.credential, dueOn: input.dueOn },
  );
}

export function openStaffingActionText(t: StaffTranslator): string {
  return t("shared.today.actionLabel.openStaffing");
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
  summary: { boats: number; jobs: number; nextDepartureTime: string | null },
): string | null {
  if (summary.boats === 0) return null;
  const boats = t("shopHome.spine.summaryBoats", { count: summary.boats });
  const jobs = summary.nextDepartureTime
    ? t("shopHome.spine.summaryNext", {
        count: summary.jobs,
        time: summary.nextDepartureTime,
      })
    : t("shopHome.spine.summaryAfter", { count: summary.jobs });
  return `${boats} ${jobs}`;
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
