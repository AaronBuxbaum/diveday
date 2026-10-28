import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  PaymentStatus,
  SpecialtyCertification,
  TripRequirement,
} from "@/db/schema";
import { checkMinimumAge } from "./age";
import { AGENCY_CHECKS, isCheckableAgency } from "./agency-check";
import type { CalendarDate } from "./calendar-date";
import { nowDate } from "./clock";
import {
  COURSE_FORMS_BLOCK_BOARDING,
  type CourseFormSignature,
  courseFormGaps,
  type RequiredCourseForm,
} from "./course-forms";
import { guardianSignatureMissing } from "./guardian";
import { isDiver, isHeldToMedical, type ParticipantType } from "./participant-types";
import {
  NO_REQUIREMENT,
  type Requirement,
  requirementOrNull,
  unionRequirements,
} from "./requirement";
import { type TrainingDiveCourse, trainingDiveRequiredLevel } from "./training-mark";
import { type ReleaseLapse, type WaiverStateFields, waiverState } from "./waivers";

/**
 * Payment states that clear the "ready to board" payment gate.
 *
 * `partly_refunded` is in here for the same reason `deposit_paid` is: the
 * shop is holding real money against this seat. A goodwill part-refund —
 * weather cut the boat short, half the dives done, half the money back — is
 * the commonest partial there is, and leaving it out would have made every
 * diver it was granted to unboardable at the next roll call (issue #699).
 * The gate asks whether money was collected, never whether the sum is tidy.
 */
const PAYMENT_CLEARED: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "deposit_paid",
  "paid",
  "partly_refunded",
  "waived",
]);

/**
 * **A payment gate on a departure with no price is a gate nobody can clear.**
 *
 * `checkoutCharge` (`src/lib/deposits.ts`) returns null for an unpriced trip,
 * so `startBookingCheckout` refuses with `unpriced`, so the public booking
 * action sends the diver to the ordinary booked landing without asking for
 * money — and their booking stays `unpaid`, which raises `payment_due` below,
 * permanently, for them and for every diver who books afterwards. There is no
 * way out from the diver's side and only one from the shop's: marking each
 * person paid or waived by hand, on a departure that never asked for money.
 *
 * The demo shop was publicly selling one (issue #692). Both forms that can
 * produce the combination refuse it now: the requirements form (ticking the
 * gate onto an unpriced departure) and the details form (clearing the price
 * from a gated one).
 *
 * Deliberately **not** solved by letting an unpriced trip clear the gate.
 * `PAYMENT_CLEARED` includes `waived` because `waived` means a human decided;
 * deriving that from "the shop forgot a price" turns a data error into a silent
 * boarding clearance on a safety surface.
 */
export function paymentGateIsUnclearable(
  requiresPayment: boolean,
  priceCents: number | null,
): boolean {
  // `<= 0` as well as null: `checkoutCharge` refuses a zero price by the same
  // test, so a departure priced at nothing gates exactly as hard as an unpriced
  // one.
  return requiresPayment && (priceCents === null || priceCents <= 0);
}

/**
 * The five-rung certification ladder, and the set a trip may demand.
 *
 * Both live in `./certification-levels.ts` and are re-exported here so every
 * caller is unchanged. They moved because `src/i18n/readiness-labels.ts` needs
 * one value from this module and nothing else, and that single import was
 * dragging the waiver and medical copy into two public diver pages' first load
 * (issue #1354). Labels for these — and for `DiveSpecialty` below — live in the
 * message bundles, never here: this file states facts about ordering and gates,
 * `src/app` chooses words.
 */
import { type CertificationLevel, certificationRank } from "./certification-levels";

export type {
  CertificationLevel,
  RequirableCertificationLevel,
} from "./certification-levels";

export {
  certificationRank,
  higherCertificationLevel,
  REQUIRABLE_CERTIFICATION_LEVELS,
} from "./certification-levels";

/**
 * Anything that can demand cards of a diver: a trip's own requirement row, a
 * dive site's inherent gate, or the running total of several of them folded
 * together. One shape — {@link Requirement}, `./requirement.ts` — is what lets
 * a single fold compose them all; these are the readiness engine's names for
 * it, so its callers say which role a requirement plays.
 */
export type CertRequirementSource = Requirement;

/** A dive site's inherent cert gate, composed into every trip that visits it. */
export type SiteCertRequirement = Requirement;

/**
 * The single gate a trip's *whole* itinerary imposes: every site it visits
 * folded into one requirement — the strictest level, the union of specialties,
 * nitrox if any one of them wants it. The naive version reads only the primary
 * site, which goes quiet on exactly the two-tank day where dive two is the one
 * that needs the card (the same failure `getTripMaxDepthMeters` already fixed
 * for the depth advisory).
 *
 * Null when no visited site demands anything, so callers keep treating "no site
 * requirement" as absent rather than as an empty gate.
 */
export function combineSiteRequirements(
  sites: readonly SiteCertRequirement[],
): SiteCertRequirement | null {
  return requirementOrNull(unionRequirements(...sites));
}

