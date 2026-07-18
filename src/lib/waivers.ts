import { createHash, randomBytes } from "node:crypto";
import type { MedicalAnswers, WaiverRecord } from "@/db/schema";

export const WAIVER_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createWaiverToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashWaiverToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function needsMedicalReview(answers: MedicalAnswers): boolean {
  return answers.breathing || answers.medication || answers.recentIllness;
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
