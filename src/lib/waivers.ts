import { createHash, randomBytes } from "node:crypto";
import type { MedicalAnswers, WaiverRecord } from "@/db/schema";
import { flaggedMedicalPrompts, needsPhysicianReview } from "./medical";

export const WAIVER_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