export type ReadinessBlockerCode =
  | "requirements_not_configured"
  | "identity_unconfirmed"
  | "waiver_not_sent"
  /**
   * A release the diver signed here has lapsed (its year, a physician's
   * evaluation's year, or the shop's terms changed) and no fresh link is out.
   * Blocks exactly as `waiver_not_sent` does; the fix is the diver signing again.
   */
  | "waiver_lapsed"
  /**
   * A release that still stands today but runs out before the trip ends
   * (issue #2611, `waiverClockInstant`). Blocks as `waiver_lapsed` does, and
   * the fix is the same, the diver signing again now; the word differs because
   * "lapsed" would be untrue of a release valid today.
   */
  | "waiver_runs_out"
  | "waiver_pending"
  | "waiver_expired"
  | "medical_review"
  | "medical_not_cleared"
  /** A minor signed alone; a parent or guardian has not (ADR 20260907-guardian-co-signature). */
  | "guardian_signature_missing"
  /**
   * A form the course asks every student to sign is unsigned for this
   * enrollment — one blocker per form, carrying its title (ADR
   * 20261008-course-forms). Raised while `COURSE_FORMS_BLOCK_BOARDING`, and for a form marked
   * medical screening whatever the switch says (#2337).
   */
  | "course_form_unsigned"
  /**
   * The student signed a course form while a minor and no parent or guardian
   * signed beside them — often a date of birth that reached the shop after the
   * signature. The fix is the guardian's signature, not the student's again.
   */
  | "course_form_guardian_missing"
  /**
   * Staff marked this seat as a training dive for a course seat, and the mark
   * no longer stands: the enrollment was canceled, held, moved off a course or
   * ends before this departure (issue #2275). Raised until a staffer clears or
   * replaces the mark, never read as "no mark": a stale mark must not relax
   * boarding in silence.
   */
  | "training_mark_invalid"
  | "certification_missing"
  | "certification_pending"
  | "certification_self_declared"
  | "certification_insufficient"
  /**
   * No card at the trip's level yet, but the diver is booked on a course that
   * certifies them to it and finishes before this trip. Still a blocker: the
   * diver boards on the card the instructor issues, never on the enrollment.
   */
  | "certification_in_training"
  /**
   * The diver said, on their own link, that they hold no card yet (third UX
   * review, item 23). Still a blocker, never a refusal: the sale stays open
   * (`decideTripAdmission`), and the shop gets in touch before the day about a
   * Discover Scuba or the course. Its own code so Today and the roster say
   * "Says not certified yet" rather than "No certification on file", which
   * reads as paperwork the diver forgot.
   */
  | "certification_not_yet"
  | "specialty_missing"
  | "specialty_pending"
  | "specialty_import_unconfirmed"
  | "nitrox_missing"
  | "nitrox_pending"
  | "nitrox_self_declared"
  | "under_minimum_age"
  | "payment_due"
  | "payment_refunded"
  | "readiness_unavailable";

/**
 * The data a translated message needs to fill in its placeholders. Which
 * fields are set depends on `code` — `src/app` looks the code up in a message
 * bundle and interpolates whichever of these the chosen template calls for.
 */
export type ReadinessBlockerParams = {
  requiredLevel?: CertificationLevel;
  /** The highest verified rung on file, beside a `certification_insufficient`. */
  heldLevel?: CertificationLevel;
  specialty?: DiveSpecialty;
  age?: number;
  minimumAge?: number;
  /** The shop's own title for an unsigned course form — the shop's words, not DiveDay's. */
  formTitle?: string;
  /**
   * Beside a course form asked only because the shop holds no date of birth:
   * the age the form is bounded at, so the line names the birthday as the fix
   * (dive-domain review H6).
   */
  formMaxAge?: number;
  /**
   * The course session that should have certified this level and has ended
   * without a card (issue #2058), beside a certification blocker the card
   * would clear. Staff surfaces point at that session's roster with it.
   */
  endedCourseTripId?: string;
};

export type ReadinessBlocker = { code: ReadinessBlockerCode; params?: ReadinessBlockerParams };

/** The requirement family a blocker belongs to, shared by every readiness view. */
export type BlockerCategory = "waiver" | "certification" | "payment" | "setup";

export const BLOCKER_CATEGORY: Record<ReadinessBlockerCode, BlockerCategory> = {
  requirements_not_configured: "setup",
  readiness_unavailable: "setup",
  identity_unconfirmed: "setup",
  waiver_not_sent: "waiver",
  waiver_lapsed: "waiver",
  waiver_runs_out: "waiver",
  waiver_pending: "waiver",
  waiver_expired: "waiver",
  medical_review: "waiver",
  // The same family as the hold it settles: it is still the release that is not
  // usable, and folding it in keeps a diver from appearing under two headings
  // for one fact.
  medical_not_cleared: "waiver",
  // The release is what is not usable: a minor's signature with no guardian's
  // beside it is not a signed release, and the fix is the waiver's own (a
  // fresh link that asks for both).
  guardian_signature_missing: "waiver",
  // Paperwork the student signs, in the same family as the release: the sign
  // step on the diver's own page is where both are answered.
  course_form_unsigned: "waiver",
  course_form_guardian_missing: "waiver",
  // The desk's own record is what is wrong, like a held identity: staff fix
  // it on the Divers tab, and the student has nothing to do.
  training_mark_invalid: "setup",
  certification_missing: "certification",
  certification_pending: "certification",
  certification_self_declared: "certification",
  certification_insufficient: "certification",
  certification_in_training: "certification",
  certification_not_yet: "certification",
  specialty_missing: "certification",
  specialty_pending: "certification",
  specialty_import_unconfirmed: "certification",
  nitrox_missing: "certification",
  nitrox_pending: "certification",
  nitrox_self_declared: "certification",
  // "setup", not "certification": age is not a card the diver holds, and it is
  // entirely shop-side work. Filing it here also collapses it into the single
  // generic setup line on the diver's own checklist, which is what keeps the
  // public confirmation panel from disclosing that a given email belongs to
  // someone under a course's minimum age.
  under_minimum_age: "setup",
  payment_due: "payment",
  payment_refunded: "payment",
};

