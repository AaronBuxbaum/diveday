import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  PaymentStatus,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
import { nowDate } from "./clock";
import { waiverState } from "./waivers";

/** Payment states that clear the "ready to board" payment gate. */
const PAYMENT_CLEARED: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "deposit_paid",
  "paid",
  "waived",
]);

export const CERTIFICATION_LEVEL_LABELS = {
  open_water: "Open Water",
  advanced_open_water: "Advanced Open Water",
  rescue: "Rescue Diver",
  divemaster: "Divemaster",
  instructor: "Instructor",
} as const;

export type CertificationLevel = keyof typeof CERTIFICATION_LEVEL_LABELS;

/** Activity-gating specialties; each is a yes/no gate, never a ladder rung. */
export const SPECIALTY_LABELS = {
  deep: "Deep",
  wreck: "Wreck",
  night: "Night",
  drysuit: "Drysuit",
} as const satisfies Record<DiveSpecialty, string>;

const levelRank: Record<CertificationLevel, number> = {
  open_water: 1,
  advanced_open_water: 2,
  rescue: 3,
  divemaster: 4,
  instructor: 5,
};

/** The stricter of two levels; null means "no level demanded" and never wins. */
export function higherCertificationLevel(
  a: CertificationLevel | null | undefined,
  b: CertificationLevel | null | undefined,
): CertificationLevel | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return levelRank[a] >= levelRank[b] ? a : b;
}

/** A dive site's inherent cert gate, composed into every trip that visits it. */
export type SiteCertRequirement = {
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: readonly DiveSpecialty[];
  requiresNitrox: boolean;
};

/**
 * The gate a diver is actually held to on a trip: the stricter minimum level,
 * the union of specialties, and nitrox if either the trip or its dive site
 * demands it.
 */
