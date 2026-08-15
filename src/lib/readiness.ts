import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  PaymentStatus,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
import { checkMinimumAge } from "./age";
import { type CalendarDate, calendarDateInTimezone, isCalendarDateExpired } from "./calendar-date";
import { nowDate } from "./clock";
import { waiverState } from "./waivers";

/** Payment states that clear the "ready to board" payment gate. */
const PAYMENT_CLEARED: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "deposit_paid",
  "paid",
  "waived",
]);

/**
 * The five-rung certification ladder. Labels for these — and for
 * `DiveSpecialty` below — live in the message bundles
 * (`src/i18n/readiness-labels.ts` maps each code to a translation key), never
 * here: this file states facts about ordering and gates, `src/app` chooses
 * words.
 */
export type CertificationLevel =
  | "open_water"
  | "advanced_open_water"
  | "rescue"
  | "divemaster"
  | "instructor";

const levelRank: Record<CertificationLevel, number> = {
  open_water: 1,
  advanced_open_water: 2,
  rescue: 3,
  divemaster: 4,
  instructor: 5,
};

/** A level's place on the ladder, for ordering rather than comparison. Open Water is 1. */
export function certificationRank(level: CertificationLevel): number {
  return levelRank[level];
}

/** The stricter of two levels; null means "no level demanded" and never wins. */
export function higherCertificationLevel(
  a: CertificationLevel | null | undefined,
  b: CertificationLevel | null | undefined,
): CertificationLevel | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return levelRank[a] >= levelRank[b] ? a : b;
}

/**
 * Anything that can demand cards of a diver: a trip's own requirement row, a
 * dive site's inherent gate, or the running total of several of them folded
 * together. One shape is what lets a single fold compose them all.
 */
export type CertRequirementSource = {
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: readonly DiveSpecialty[];
  requiresNitrox: boolean;
};

/** A dive site's inherent cert gate, composed into every trip that visits it. */
export type SiteCertRequirement = CertRequirementSource;

/** The identity element of the fold: demands nothing of anybody. */
const NO_CERT_REQUIREMENT: CertRequirementSource = {
  minimumCertificationLevel: null,
  requiredSpecialties: [],
  requiresNitrox: false,
};

/**
 * The gate a diver is actually held to on a trip: the stricter minimum level,
 * the union of specialties, and nitrox if either the trip or its dive site
 * demands it.
 */
export function combineCertRequirements(
  requirement: CertRequirementSource,
  site: SiteCertRequirement | null | undefined,
): {
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
} {
  const specialties = new Set<DiveSpecialty>(requirement.requiredSpecialties ?? []);
  for (const specialty of site?.requiredSpecialties ?? []) specialties.add(specialty);
  return {
    minimumCertificationLevel: higherCertificationLevel(
      requirement.minimumCertificationLevel,
      site?.minimumCertificationLevel,
    ),
    requiredSpecialties: [...specialties],
    requiresNitrox: Boolean(requirement.requiresNitrox) || Boolean(site?.requiresNitrox),
  };
}

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
  let combined: CertRequirementSource = NO_CERT_REQUIREMENT;
  for (const site of sites) combined = combineCertRequirements(combined, site);
  if (
    !combined.minimumCertificationLevel &&
    combined.requiredSpecialties.length === 0 &&
    !combined.requiresNitrox
  ) {
    return null;
  }
  return combined;
}

export type ReadinessBlockerCode =
  | "requirements_not_configured"
  | "identity_unconfirmed"
  | "waiver_not_sent"
  | "waiver_pending"
  | "waiver_expired"
  | "medical_review"
  | "certification_missing"
  | "certification_pending"
  | "certification_self_declared"
  | "certification_expired"
  | "certification_insufficient"
  | "specialty_missing"
  | "specialty_pending"
  | "specialty_expired"
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
  specialty?: DiveSpecialty;
  age?: number;
  minimumAge?: number;
};

export type ReadinessBlocker = { code: ReadinessBlockerCode; params?: ReadinessBlockerParams };

/** The requirement family a blocker belongs to, shared by every readiness view. */
export type BlockerCategory = "waiver" | "certification" | "payment" | "setup";