/**
 * **What a blocker aboard a boat is asking of the crew.**
 *
 * `BLOCKER_CATEGORY` answers "which requirement family", which is the right
 * question for a checklist and the wrong one at the rail. Once a diver is on
 * the boat the gate is behind them, and the only question left is what happens
 * before *this diver* gets in the water — and those answers do not line up
 * with the families:
 *
 * - **`medical`** — a review hold. On the RSTC form a "yes" means a doctor must
 *   confirm in writing that the diver is fit, and this app tells the diver
 *   exactly that (`diver.medicalReferral`). It is not the captain's to waive,
 *   not the instructor's, and a crew that waives it has voided the shop's
 *   insurance for that dive. Nobody aboard can clear it.
 * - **`unknown`** — nothing on file that clears them. An unsigned, unsent or
 *   expired waiver means **no medical declaration at all**, not a filing
 *   error; `identity_unconfirmed` means the human aboard may not be the human
 *   whose cards and answers are on file (H-13); `readiness_unavailable` means
 *   the lookup failed, and this module already says a safety surface must
 *   never treat that as a pass; `requirements_not_configured` means nobody's
 *   cards were checked against anything.
 * - **`certification`** — a qualification this dive asks for that the record
 *   does not show: a card missing, unverified, self-declared or too shallow, a
 *   specialty absent, or a diver under the course's minimum age. Sometimes a
 *   card in a dry bag; sometimes a diver who should be on a shallower profile.
 * - **`payment`** — money owed. The only one of the four that genuinely does
 *   not change what happens in the water today.
 *
 * The first three all mean *do not put this diver in the water yet*; only the
 * fourth is office work, and the card said "the fix is in the list below" to
 * every one of them (issue #791, from a `dive-domain-expert` pass over #742,
 * and reshaped by a second pass over the first cut of this).
 *
 * **No role is named in the words these map to.** DiveDay informs and never
 * gates, and naming an authority is the one thing that turns an informing line
 * into an instruction — besides which the captain is responsible for the
 * vessel, while whether a given diver splashes is the dive leader's call, and
 * a pool session has neither.
 *
 * Precedence is worst-first, because a line has room for one reason: a diver
 * held on medical review *and* missing a card is a medical hold.
 */
export type AboardBlockerKind = "medical" | "unknown" | "certification" | "payment";

const ABOARD_KIND: Record<ReadinessBlockerCode, AboardBlockerKind> = {
  medical_review: "medical",
  // `medical`, emphatically: at the rail a refused evaluation is the *most*
  // conclusive version of the hold, and the one thing nobody aboard may waive.
  medical_not_cleared: "medical",

  waiver_not_sent: "unknown",
  // A lapsed release is no current medical declaration either.
  waiver_lapsed: "unknown",
  waiver_runs_out: "unknown",
  waiver_pending: "unknown",
  waiver_expired: "unknown",
  // A minor's release with no guardian on it is not a release the shop can
  // rely on: as `unknown` as an unsigned one, and nobody aboard can supply
  // the missing signature.
  guardian_signature_missing: "unknown",
  // A form the course asked for and nobody signed: nothing on file, and
  // nobody aboard can sign it for them.
  course_form_unsigned: "unknown",
  course_form_guardian_missing: "unknown",
  // Which course's forms this seat owes is not known, so neither is whether
  // they are signed.
  training_mark_invalid: "unknown",
  identity_unconfirmed: "unknown",
  readiness_unavailable: "unknown",
  requirements_not_configured: "unknown",

  certification_missing: "certification",
  certification_pending: "certification",
  certification_self_declared: "certification",
  certification_insufficient: "certification",
  certification_in_training: "certification",
  certification_not_yet: "certification",
  specialty_missing: "certification",
  specialty_pending: "certification",
  specialty_import_unconfirmed: "certification",
  nitrox_missing: "certification",
  nitrox_pending: "certification",
  nitrox_self_declared: "certification",
  // An agency hard stop about the diver, the same shape as a card that does not
  // reach the site's depth — not the shop-side "setup" it is filed under in
  // `BLOCKER_CATEGORY`, which is scoped to keeping age off the *public*
  // confirmation panel.
  under_minimum_age: "certification",

  payment_due: "payment",
  payment_refunded: "payment",
};

/** Worst first, so a group can be ordered and a single diver reduced to one. */
const ABOARD_KIND_ORDER: readonly AboardBlockerKind[] = [
  "medical",
  "unknown",
  "certification",
  "payment",
];

export function aboardBlockerKind(blockers: readonly ReadinessBlocker[]): AboardBlockerKind | null {
  const kinds = new Set(blockers.map((blocker) => ABOARD_KIND[blocker.code]));
  return ABOARD_KIND_ORDER.find((kind) => kinds.has(kind)) ?? null;
}

/**
 * The two states a booking can be in, and the only two. Named so every surface
 * that renders one can key off the same type — the words and tone come from
 * `src/i18n/readiness-labels.ts` (`readinessStatusText`/`readinessStatusTone`),
 * never from the surface itself.
 */
export type ReadinessStatus = "ready" | "blocked";

export type ReadinessResult = {
  status: ReadinessStatus;
  blockers: ReadinessBlocker[];
};

/**
 * **A card a booked course will issue.** The level the course certifies and
 * when its session ends. A course that already ended without a card being
 * issued is no longer "in training": the diver either did not finish, or the
 * instructor still has a tap to make, and both deserve the serious line.
 */
export type CertificationInTraining = {
  level: CertificationLevel;
  finishesAt: Date;
};

