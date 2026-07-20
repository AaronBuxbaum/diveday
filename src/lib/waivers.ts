import { createHash, randomBytes } from "node:crypto";
import type { MedicalAnswers, WaiverRecord } from "@/db/schema";
import { flaggedMedicalPrompts, needsPhysicianReview } from "./medical";

export const WAIVER_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A neutral starting release so a new shop is never left with a blank waiver.
 * It is sample text, not legal advice: shops are expected to edit it (each edit
 * is saved as a new version), and their own counsel should review the wording.
 */
export const DEFAULT_WAIVER_TITLE = "Diving Release & Liability Waiver";

export const DEFAULT_WAIVER_BODY = [
  "Release of Liability, Waiver of Claims, and Assumption of Risk",
  "",
  "I understand that scuba diving, snorkeling, and boat travel carry inherent risks — including changing weather and sea conditions, boat and equipment handling, marine life, decompression illness, barotrauma, and other hazards that can lead to serious injury or death.",
  "",
  "I confirm that I am in good physical and mental condition to dive, that I am not diving under the influence of alcohol or drugs, and that I will tell the crew before departure if my health, certification, or comfort changes.",
  "",
  "I agree to follow all briefings and instructions from the crew, to use the equipment as trained, to dive within the limits of my certification and experience, and to end any dive I am not comfortable with.",
  "",
  "Knowing these risks, I voluntarily assume full responsibility for them and, to the fullest extent permitted by law, release and hold harmless the dive shop, its staff, boat crew, and vessel from any claim arising from my participation, except for injury caused by their gross negligence or willful misconduct.",
  "",
  "I have read this release in full, understand it, and agree to it freely.",
].join("\n");

export function createWaiverToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashWaiverToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Any referral-flagged "yes" needs physician review; fails closed (medical.ts). */
export function needsMedicalReview(answers: MedicalAnswers): boolean {
  return needsPhysicianReview(answers);
}

export type WaiverState =
  | "not_sent"
  | "awaiting_signature"
  | "expired"
  | "complete"
  | "medical_review";

/** Presentational state stays derived so an expired pending record fails closed. */
export function waiverState(record: WaiverRecord | null, now: Date = new Date()): WaiverState {
  if (!record) return "not_sent";
  if (record.status === "completed") return "complete";
  if (record.status === "medical_review") return "medical_review";
  return record.expiresAt <= now ? "expired" : "awaiting_signature";
}

export type WaiverActivityEntry = {
  recordId: string;
  at: Date;
  kind: "issued" | "started" | "completed" | "medical_review" | "superseded";
  title: string;
  detail: string;
};

/**
 * Staff activity is derived from the immutable evidence and lifecycle fields;
 * it never mutates a signed record or invents an event that was not stored.
 */
export function waiverActivityTimeline(records: readonly WaiverRecord[]): WaiverActivityEntry[] {
  const entries: WaiverActivityEntry[] = [];
  for (const record of records) {
    entries.push({
      recordId: record.id,
      at: record.createdAt,
      kind: "issued",
      title: "Completion link issued",
      detail: `${record.templateTitle} v${record.templateVersion}`,
    });
    if (record.startedAt) {
      entries.push({
        recordId: record.id,
        at: record.startedAt,
        kind: "started",
        title: "Diver started the waiver",
        detail: "Progress was saved for later completion.",
      });
    }
    if (record.completedAt) {
      const medicalReview = record.status === "medical_review";
      const flagged =
        medicalReview && record.medicalAnswers ? flaggedMedicalPrompts(record.medicalAnswers) : [];
      entries.push({
        recordId: record.id,
        at: record.completedAt,
        kind: medicalReview ? "medical_review" : "completed",
        title: medicalReview ? "Medical review required" : "Waiver signed",
        detail: medicalReview
          ? flagged.length > 0
            ? `Physician clearance needed — flagged: ${flagged.join("; ")}`
            : "A staff member must follow up before the diver is ready."
          : "Signed evidence is complete.",
      });
    }
    if (record.supersededAt) {
      entries.push({
        recordId: record.id,
        at: record.supersededAt,
        kind: "superseded",
        title: "Completion link replaced",
        detail: "The pending link is no longer usable.",
      });
    }
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}
