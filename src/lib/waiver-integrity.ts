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

/**
 * Which field set a record's seal covers.
 *
 * - **1** — a signed release exactly as captured: signer name and medical
 *   answers included. Every record sealed by `completeWaiver` or
 *   `recordInPersonWaiver`.
 * - **2** — an *erased* release (ADR 20260802-diver-data-erasure): the same
 *   record after the signer's name, medical answers, and source documents were
 *   destroyed, re-sealed over only the fields that survive.
 *
 * A record verifies against the version it declares in `integrity_version`,
 * never against a guess. A version this build does not know reads as `invalid`
 * rather than as valid — a record whose seal cannot be checked must never
 * present itself as checked.
 */
export const WAIVER_INTEGRITY_VERSION_SIGNED = 1;
export const WAIVER_INTEGRITY_VERSION_ERASED = 2;

export type WaiverIntegrityVersion =
  | typeof WAIVER_INTEGRITY_VERSION_SIGNED
  | typeof WAIVER_INTEGRITY_VERSION_ERASED;

export function isWaiverIntegrityVersion(value: number | null): value is WaiverIntegrityVersion {
  return value === WAIVER_INTEGRITY_VERSION_SIGNED || value === WAIVER_INTEGRITY_VERSION_ERASED;
}

/** The signed release fields whose meaning must not drift after completion. */
function signedMetadata(record: WaiverRecord): IntegrityValue {
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

/**
 * The erasure-survivor field set: the evidence skeleton of a release whose
 * diver has been erased. Deliberately a strict subset of version 1 minus every
 * field erasure destroys (`signedName`, `medicalAnswers`, the import
 * provenance and its source documents), plus the erasure stamp itself, so that
 * *who erased this and when* is inside the seal rather than a mutable
 * annotation beside it.
 *
 * The explicit `version: 2` key is domain separation, not decoration: it makes
 * the two field sets structurally distinct, so a v1 digest can never
 * accidentally collide with a v2 one over a record where the differing fields
 * all happen to be null (an imported record with no medical answers, for
 * instance).
 */
function erasedMetadata(record: WaiverRecord): IntegrityValue {
  return {
    version: WAIVER_INTEGRITY_VERSION_ERASED,
    id: record.id,
    shopId: record.shopId,
    bookingId: record.bookingId,
    personId: record.personId,
    templateId: record.templateId,
    templateTitle: record.templateTitle,
    templateVersion: record.templateVersion,
    templateBody: record.templateBody,
    status: record.status,
    signatureMethod: record.signatureMethod,
    recordedByPersonId: record.recordedByPersonId,
    consentedAt: dateValue(record.consentedAt),
    signedAt: dateValue(record.signedAt),
    medicalReviewRequired: record.medicalReviewRequired,
    completedAt: dateValue(record.completedAt),
    createdAt: dateValue(record.createdAt),
    anonymizedAt: dateValue(record.anonymizedAt),
    anonymizedByPersonId: record.anonymizedByPersonId,
  };
}

export function waiverIntegrityMetadata(
  record: WaiverRecord,
  version: WaiverIntegrityVersion = WAIVER_INTEGRITY_VERSION_SIGNED,
): IntegrityValue {
  return version === WAIVER_INTEGRITY_VERSION_ERASED
    ? erasedMetadata(record)
    : signedMetadata(record);
}

function integritySecret(): string {
  return (
    process.env.WAIVER_INTEGRITY_SECRET ||
    process.env.AUTH_SECRET ||
    "diveday-development-waiver-integrity-secret"
  );
}

export function computeWaiverIntegrityHash(
  record: WaiverRecord,
  version: WaiverIntegrityVersion = WAIVER_INTEGRITY_VERSION_SIGNED,
): string {
  return createHmac("sha256", integritySecret())
    .update(stable(waiverIntegrityMetadata(record, version)))
    .digest("hex");
}

export function verifyWaiverIntegrity(record: WaiverRecord): WaiverIntegrityState {
  if (!record.integrityHash || !record.integrityVersion) return "unsealed";
  if (!isWaiverIntegrityVersion(record.integrityVersion)) return "invalid";
  return computeWaiverIntegrityHash(record, record.integrityVersion) === record.integrityHash
    ? "valid"
    : "invalid";
}