export type ReadinessInput = {
  requirement: TripRequirement | null;
  /** The primary dive site's inherent gate, composed with the trip's own. */
  siteRequirement?: SiteCertRequirement | null;
  waiver: WaiverStateFields | null;
  /**
   * With no `waiver` handed in: the diver signed a release here that has since
   * lapsed (`releaseLapseForBooking`). Changes the blocker's name from
   * `waiver_not_sent` to `waiver_lapsed` (aged out already) or
   * `waiver_runs_out` (runs out before the trip), never whether there is one.
   */
  releaseLapse?: ReleaseLapse | null;
  certifications: readonly Certification[];
  /**
   * Courses this diver is booked on that certify a level and finish before
   * this trip starts (`src/db/certifications-in-training.ts` does the
   * filtering by trip). Never evidence: they turn a "not certified" blocker
   * into the softer `certification_in_training`, and nothing here clears.
   */
  certificationsInTraining?: readonly CertificationInTraining[];
  /**
   * Course sessions this diver sat that certify a level and have **already
   * ended** before this trip (`courseEndedBefore`, src/lib/in-training.ts).
   * Never evidence: they only name, on a blocker that stands anyway, the
   * session whose result is the fix (issue #2058).
   */
  coursesEnded?: readonly (CertificationInTraining & { tripId: string })[];
  /**
   * The diver's own standing "I'm not certified yet" (`people.
   * no_certification_declared_at`, not cleared by staff). Never evidence and
   * never a clearance: it only names *why* a level gate is unmet, below every
   * card the shop holds. See `noCertificationStands`.
   */
  noCertificationDeclared?: boolean;
  specialtyCertifications?: readonly SpecialtyCertification[];
  nitroxCertifications?: readonly NitroxCertification[];
  /** The booking's current payment state; absent is treated as unpaid. */
  paymentStatus?: PaymentStatus | null;
  /**
   * The booking attached itself to an existing person on something short of
   * proof and has not been staff-confirmed (H-13). Fails closed until staff
   * confirm it is the same human, so a seat can't board on borrowed evidence.
   *
   * **Two doors raise it, and the module that acts on the flag documented one**
   * (`dive-domain-expert`, the RFH-07 layer). The by-email path reused a row
   * whose name on file disagrees with the submitted one — the shared-inbox
   * signal this flag was built for — and the counter's name-match prompt handed
   * over a person id on a tap, where either the typed name disagrees with the
   * one on file or a second diver in the shop answers to that exact name
   * (issue #1556). Each is argued where it is set, in `createBookingRecord` and
   * `nameMatchLeavesIdentityInDoubt` (`src/db/bookings.ts`); a safety module
   * describing only the older one teaches a reader that a tap at the counter
   * cannot produce the blocker they are looking at.
   */
  identityUnconfirmed?: boolean;
  /**
   * The course's stated minimum age and the diver's date of birth, if the shop
   * has one on file (H-08). Checked here as well as at booking, because a
   * booking-time-only gate is inert for every diver whose date was recorded
   * *after* they booked — which, since nothing collected dates before this
   * shipped, is nearly all of them. Fails open: no date, no minimum, no
   * blocker.
   */
  courseMinimumAge?: number | null;
  dateOfBirth?: CalendarDate | null;
  /**
   * The seat's booker said this diver is under 18
   * (`bookings.minor_declared_at`). Read only by the guardian co-signature
   * rule, and only where no date of birth is on file; never by the minimum-age
   * gate, which needs an age, not a yes.
   */
  minorDeclared?: boolean;
  /** The shop-local calendar date the course runs, which is when age is measured. */
  courseDate?: CalendarDate | null;
  /**
   * The shop's zone, which turns the instant a release was signed into the
   * calendar day the guardian rule measures the diver's age on
   * (`src/lib/guardian.ts`). Required: a guessed zone moves that day near
   * midnight, and the guess decides whether a diver signing on the eve of
   * their 18th birthday needs a guardian. The one production caller
   * (`src/db/readiness.ts`) passes the shop's own.
   */
  timezone: string;
  /**
   * What this person is doing on the boat (ADR 20261007-participant-types).
   * Absent is a diver.
   *
   * A snorkeler or a rider is held to the trip's **waiver** (H-01/H-03) and a
   * snorkeler to its medical too; a rider is never held on a medical referral
   * or refusal (H-109, `isHeldToMedical`). Both are held to its **payment**
   * gate, and to the identity and minimum-age checks, which are about the
   * person rather than the dive. They are held to
   * **no** certification, specialty or nitrox requirement: there is no dive for
   * a card to qualify, and the trip's or a site's gate composes to nothing for
   * them, exactly as `decideTripAdmission` composes it at the sale.
   */
  participantType?: ParticipantType;
  /**
   * The departure states this seat's kind as free (a rider at no charge,
   * `trips.rider_price_cents = 0`). Only ever set for a seat that is not a
   * diver's, by the one production caller (`src/db/readiness.ts`).
   *
   * A payment gate then has nothing to ask of this seat. Deliberately narrower
   * than "unpriced": `paymentGateIsUnclearable` explains why a price the shop
   * forgot must never clear the gate, and a price the shop *stated* as nothing
   * is the opposite case — a human decided.
   */
  statedFree?: boolean;
  /**
   * The forms this booking's course requires and every signature on file for
   * the booking (ADR 20261008-course-forms). Absent on a departure that is not
   * a course session, or on a course that asks for none.
   */
  courseForms?: {
    shopId: string;
    bookingId: string;
    personId: string;
    required: readonly RequiredCourseForm[];
    signatures: readonly CourseFormSignature[];
    /**
     * The shop's zone, required: whether a student was a minor is measured on
     * the day they signed, and a guessed zone moves that day near midnight.
     */
    timezone: string;
  };
  /**
   * The seat carries a training mark that no longer stands
   * (`trainingMarkProblem`, issue #2275). A mark that stands arrives as
   * `courseForms` above instead, keyed on the enrollment's booking.
   */
  trainingMarkInvalid?: boolean;
  /**
   * The seat's training mark stands and the course's instructor is aboard
   * for it (`trainingDiveLevel`, issue #2731): a site's level may be lowered
   * to the course's minimum where the course certifies it. The departure's
   * own level, specialty, and nitrox requirements always stand.
   */
  trainingDive?: TrainingDiveCourse | null;
  now?: Date;
};

/** A safety surface must never treat a failed readiness lookup as a pass. */
export function unavailableReadiness(): ReadinessResult {
  return {
    status: "blocked",
    blockers: [{ code: "readiness_unavailable" }],
  };
}

/**
 * **A card the shop has actually seen.** `verified` and nothing else — a
 * recreational certification does not expire, so there is no second condition
 * to check (ADR 20260821-a-card-does-not-expire). What keeps a diver current
 * is when they last dived, which is a different question this does not ask
 * (`src/lib/dive-recency.ts`, ADR 20260821-currency-is-what-catches-people).
 */
