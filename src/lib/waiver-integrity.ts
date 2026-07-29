import { createHmac } from "node:crypto";
import type { WaiverRecord } from "@/db/schema";

export type WaiverIntegrityState = "valid" | "invalid" | "unsealed";

type IntegrityValue =
  | string
  | number
  | boolean
  | null
  | IntegrityValue[]
  | {
      [key: string]: IntegrityValue;
    };

function stable(value: IntegrityValue): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key] ?? null)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function dateValue(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/** The signed release fields whose meaning must not drift after completion. */
export function waiverIntegrityMetadata(record: WaiverRecord): IntegrityValue {
  return {
    id: record.id,
    shopId: record.shopId,
    bookingId: record.bookingId,
    personId: record.personId,
    templateId: record.templateId,
    templateTitle: record.templateTitle,
    templateVersion: record.templateVersion,
    templateBody: record.templateBody,
    status: record.status,
    signedName: record.signedName,
    signatureMethod: record.signatureMethod,
    recordedByPersonId: record.recordedByPersonId,
    consentedAt: dateValue(record.consentedAt),
    signedAt: dateValue(record.signedAt),
    medicalAnswers: (record.medicalAnswers as IntegrityValue | null) ?? null,
    medicalReviewRequired: record.medicalReviewRequired,
    completedAt: dateValue(record.completedAt),
    importedFromLabel: record.importedFromLabel,
    importSourceDocumentUrl: record.importSourceDocumentUrl,
    importSourceMedicalDocumentUrl: record.importSourceMedicalDocumentUrl,
    createdAt: dateValue(record.createdAt),
  };
}

function integritySecret(): string {
  return (
    process.env.WAIVER_INTEGRITY_SECRET ||
    process.env.AUTH_SECRET ||
    "diveday-development-waiver-integrity-secret"
  );
}

export function computeWaiverIntegrityHash(record: WaiverRecord): string {
  return createHmac("sha256", integritySecret())
    .update(stable(waiverIntegrityMetadata(record)))
    .digest("hex");
}

export function verifyWaiverIntegrity(record: WaiverRecord): WaiverIntegrityState {
  if (!record.integrityHash || !record.integrityVersion) return "unsealed";
  return computeWaiverIntegrityHash(record) === record.integrityHash ? "valid" : "invalid";
}
