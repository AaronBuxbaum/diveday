import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { waiverState } from "./waivers";

export const CERTIFICATION_LEVEL_LABELS = {
  open_water: "Open Water",
  advanced_open_water: "Advanced Open Water",
  rescue: "Rescue Diver",
  divemaster: "Divemaster",
  instructor: "Instructor",
} as const;

export type CertificationLevel = keyof typeof CERTIFICATION_LEVEL_LABELS;

const levelRank: Record<CertificationLevel, number> = {
  open_water: 1,
  advanced_open_water: 2,
  rescue: 3,
  divemaster: 4,
  instructor: 5,
};

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
  | "certification_insufficient";

export type ReadinessBlocker = { code: ReadinessBlockerCode; message: string };

export type ReadinessResult = {
  status: "ready" | "blocked";
  blockers: ReadinessBlocker[];
};

export type ReadinessInput = {
  requirement: TripRequirement | null;
  waiver: WaiverRecord | null;
  certifications: readonly Certification[];
  now?: Date;
};

function validVerifiedCertification(certification: Certification, now: Date): boolean {
  return (
    certification.status === "verified" &&
    (!certification.expiresAt || certification.expiresAt > now)
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
  if (verified.some((certification) => levelRank[certification.level] >= levelRank[minimumLevel])) {
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
 * The shared safety boundary. Every unknown or non-ready input becomes a
 * human-readable blocker; only explicit evidence can produce `ready`.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const now = input.now ?? new Date();
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

  const certification = certificationBlocker(
    input.certifications,
    input.requirement.minimumCertificationLevel,
    now,
  );
  if (certification) blockers.push(certification);
  return { status: blockers.length === 0 ? "ready" : "blocked", blockers };
}