export function validVerifiedCertification(certification: Certification): boolean {
  return certification.status === "verified";
}

/**
 * **A card that is still only somebody's word for it.**
 *
 * A diver naming their own level on one of the three public forms that ask —
 * the deal list, a trip's wait list, or the booking form — writes a `pending`
 * card stamped `selfDeclaredAt` (src/db/self-declared-cards.ts). Nobody at the
 * shop has seen anything, and the person may not even be who the email says.
 *
 * **This predicate is what keeps the two gates different.** At the *sale*,
 * `decideTripAdmission` believes a stated card; at the *boat*,
 * `certificationBlocker` gives one its own code rather than clearing on it, so
 * a claim buys a seat and never a place in the water (ADR
 * 20260820-attested-at-booking-verified-at-boarding). It used to be read as
 * absent by both.
 *
 * The stamp stays forever, because where a row began is history. What changes
 * is the `status`: once a staffer has entered the agency and number off a card
 * in their hand, the row is a sighting that happens to have started as a claim,
 * and it counts like any other. That is why this is a *pair* of conditions and
 * not just `selfDeclaredAt !== null`.
 *
 * Shaped structurally rather than over `Certification` so the nitrox table's
 * identical rows go through the same one definition.
 */
export function isUnsightedSelfDeclaration(card: {
  selfDeclaredAt?: Date | string | null;
  status: "pending" | "verified";
}): boolean {
  return Boolean(card.selfDeclaredAt) && card.status === "pending";
}

/**
 * **A pending card with no number anybody has read off a physical card**, of
 * which there are now two kinds.
 *
 * The older one is an unsighted self-declaration above: a stranger's typing.
 * The newer one is a **shop-issued specialty or nitrox card** (issue #975) —
 * this shop's own instructor recording their own class, where the number is the
 * agency's processing lag rather than missing evidence. They are very different
 * in how much they are worth, and identical in the only thing this predicate
 * decides: **the confirm that promotes one to `verified` must ask for the
 * agency and the number off a card**, because that promotion is what opens a
 * depth gate past 18 m or authorizes an enriched-air fill.
 *
 * The level table has no second kind. A shop-issued *level* card lands
 * `verified` on the instructor's tap and never passes through here (ADR
 * 20260824-shop-issued-certification-is-verified); the stricter treatment of
 * specialty and nitrox is deliberate and is this table's own precedent — even
 * an imported row does not clear its own gate without a staffer confirming it
 * ("a spreadsheet cell is not a card sighting", ADR
 * 20260725-import-specialty-cards).
 *
 * Structural rather than over a row type, like its sibling, so the specialty
 * and nitrox tables go through one definition.
 */
export function needsCardSighting(card: {
  selfDeclaredAt?: Date | string | null;
  issuedByShopAt?: Date | string | null;
  /** With `identifier`: a card an agency check listed with no number of its own (below). */
  listedFromCertificationId?: string | null;
  identifier?: string | null;
  status: "pending" | "verified";
}): boolean {
  return (
    card.status === "pending" &&
    (Boolean(card.selfDeclaredAt) || Boolean(card.issuedByShopAt) || listedWithoutANumber(card))
  );
}

/**
 * **A third numberless kind**: a card an agency check listed (layer 3 of ADR
 * 20261008-cert-check-extension) at an agency that numbers each card, whose
 * page showed no number for it. The page is good evidence of the card and none
 * of its number, so its confirm asks for the card as the other two do.
 */
function listedWithoutANumber(card: {
  listedFromCertificationId?: string | null;
  identifier?: string | null;
}): boolean {
  return Boolean(card.listedFromCertificationId) && !card.identifier?.trim();
}

/**
 * A card an agency check listed at an agency that numbers each card: its
 * number may be the page's or a staffer's sighting, and a revert cannot tell
 * which, so it is treated as sighted.
 */
function listedAtACardNumberingAgency(card: {
  listedFromCertificationId?: string | null;
  agency?: string;
}): boolean {
  return (
    Boolean(card.listedFromCertificationId) &&
    card.agency !== undefined &&
    isCheckableAgency(card.agency) &&
    !AGENCY_CHECKS[card.agency].numbersTheDiver
  );
}

/**
 * Why undoing a "Mark certified" tap was refused — never a silent no-op, since
 * the whole promise of the toast is that the card went back.
 */
export type CardUnreviewRefusal =
  | "not_found"
  | "not_reviewed"
  | "sighted_card"
  /** The card has been reviewed since the review this Undo was offered for. */
  | "stale"
  /** An agency check made the review; its own Undo takes it back, this one never does. */
  | "agency_checked";

/**
 * **What a card should look like once its review is taken back.**
 *
 * The one-tap review is a pure status flip: a staffer already held the card and
 * typed its number, and the tap only records that the number checked out. So
 * its inverse is a pure status flip too — clear the review stamp, and drop the
 * card back to `pending` unless it arrived `verified` from an import
 * (ADR 20260724-import-verified-cards), where the review was a confirmation
 * rather than the thing that cleared it.
 *
 * **A card that needed a sighting is refused outright**, and that is the whole
 * reason this is a decision rather than an `update`. Certifying a
 * self-declaration or a shop-issued specialty *rewrites* the row from the card
 * in the staffer's hand — agency, number, and for a level card the rung — and
 * those previous values are gone. Reverting the status alone would leave a
 * pending row wearing a sighted number with none of the marks that say a diver
 * typed it, which is precisely the laundering `selfDeclaredAt` exists to
 * prevent. Those reviews are taken back by deleting the card, which is
 * reversible and says what it did.
 *
 * Structural rather than over a row type, like the two predicates above, so all
 * three certification tables go through one definition.
 */