export function combineCertRequirements(
  requirement: TripRequirement,
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

export type ReadinessBlockerCode =
  | "requirements_not_configured"
  | "waiver_not_sent"
  | "waiver_pending"
  | "waiver_expired"
  | "medical_review"
  | "certification_missing"
  | "certification_pending"
  | "certification_rejected"
  | "certification_expired"
  | "certification_insufficient"
  | "specialty_missing"
  | "specialty_pending"
  | "specialty_rejected"
  | "specialty_expired"
  | "nitrox_missing"
  | "nitrox_pending"
  | "nitrox_rejected"
  | "payment_due"
  | "readiness_unavailable";

export type ReadinessBlocker = { code: ReadinessBlockerCode; message: string };

/** The requirement family a blocker belongs to, shared by every readiness view. */
export type BlockerCategory = "waiver" | "certification" | "payment" | "setup";

export const BLOCKER_CATEGORY: Record<ReadinessBlockerCode, BlockerCategory> = {
  requirements_not_configured: "setup",
  readiness_unavailable: "setup",
  waiver_not_sent: "waiver",
  waiver_pending: "waiver",
  waiver_expired: "waiver",
  medical_review: "waiver",
  certification_missing: "certification",
  certification_pending: "certification",
  certification_rejected: "certification",
  certification_expired: "certification",
  certification_insufficient: "certification",
  specialty_missing: "certification",
  specialty_pending: "certification",
  specialty_rejected: "certification",
  specialty_expired: "certification",
  nitrox_missing: "certification",
  nitrox_pending: "certification",
  nitrox_rejected: "certification",
  payment_due: "payment",
};

export type ReadinessResult = {
  status: "ready" | "blocked";
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
  now?: Date;
};

/** A safety surface must never treat a failed readiness lookup as a pass. */
export function unavailableReadiness(): ReadinessResult {
  return {
    status: "blocked",
    blockers: [
      {
        code: "readiness_unavailable",
        message: "Readiness evidence is unavailable. Do not board this diver until it is checked.",
      },
    ],
  };
}

export function validVerifiedCertification(certification: Certification, now: Date): boolean {
  return (
    certification.status === "verified" &&
    (!certification.expiresAt || certification.expiresAt > now)
  );
}

/** Shared rank check for course admission and final trip readiness. */
export function hasVerifiedCertificationAtLeast(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
  now: Date = nowDate(),
): boolean {
  return certifications.some(
    (certification) =>
      validVerifiedCertification(certification, now) &&
      levelRank[certification.level] >= levelRank[minimumLevel],
  );
}

function certificationBlocker(
  certifications: readonly Certification[],
  minimumLevel: CertificationLevel,
  now: Date,
): ReadinessBlocker | null {
  const verified = certifications.filter((certification) =>
    validVerifiedCertification(certification, now),
  );
  if (hasVerifiedCertificationAtLeast(certifications, minimumLevel, now)) {
    return null;
  }
  if (
    certifications.some(
      (certification) =>
        certification.status === "pending" &&
        levelRank[certification.level] >= levelRank[minimumLevel],
    )
  ) {
    return {
      code: "certification_pending",
      message: "Certification is waiting for staff verification.",
    };
  }
  if (verified.length > 0) {
    return {
      code: "certification_insufficient",
      message: `${CERTIFICATION_LEVEL_LABELS[minimumLevel]} or higher is required for this trip.`,
    };
  }
  if (certifications.some((certification) => certification.status === "rejected")) {
    return {
      code: "certification_rejected",
      message: "Certification needs a corrected card or review.",
    };
  }
  if (
    certifications.some(
      (certification) => certification.expiresAt && certification.expiresAt <= now,
    )
  ) {
    return { code: "certification_expired", message: "Certification on file has expired." };
  }
  return { code: "certification_missing", message: "No certification is on file for this trip." };
}

/**
 * A specialty is a yes/no gate: only a verified, unexpired card of that exact
 * specialty clears it. Every other state fails closed with a specific reason.
 */
function specialtyBlocker(
  specialtyCertifications: readonly SpecialtyCertification[],
  specialty: DiveSpecialty,
  now: Date,
): ReadinessBlocker | null {
  const cards = specialtyCertifications.filter((card) => card.specialty === specialty);
  const label = SPECIALTY_LABELS[specialty];
  if (
    cards.some((card) => card.status === "verified" && (!card.expiresAt || card.expiresAt > now))
  ) {
    return null;
  }
  if (cards.some((card) => card.status === "pending")) {
    return {
      code: "specialty_pending",
      message: `${label} specialty card is waiting for staff verification.`,
    };
  }
  if (cards.some((card) => card.status === "rejected")) {
    return {
      code: "specialty_rejected",
      message: `${label} specialty card needs a corrected card or review.`,
    };
  }
  if (cards.some((card) => card.expiresAt && card.expiresAt <= now)) {
    return {
      code: "specialty_expired",
      message: `${label} specialty card on file has expired.`,
    };
  }
  return {
    code: "specialty_missing",
    message: `${label} specialty is required; no card is on file.`,
  };
}

/**
 * Nitrox is a yes/no gate cleared only by a verified enriched-air card. Its
 * evidence lives in nitrox_certifications (which also gates the mix request), and those
 * cards carry no expiry — so there is no expired state, only missing/pending/
 * rejected.
 */
function nitroxBlocker(
  nitroxCertifications: readonly NitroxCertification[],
): ReadinessBlocker | null {
  if (nitroxCertifications.some((card) => card.status === "verified")) return null;
  if (nitroxCertifications.some((card) => card.status === "pending")) {
    return {
      code: "nitrox_pending",
      message: "Nitrox card is waiting for staff verification.",
    };
  }
  if (nitroxCertifications.some((card) => card.status === "rejected")) {
    return {
      code: "nitrox_rejected",
      message: "Nitrox card needs a corrected card or review.",
    };
  }
  return {
    code: "nitrox_missing",
    message: "Nitrox certification is required; no card is on file.",
  };
}

/**
 * The shared safety boundary. Every unknown or non-ready input becomes a
 * human-readable blocker; only explicit evidence can produce `ready`.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const now = input.now ?? nowDate();
  const blockers: ReadinessBlocker[] = [];
  if (!input.requirement) {
    return {
      status: "blocked",
      blockers: [
        {
          code: "requirements_not_configured",
          message: "Trip requirements have not been configured yet.",
        },
      ],
    };
  }

  if (input.requirement.requiresWaiver) {
    const state = waiverState(input.waiver, now);
    if (state === "not_sent")
      blockers.push({ code: "waiver_not_sent", message: "Waiver has not been sent." });
    if (state === "awaiting_signature") {
      blockers.push({
        code: "waiver_pending",
        message: "Waiver is waiting for the diver’s signature.",
      });
    }
    if (state === "expired")
      blockers.push({
        code: "waiver_expired",
        message: "Waiver link expired; issue a fresh link.",
      });
    if (state === "medical_review") {
      blockers.push({ code: "medical_review", message: "A medical answer needs staff follow-up." });
    }
  }

  const effective = combineCertRequirements(input.requirement, input.siteRequirement);

  if (effective.minimumCertificationLevel) {
    const certification = certificationBlocker(
      input.certifications,
      effective.minimumCertificationLevel,
      now,
    );
    if (certification) blockers.push(certification);
  }

  for (const specialty of effective.requiredSpecialties) {
    const blocker = specialtyBlocker(input.specialtyCertifications ?? [], specialty, now);
    if (blocker) blockers.push(blocker);
  }

  if (effective.requiresNitrox) {
    const blocker = nitroxBlocker(input.nitroxCertifications ?? []);
    if (blocker) blockers.push(blocker);
  }

  if (input.requirement.requiresPayment) {
    const status = input.paymentStatus ?? "unpaid";
    if (!PAYMENT_CLEARED.has(status)) {
      blockers.push({
        code: "payment_due",
        message:
          status === "refunded"
            ? "Payment was refunded; collect payment before boarding."
            : "Payment is outstanding for this trip.",
      });
    }
  }
  return { status: blockers.length === 0 ? "ready" : "blocked", blockers };
}
