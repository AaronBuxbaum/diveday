import { randomBytes } from "node:crypto";

/**
 * Waiver domain logic (M3), framework-free so the signing page, the desk
 * check-in roll-up, and tests all agree on what a signed waiver means.
 *
 * The medical statement is an RSTC-style screen: a "yes" to any question means
 * a physician must clear the diver before they board — a blocking state, never
 * a checkbox we can wave through (docs/product/glossary.md).
 */

export type WaiverStatus = "pending" | "signed" | "physician_required";

export type MedicalQuestion = {
  id: string;
  /** Shown to the diver; plain, non-clinical phrasing. */
  prompt: string;
};

/**
 * A representative subset of the RSTC diver medical screen. Answering "yes" to
 * any of these historically requires a physician's sign-off before diving.
 * Not medical advice or a complete form — the shop's template governs.
 */
export const MEDICAL_QUESTIONS: readonly MedicalQuestion[] = [
  { id: "heart", prompt: "Heart disease, a heart attack, or heart surgery" },
  { id: "breathing", prompt: "Asthma, or wheezing or shortness of breath in the last 12 months" },
  { id: "lung", prompt: "Collapsed lung, chest surgery, or other lung disease" },
  { id: "blackout", prompt: "Fainting, seizures, or blackouts of any kind" },
  { id: "ear", prompt: "Recurrent ear or sinus problems, or ear surgery" },
  { id: "pregnancy", prompt: "Currently pregnant, or trying to become pregnant" },
  { id: "medication", prompt: "Taking prescription medication (other than birth control)" },
] as const;

/** questionId → the diver's yes/no answer. Missing keys read as "no". */
export type MedicalAnswers = Record<string, boolean>;

/** Ids of every question the diver answered "yes" to, in question order. */
export function flaggedMedicalIds(answers: MedicalAnswers): string[] {
  return MEDICAL_QUESTIONS.filter((q) => answers[q.id] === true).map((q) => q.id);
}

/** True when any medical answer requires a physician referral. */
export function isMedicalFlagged(answers: MedicalAnswers): boolean {
  return flaggedMedicalIds(answers).length > 0;
}

/**
 * The status a waiver lands in the moment it is signed. A flagged medical screen
 * blocks boarding until a physician clears the diver; a clean screen is done.
 */
export function statusAfterSigning(medicalFlagged: boolean): WaiverStatus {
  return medicalFlagged ? "physician_required" : "signed";
}

/** Coarse readiness for a booking's waiver dimension, for the check-in roll-up. */
export type WaiverReadiness = "cleared" | "pending" | "blocked";

export function waiverReadiness(
  waiver: { status: WaiverStatus } | null | undefined,
): WaiverReadiness {
  if (!waiver) return "pending";
  if (waiver.status === "signed") return "cleared";
  if (waiver.status === "physician_required") return "blocked";
  return "pending";
}

/**
 * A hard-to-guess token for the pre-arrival signing link. base64url so it drops
 * straight into a URL; 18 bytes ≈ 144 bits of entropy (ADR-0007).
 */
export function newWaiverToken(): string {
  return randomBytes(18).toString("base64url");
}