export function unreviewedCardState(card: {
  status: "pending" | "verified";
  reviewedAt?: Date | string | null;
  selfDeclaredAt?: Date | string | null;
  issuedByShopAt?: Date | string | null;
  importedAt?: Date | string | null;
  /** With `agency`: a listed card at an agency that numbers each card (`listedAtACardNumberingAgency`). */
  listedFromCertificationId?: string | null;
  agency?: string;
}): { ok: true; status: "pending" | "verified" } | { ok: false; reason: CardUnreviewRefusal } {
  if (card.selfDeclaredAt || card.issuedByShopAt || listedAtACardNumberingAgency(card)) {
    return { ok: false, reason: "sighted_card" };
  }
  if (!card.reviewedAt) return { ok: false, reason: "not_reviewed" };
  return { ok: true, status: card.importedAt ? "verified" : "pending" };
}

/**
 * **Whether an Undo still belongs to the review it was offered for** (issue
 * #2612). The toast's form carries the `reviewedAt` it was rendered with; a
 * card re-reviewed since (by a second tap, or by the agency check, which writes
 * its evidence into the note) is no longer the review the staffer saw, and
 * undoing it would wipe a later check and its evidence. The one-tap Undo also
 * never reverses an agency-checked review, as the agency check's own Undo
 * never reverses a one-tap one. Null means the Undo may proceed.
 *
 * Structural, like {@link unreviewedCardState}, so all three tables share it.
 * Run it after that decision: a card with no review at all is `not_reviewed`,
 * not stale.
 */
export function cardUndoRefusal(
  card: { reviewedAt?: Date | null; agencyCheckedAt?: Date | null },
  offeredReviewedAt: Date,
  options: { reversingAgencyCheck?: boolean } = {},
): "stale" | "agency_checked" | null {
  if (!card.reviewedAt || card.reviewedAt.getTime() !== offeredReviewedAt.getTime()) {
    return "stale";
  }
  if (card.agencyCheckedAt && !options.reversingAgencyCheck) return "agency_checked";
  return null;
}

/** Shared rank check for course admission and final trip readiness. */
export function hasVerifiedCertificationAtLeast(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
): boolean {
  return certifications.some(
    (certification) =>
      validVerifiedCertification(certification) &&
      certificationRank(certification.level) >= certificationRank(minimumLevel),
  );
}

/**
 * Whether a person's "I'm not certified yet" still stands: said, and not since
 * cleared by a staffer (`clearNoCertificationDeclaration`). A card on file
 * outranks it in `certificationBlocker`, so this asks nothing about cards.
 */
export function noCertificationStands(person: {
  noCertificationDeclaredAt: Date | null;
  noCertificationClearedAt: Date | null;
}): boolean {
  return person.noCertificationDeclaredAt !== null && person.noCertificationClearedAt === null;
}

/**
 * The blocker codes an ended course's card would clear, and so may name it.
 * Not a self-declared card: the diver's own word is checked against the card
 * they named, so verifying it is the fix (agency review G6).
 */
const ENDED_COURSE_CODES: ReadonlySet<ReadinessBlockerCode> = new Set([
  "certification_missing",
  "certification_insufficient",
  "certification_not_yet",
]);

/**
 * Names the latest ended course session that certifies at least the level on
 * a blocker its card would clear (issue #2058). The code is unchanged and the
 * blocker stands: this only says where the fix is.
 */
function withEndedCourse(
  blocker: ReadinessBlocker,
  minimumLevel: CertificationLevel,
  coursesEnded: readonly (CertificationInTraining & { tripId: string })[] | undefined,
): ReadinessBlocker {
  if (!ENDED_COURSE_CODES.has(blocker.code)) return blocker;
  const ended = (coursesEnded ?? [])
    .filter((course) => certificationRank(course.level) >= certificationRank(minimumLevel))
    .reduce<(CertificationInTraining & { tripId: string }) | null>(
      (latest, course) =>
        !latest || course.finishesAt.getTime() > latest.finishesAt.getTime() ? course : latest,
      null,
    );
  return ended
    ? { ...blocker, params: { ...blocker.params, endedCourseTripId: ended.tripId } }
    : blocker;
}

function certificationBlocker(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
  inTraining: readonly CertificationInTraining[],
  noCertificationDeclared: boolean,
  now: Date,
): ReadinessBlocker | null {
  const verified = certifications.filter(validVerifiedCertification);
  if (hasVerifiedCertificationAtLeast(certifications, minimumLevel)) {
    return null;
  }
  // `pending` means **the shop is holding something it can look up** — a card
  // number is on file, waiting on the agency check. A still-unsighted
  // self-declaration *with no number* is `pending` too but the shop is holding
  // nothing at all, so it is excluded here and answered by its own code below.
  // Conflating the two told the diver on /ready "your card is with the shop for
  // verification" about a card that does not exist, and simultaneously withdrew
  // the card-entry form that was their only way to send one
  // (`CERT_ENTRY_CODES`) — a diver who ticked a dropdown was left with no move
  // and arrived at the dock without a card.
  //
  // The exclusion is about the **number**, not the stamp, which is why it asks
  // for both. When a diver types their card in on `/ready`, the row is stamped
  // `selfDeclaredAt` (so a staffer's one-tap promote still demands a sighting —
  // `security-reviewer`, 2026-08-20) *and* carries an identifier. That is a
  // number with the shop awaiting review, so it belongs here: reading it as a
  // bare claim re-offered the entry form to a diver who had just filled it in,
  // and re-typing the same number is refused by the unique index anyway.
  const heldForReview = (certification: Certification) =>
    !isUnsightedSelfDeclaration(certification) || Boolean(certification.identifier);
  if (
    certifications.some(
      (certification) =>
        certification.status === "pending" &&
        heldForReview(certification) &&
        certificationRank(certification.level) >= certificationRank(minimumLevel),
    )
  ) {
    return { code: "certification_pending" };
  }
  // **Booked on the course that gets them there.** Below a card on file at
  // the level (that card is the stronger path) and above every "not
  // certified" answer: a fun dive booked for the morning after an Open Water
  // course is a plan, not a problem, and reading it as one buries the divers
  // who really are booked above their card. Only a course still ahead counts;
  // see `CertificationInTraining`.
  if (
    inTraining.some(
      (course) =>
        course.finishesAt.getTime() > now.getTime() &&
        certificationRank(course.level) >= certificationRank(minimumLevel),
    )
  ) {
    return { code: "certification_in_training", params: { requiredLevel: minimumLevel } };
  }
  if (verified.length > 0) {
    const heldLevel = verified
      .map((certification) => certification.level)
      .reduce((best, level) => (certificationRank(level) > certificationRank(best) ? level : best));
    return {
      code: "certification_insufficient",
      params: { requiredLevel: minimumLevel, heldLevel },
    };
  }
  // **The diver's own "not yet"**, below every card the shop holds and every
  // course that gets them there: a verified card, a number waiting on review
  // or a course finishing first all answer more than the statement does. Above
  // a bare self-declared level and plain `missing`, because it is the one
  // answer that tells the desk what conversation to have before the day.
  if (noCertificationDeclared) {
    return { code: "certification_not_yet", params: { requiredLevel: minimumLevel } };
  }
  // Below every state backed by something the shop holds, and above plain
  // `missing` only because it can say more: the diver told us a level and gave
  // no number, so nobody has anything to look up. Both are "the shop is holding
  // nothing usable", and both offer the diver the card-entry form. A claim that
  // *does* carry a number was answered as `pending` above.
  if (
    certifications.some(
      (certification) => isUnsightedSelfDeclaration(certification) && !certification.identifier,
    )
  ) {
    return { code: "certification_self_declared" };
  }
  return { code: "certification_missing" };
}

