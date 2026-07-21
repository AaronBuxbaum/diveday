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

/**
 * How long a signed waiver keeps satisfying a diver's *future* trips. A diver
 * signs once; the signature carries forward until it ages out. Bounded rather
 * than forever because the release also carries a medical questionnaire, and a
 * medical statement a year stale is no longer trustworthy evidence of fitness.
 */
export const WAIVER_SIGNATURE_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

/** When a record's signature happened, for recency comparisons. */
function signatureTime(record: WaiverRecord): number {
  return (record.signedAt ?? record.completedAt ?? record.createdAt).getTime();
}

/**
 * Whether a completed release still stands for a booking. It must be a clean
 * completion (never one parked in medical review), signed against the shop's
 * current template version (a later edit is different terms the diver never
 * agreed to), and inside the validity window. Applied uniformly — to the
 * booking's own record and to any carried from another booking — so a signature
 * that is stale or against superseded terms is never treated as current, whoever
 * it was signed for. Fails closed on anything missing.
 */
export function isCompletedWaiverCurrent(
  record: WaiverRecord,
  currentTemplateVersion: number | null,
  now: Date = new Date(),
): boolean {
  if (record.status !== "completed") return false;
  if (record.supersededAt) return false;
  if (currentTemplateVersion !== null && record.templateVersion !== currentTemplateVersion) {
    return false;
  }
  const signedAt = record.signedAt ?? record.completedAt;
  if (!signedAt) return false;
  return signedAt.getTime() + WAIVER_SIGNATURE_VALIDITY_MS > now.getTime();
}

/**
 * The single waiver record that governs a booking's readiness once the
 * sign-once rule is applied.
 *
 * A live medical hold on this booking blocks it outright. Otherwise the most
 * recent clean, current signature — the booking's own or one carried from
 * another of the diver's bookings — stands, unless the diver has an unresolved
 * medical hold that is no older than it: a health disclosure made at or after
 * the last clean signature means the signature can no longer be trusted, so it
 * fails closed to that hold. With neither a current signature nor a hold, the
 * booking's own live record (pending/expired) drives the send flow; a stale
 * completed record never reads as complete.
 *
 * `personSignedWaivers` is the diver's signed evidence at the shop — completed
 * and medical-review records, superseded ones excluded.
 */
export function effectiveWaiverForBooking(input: {
  bookingWaiver: WaiverRecord | null;
  personSignedWaivers: readonly WaiverRecord[];
  currentTemplateVersion: number | null;
  now?: Date;
}): WaiverRecord | null {
  const now = input.now ?? new Date();
  const own = input.bookingWaiver;
  if (own?.status === "medical_review") return own;

  const clean = [
    ...(own && isCompletedWaiverCurrent(own, input.currentTemplateVersion, now) ? [own] : []),
    ...input.personSignedWaivers.filter((record) =>
      isCompletedWaiverCurrent(record, input.currentTemplateVersion, now),
    ),
  ].sort((a, b) => signatureTime(b) - signatureTime(a))[0];

  const cleanTime = clean ? signatureTime(clean) : Number.NEGATIVE_INFINITY;
  const hold = input.personSignedWaivers
    .filter((record) => record.status === "medical_review" && !record.supersededAt)
    .filter((record) => signatureTime(record) >= cleanTime)
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];
  if (hold) return hold;

  if (clean) return clean;

  return own && own.status !== "completed" ? own : null;
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

export type MedicalWaiverMark = {
  at: Date;
  /**
   * "digital" — the diver answered the medical questionnaire themselves.
   * "paper" — staff attested a reviewed paper medical (in person). Both are a
   * real review dated on the same 365-day clock; the source only changes wording.
   */
  source: "digital" | "paper";
};

/**
 * When and how a diver's medical currency was last established, for spotting a
 * statement drifting toward a year stale. A digital completion carries the
 * questionnaire; a staff paper attestation (`in_person_attested`) carries a
 * staff-affirmed review with the same validity clock — so both surface a date,
 * *distinctly*, rather than a paper record reading as a missing medical next to
 * a dated one. Only a clean completion counts; a pending or in-review record has
 * no settled medical to show.
 */
export function medicalWaiverMark(record: WaiverRecord | null): MedicalWaiverMark | null {
  if (record === null || record.status !== "completed") return null;
  const at = record.signedAt ?? record.completedAt;
  if (!at) return null;
  if (record.medicalAnswers) return { at, source: "digital" };
  if (record.signatureMethod === "in_person_attested") return { at, source: "paper" };
  return null;
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