export const BLOCKER_CATEGORY: Record<ReadinessBlockerCode, BlockerCategory> = {
  requirements_not_configured: "setup",
  readiness_unavailable: "setup",
  identity_unconfirmed: "setup",
  waiver_not_sent: "waiver",
  waiver_pending: "waiver",
  waiver_expired: "waiver",
  medical_review: "waiver",
  certification_missing: "certification",
  certification_pending: "certification",
  certification_self_declared: "certification",
  certification_expired: "certification",
  certification_insufficient: "certification",
  specialty_missing: "certification",
  specialty_pending: "certification",
  specialty_expired: "certification",
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

export type ReadinessInput = {
  requirement: TripRequirement | null;
  /** The primary dive site's inherent gate, composed with the trip's own. */
  siteRequirement?: SiteCertRequirement | null;
  waiver: WaiverRecord | null;
  certifications: readonly Certification[];
  specialtyCertifications?: readonly SpecialtyCertification[];
  nitroxCertifications?: readonly NitroxCertification[];
  /** The booking's current payment state; absent is treated as unpaid. */
  paymentStatus?: PaymentStatus | null;
  /**
   * The booking reused an existing person by email under a mismatched name and
   * has not been staff-confirmed (H-13). Fails closed until staff confirm it is
   * the same human, so a shared-inbox booking can't board on borrowed evidence.
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
  /** The shop-local calendar date the course runs, which is when age is measured. */
  courseDate?: CalendarDate | null;
  now?: Date;
  /** The shop's IANA timezone — required so cert/specialty expiry reads against its local calendar date (CR-009), never UTC. */
  timezone: string;
};

/** A safety surface must never treat a failed readiness lookup as a pass. */
export function unavailableReadiness(): ReadinessResult {
  return {
    status: "blocked",
    blockers: [{ code: "readiness_unavailable" }],
  };
}

/**
 * `todayLocal` is the shop's own local calendar date (CR-009,
 * src/lib/calendar-date.ts) — a card is valid through the end of its own
 * local day, not a fixed UTC instant that reads as expired early or late
 * depending on the shop's timezone offset.
 */
export function validVerifiedCertification(
  certification: Certification,
  todayLocal: CalendarDate,
): boolean {
  return (
    certification.status === "verified" &&
    (!certification.expiresAt || !isCalendarDateExpired(certification.expiresAt, todayLocal))
  );
}

/**
 * **A card that is still only somebody's word for it.**
 *
 * A diver naming their own level on one of the two public opt-ins writes a
 * `pending` card stamped `selfDeclaredAt` (src/db/self-declared-cards.ts).
 * Nobody at the shop has seen anything, and the person may not even be who the
 * email says — so this is not evidence, and `decideTripAdmission` reads it as
 * absent rather than as a card.
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

/** Shared rank check for course admission and final trip readiness. */
export function hasVerifiedCertificationAtLeast(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
  todayLocal: CalendarDate,
): boolean {
  return certifications.some(
    (certification) =>
      validVerifiedCertification(certification, todayLocal) &&
      levelRank[certification.level] >= levelRank[minimumLevel],
  );
}

function certificationBlocker(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
  todayLocal: CalendarDate,
): ReadinessBlocker | null {
  const verified = certifications.filter((certification) =>
    validVerifiedCertification(certification, todayLocal),
  );
  if (hasVerifiedCertificationAtLeast(certifications, minimumLevel, todayLocal)) {
    return null;
  }
  // `pending` means **a staffer is holding something** — a card was captured
  // and is waiting on the agency lookup. A still-unsighted self-declaration is
  // `pending` too but the shop is holding nothing at all, so it is excluded
  // here and answered by its own code below. Conflating the two told the diver
  // on /ready "your card is with the shop for verification" about a card that
  // does not exist, and simultaneously withdrew the card-entry form that was
  // their only way to send one (`CERT_ENTRY_CODES`) — a diver who ticked a
  // dropdown was left with no move and arrived at the dock without a card.
  if (
    certifications.some(
      (certification) =>
        certification.status === "pending" &&
        !isUnsightedSelfDeclaration(certification) &&
        levelRank[certification.level] >= levelRank[minimumLevel],
    )
  ) {
    return { code: "certification_pending" };
  }
  if (verified.length > 0) {
    return { code: "certification_insufficient", params: { requiredLevel: minimumLevel } };
  }
  if (
    certifications.some(
      (certification) =>
        certification.expiresAt && isCalendarDateExpired(certification.expiresAt, todayLocal),
    )
  ) {
    return { code: "certification_expired" };
  }
  // Below every state backed by something the shop holds, and above plain
  // `missing` only because it can say more: the diver told us a level and
  // nobody has seen a card. Both are "the shop is holding nothing usable", and
  // both offer the diver the card-entry form.
  if (certifications.some(isUnsightedSelfDeclaration)) {
    return { code: "certification_self_declared" };
  }
  return { code: "certification_missing" };
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
  todayLocal: CalendarDate,
): ReadinessBlocker | null {
  const cards = specialtyCertifications.filter((card) => card.specialty === specialty);
  const unexpired = (card: SpecialtyCertification) =>
    !card.expiresAt || !isCalendarDateExpired(card.expiresAt, todayLocal);
  if (
    cards.some(
      (card) =>
        card.status === "verified" &&
        unexpired(card) &&
        // Confirmed by a staffer, or never needed confirming (entered by hand).
        (!card.importedAt || card.reviewedAt),
    )
  ) {
    return null;
  }
  // Ahead of `pending` and `missing`: this diver is one tap from cleared, and
  // saying so is what turns a blocker into an action a staffer can take. The
  // `verified` check keeps the two blockers from overlapping — an imported card
  // is written `verified`, so a `pending` card is a capture awaiting review and
  // gets that message instead. Either way the gate stays shut.
  if (
    cards.some(
      (card) =>
        card.status === "verified" && card.importedAt && !card.reviewedAt && unexpired(card),
    )
  ) {
    return { code: "specialty_import_unconfirmed", params: { specialty } };
  }
  if (cards.some((card) => card.status === "pending")) {
    return { code: "specialty_pending", params: { specialty } };
  }
  if (cards.some((card) => card.expiresAt && isCalendarDateExpired(card.expiresAt, todayLocal))) {
    return { code: "specialty_expired", params: { specialty } };
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
  const todayLocal = calendarDateInTimezone(now, input.timezone);
  const blockers: ReadinessBlocker[] = [];

  // Evaluated ahead of — and independently of — the trip's own requirements: a
  // booking that reused an existing person under a mismatched name must never
  // board on that person's certs/waiver until staff confirm it is the same
  // human (H-13), even on a trip whose requirements aren't configured yet.
  if (input.identityUnconfirmed) {
    blockers.push({ code: "identity_unconfirmed" });
  }

  // Also ahead of the trip's requirements, and for the same reason: an
  // under-age student is under-age whether or not anyone has configured the
  // trip's cert gates yet. Measured on the day the course runs, matching the
  // booking gate (src/db/bookings.ts).
  if (input.courseDate) {
    const age = checkMinimumAge(input.dateOfBirth, input.courseMinimumAge, input.courseDate);
    if (age.status === "under") {
      blockers.push({
        code: "under_minimum_age",
        params: { age: age.age, minimumAge: age.minimumAge },
      });
    }
  }

  if (!input.requirement) {
    blockers.push({ code: "requirements_not_configured" });
    return { status: "blocked", blockers };
  }

  if (input.requirement.requiresWaiver) {
    const state = waiverState(input.waiver, now);
    if (state === "not_sent") blockers.push({ code: "waiver_not_sent" });
    if (state === "awaiting_signature") {
      blockers.push({ code: "waiver_pending" });
    }
    if (state === "expired") blockers.push({ code: "waiver_expired" });
    if (state === "medical_review") {
      blockers.push({ code: "medical_review" });
    }
  }

  const effective = combineCertRequirements(input.requirement, input.siteRequirement);

  if (effective.minimumCertificationLevel) {
    const certification = certificationBlocker(
      input.certifications,
      effective.minimumCertificationLevel,
      todayLocal,
    );
    if (certification) blockers.push(certification);
  }

  for (const specialty of effective.requiredSpecialties) {
    const blocker = specialtyBlocker(input.specialtyCertifications ?? [], specialty, todayLocal);
    if (blocker) blockers.push(blocker);
  }

  if (effective.requiresNitrox) {
    const blocker = nitroxBlocker(input.nitroxCertifications ?? []);
    if (blocker) blockers.push(blocker);
  }

  if (input.requirement.requiresPayment) {
    const status = input.paymentStatus ?? "unpaid";
    if (!PAYMENT_CLEARED.has(status)) {
      blockers.push({ code: status === "refunded" ? "payment_refunded" : "payment_due" });
    }
  }
  return { status: blockers.length === 0 ? "ready" : "blocked", blockers };
}