/**
 * Does this diver hold a card that clears the gate for this specialty?
 *
 * Exported so the drysuit rental advisory (`src/lib/drysuit-card.ts`) asks the
 * card exactly the question the gate asks. An advisory drawing its own line
 * would be a second answer about the same plastic, and the two would drift.
 */
export function holdsSpecialtyCard(
  specialtyCertifications: readonly SpecialtyCertification[],
  specialty: DiveSpecialty,
): boolean {
  return specialtyCertifications.some(
    (card) =>
      card.specialty === specialty &&
      card.status === "verified" &&
      // Confirmed by a staffer, or never needed confirming (entered by hand).
      (!card.importedAt || card.reviewedAt),
  );
}

/**
 * A specialty is a yes/no gate: only a verified, unexpired card of that exact
 * specialty clears it. Every other state fails closed with a specific reason.
 *
 * An *imported* card is the one place a specialty is stricter than the level
 * ladder (ADR 20260725-import-specialty-cards). A migrated ladder card clears
 * its requirement on `verified` alone, because the prior system's cert record
 * is evidence the diver is carded at all. A specialty authorizes a materially
 * riskier dive — deep gates depth past 18 m — so a card that has only ever been
 * a cell in a spreadsheet holds the gate until a staffer taps the one-tap
 * confirm that stamps `reviewedAt`. Boarding is never what waits: the gate is
 * on the specialty dive, and confirming is one tap on the diver's record.
 */
function specialtyBlocker(
  specialtyCertifications: readonly SpecialtyCertification[],
  specialty: DiveSpecialty,
): ReadinessBlocker | null {
  if (holdsSpecialtyCard(specialtyCertifications, specialty)) return null;
  const cards = specialtyCertifications.filter((card) => card.specialty === specialty);
  // Ahead of `pending` and `missing`: this diver is one tap from cleared, and
  // saying so is what turns a blocker into an action a staffer can take. The
  // `verified` check keeps the two blockers from overlapping — an imported card
  // is written `verified`, so a `pending` card is a capture awaiting review and
  // gets that message instead. Either way the gate stays shut.
  if (cards.some((card) => card.status === "verified" && card.importedAt && !card.reviewedAt)) {
    return { code: "specialty_import_unconfirmed", params: { specialty } };
  }
  if (cards.some((card) => card.status === "pending")) {
    return { code: "specialty_pending", params: { specialty } };
  }
  return { code: "specialty_missing", params: { specialty } };
}

/**
 * Nitrox is a yes/no gate cleared only by a verified enriched-air card. Its
 * evidence lives in nitrox_certifications (which also gates the mix request), and those
 * cards carry no expiry — so there is no expired state, only missing/pending.
 */
function nitroxBlocker(
  nitroxCertifications: readonly NitroxCertification[],
): ReadinessBlocker | null {
  if (nitroxCertifications.some((card) => card.status === "verified")) return null;
  // Same split as the level ladder above: a bare tick on a public opt-in is not
  // a card in a staffer's hand, so it must not tell the diver their nitrox card
  // is with the shop.
  if (
    nitroxCertifications.some(
      (card) => card.status === "pending" && !isUnsightedSelfDeclaration(card),
    )
  ) {
    return { code: "nitrox_pending" };
  }
  if (nitroxCertifications.some(isUnsightedSelfDeclaration)) {
    return { code: "nitrox_self_declared" };
  }
  return { code: "nitrox_missing" };
}

/**
 * The shared safety boundary. Every unknown or non-ready input becomes a
 * human-readable blocker; only explicit evidence can produce `ready`.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const now = input.now ?? nowDate();
  const blockers: ReadinessBlocker[] = [];

  // Evaluated ahead of — and independently of — the trip's own requirements: a
  // booking that attached itself to an existing person on something short of
  // proof must never board on that person's certs/waiver until staff confirm it
  // is the same human (H-13), even on a trip whose requirements aren't
  // configured yet.
  if (input.identityUnconfirmed) {
    blockers.push({ code: "identity_unconfirmed" });
  }

  // Also ahead of the trip's requirements, and for the same reason: an
  // under-age student is under-age whether or not anyone has configured the
  // trip's cert gates yet. Measured on the day the course runs, matching the
  // booking gate (src/db/bookings.ts).
  // A course's student is its diver: a snorkeler or a rider beside them is
  // asked neither the course's age nor its forms (issue #2226).
  const student = isDiver(input.participantType);
  if (input.courseDate && student) {
    const age = checkMinimumAge(input.dateOfBirth, input.courseMinimumAge, input.courseDate);
    if (age.status === "under") {
      blockers.push({
        code: "under_minimum_age",
        params: { age: age.age, minimumAge: age.minimumAge },
      });
    }
  }

  const rawState = waiverState(input.waiver, now);
  // A rider is never held on a medical (H-109, issue #2212): a release a
  // referral parked or a physician refused is still the release they signed,
  // and the caller hands in the one `effectiveReleaseForRiderSeat` chose, which
  // has already been checked for currency. A snorkeler keeps the dive medical.
  const state =
    !isHeldToMedical(input.participantType) &&
    (rawState === "medical_review" || rawState === "medical_not_cleared")
      ? "complete"
      : rawState;

  // A medical answer is a fact about the diver, not about the departure
  // (H-104, issue #2096): a referral nobody has cleared, or a physician's "no",
  // holds the diver on every trip, including one whose requirements leave the
  // release off, and — like the two checks above — one whose requirements
  // nobody has configured yet. A clean release signed after a refusal is the
  // record handed in here instead (H-98), so it reads "complete" and raises
  // neither.
  if (state === "medical_review") {
    blockers.push({ code: "medical_review" });
  }
  // The block is identical — a refused evaluation lifts nothing — and only
  // the word changes, so the crew reads "the doctor said no" rather than
  // "still waiting on the doctor" (issue #1283).
  if (state === "medical_not_cleared") {
    blockers.push({ code: "medical_not_cleared" });
  }

  if (!input.requirement) {
    blockers.push({ code: "requirements_not_configured" });
    return { status: "blocked", blockers };
  }

  // The release's own blockers follow the departure's setting.
  if (input.requirement.requiresWaiver) {
    if (state === "not_sent") {
      blockers.push({
        code:
          input.releaseLapse === "before_trip"
            ? "waiver_runs_out"
            : input.releaseLapse
              ? "waiver_lapsed"
              : "waiver_not_sent",
      });
    }
    if (state === "awaiting_signature") {
      blockers.push({ code: "waiver_pending" });
    }
    if (state === "expired") blockers.push({ code: "waiver_expired" });
    // A signed release a minor gave alone (ADR 20260907-guardian-co-signature).
    // Only ever raised over a record that *is* signed: an unsigned, expired or
    // held release already has its own line above, and a second one here
    // would tell the crew two things about one fact. Measured on the day the
    // diver signed, in the shop's own zone — never on today's date.
    if (
      input.waiver &&
      state === "complete" &&
      guardianSignatureMissing(input.waiver, {
        dateOfBirth: input.dateOfBirth,
        minorDeclared: input.minorDeclared ?? false,
        timezone: input.timezone,
      })
    ) {
      blockers.push({ code: "guardian_signature_missing" });
    }
  }

  // The course's own forms, one blocker per form still unsigned for this
  // enrollment. Independent of the departure's waiver setting: a course that
  // lists a form has said, on its own, that every student signs it. Behind one
  // switch until the owner rules on block-or-warn (ADR 20261008-course-forms);
  // a form marked medical screening blocks whatever the switch says (#2337).
  if (input.courseForms && student) {
    for (const { form, gap, ageUnknown } of courseFormGaps({
      ...input.courseForms,
      signer: {
        dateOfBirth: input.dateOfBirth,
        minorDeclared: input.minorDeclared ?? false,
        timezone: input.courseForms.timezone,
      },
    })) {
      if (!COURSE_FORMS_BLOCK_BOARDING && !form.medicalScreening) continue;
      blockers.push({
        code: gap === "guardian_missing" ? "course_form_guardian_missing" : "course_form_unsigned",
        params:
          ageUnknown && form.maxAgeYears !== undefined
            ? { formTitle: form.title, formMaxAge: form.maxAgeYears }
            : { formTitle: form.title },
      });
    }
  }

  // A training mark that stopped being true. Whatever the course-forms switch
  // says: until staff fix the mark, nobody knows which forms this seat owes.
  if (input.trainingMarkInvalid) blockers.push({ code: "training_mark_invalid" });

  // A site-level training exception cannot erase a requirement the trip set.
  // A supplied training context must already have passed its own safety gates.
  const site = input.siteRequirement;
  const effectiveSite =
    site && input.trainingDive
      ? {
          ...site,
          minimumCertificationLevel: trainingDiveRequiredLevel(
            site.minimumCertificationLevel,
            input.trainingDive,
          ),
        }
      : site;
  // Riders and snorkelers have no dive for a certification to qualify.
  const effective = isDiver(input.participantType)
    ? unionRequirements(input.requirement, effectiveSite)
    : NO_REQUIREMENT;

  if (effective.minimumCertificationLevel) {
    const certification = certificationBlocker(
      input.certifications,
      effective.minimumCertificationLevel,
      input.certificationsInTraining ?? [],
      input.noCertificationDeclared ?? false,
      now,
    );
    if (certification) {
      blockers.push(
        withEndedCourse(certification, effective.minimumCertificationLevel, input.coursesEnded),
      );
    }
  }

  for (const specialty of effective.requiredSpecialties) {
    const blocker = specialtyBlocker(input.specialtyCertifications ?? [], specialty);
    if (blocker) blockers.push(blocker);
  }

  if (effective.requiresNitrox) {
    const blocker = nitroxBlocker(input.nitroxCertifications ?? []);
    if (blocker) blockers.push(blocker);
  }

  if (input.requirement.requiresPayment && !(input.statedFree && !isDiver(input.participantType))) {
    const status = input.paymentStatus ?? "unpaid";
    if (!PAYMENT_CLEARED.has(status)) {
      blockers.push({ code: status === "refunded" ? "payment_refunded" : "payment_due" });
    }
  }
  return { status: blockers.length === 0 ? "ready" : "blocked", blockers };
}
