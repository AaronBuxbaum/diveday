import type { CourseFormRecord } from "@/db/schema";
import { type IntegrityValue, integrityDigest } from "@/lib/waiver-integrity";

/**
 * **The integrity seal on a signed course form** (issue #2266): the release's
 * seal (`src/lib/waiver-integrity.ts`) brought to the other paper a student
 * signs (ADR 20261008-course-forms). Same key, same canonical serialization;
 * a field set of its own.
 *
 * - **1** — the record as signed: the words, the form and its version, the
 *   booking and session, who signed, how and when, and a guardian's
 *   co-signature. Re-sealed when a guardian completes a record a minor signed
 *   alone, and only when the seal verified the moment before.
 * - **2** — the record after erasure (ADR 20260802-diver-data-erasure): the
 *   same set minus the two names erasure destroys, plus who erased it and
 *   when, so an erased record reads as erased rather than as tampered.
 *
 * **`person_id` is inside both**, with the booking. A diver merge moves a
 * record to the kept diver through `refileCourseFormRecords`
 * (`src/db/course-forms.ts`), which re-seals it only when it verified the
 * moment before, as a guardian's completion does. Re-matching a held seat to
 * a new diver (`splitBookingIdentity`, `src/db/bookings.ts`) changes
 * `bookings.person_id` and leaves form records where they are, still sealed
 * over the diver who signed them: a held seat cannot sign a course form
 * (H-13), so there is nothing on it to move.
 *
 * A record verifies against the version it declares, never a guess, and a
 * version this build does not know reads as `invalid`.
 */
export const COURSE_FORM_INTEGRITY_VERSION_SIGNED = 1;
export const COURSE_FORM_INTEGRITY_VERSION_ERASED = 2;

export type CourseFormIntegrityVersion =
  | typeof COURSE_FORM_INTEGRITY_VERSION_SIGNED
  | typeof COURSE_FORM_INTEGRITY_VERSION_ERASED;

export type CourseFormIntegrityState = "valid" | "invalid" | "unsealed";

/** The record's sealable shape: every column but the seal itself. */
type SealableRecord = Omit<CourseFormRecord, "integrityHash" | "integrityVersion">;

function dateValue(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/**
 * The facts both versions keep. The `kind` key separates every course form
 * digest from every release digest, which carry no such key.
 */
function survivingFacts(record: SealableRecord): { [key: string]: IntegrityValue } {
  return {
    kind: "course_form_record",
    id: record.id,
    shopId: record.shopId,
    bookingId: record.bookingId,
    personId: record.personId,
    formId: record.formId,
    formVersionId: record.formVersionId,
    formTitle: record.formTitle,
    formVersion: record.formVersion,
    formBody: record.formBody,
    courseTitle: record.courseTitle,
    tripId: record.tripId,
    instructorNames: record.instructorNames,
    paperSignedOn: record.paperSignedOn,
    signatureMethod: record.signatureMethod,
    recordedByPersonId: record.recordedByPersonId,
    consentedAt: dateValue(record.consentedAt),
    signedAt: dateValue(record.signedAt),
    guardianRelationship: record.guardianRelationship,
    guardianSignatureMethod: record.guardianSignatureMethod,
    guardianConsentedAt: dateValue(record.guardianConsentedAt),
    guardianSignedAt: dateValue(record.guardianSignedAt),
    createdAt: dateValue(record.createdAt),
  };
}

export function courseFormIntegrityMetadata(
  record: SealableRecord,
  version: CourseFormIntegrityVersion,
): IntegrityValue {
  if (version === COURSE_FORM_INTEGRITY_VERSION_ERASED) {
    return {
      ...survivingFacts(record),
      version,
      anonymizedAt: dateValue(record.anonymizedAt),
      anonymizedByPersonId: record.anonymizedByPersonId,
    };
  }
  return {
    ...survivingFacts(record),
    version,
    signedName: record.signedName,
    guardianName: record.guardianName,
  };
}

export function computeCourseFormIntegrityHash(
  record: SealableRecord,
  version: CourseFormIntegrityVersion,
): string {
  return integrityDigest(courseFormIntegrityMetadata(record, version));
}

/** The two seal columns for a record, ready to `.set()`. */
export function courseFormSeal(
  record: SealableRecord,
  version: CourseFormIntegrityVersion,
): { integrityHash: string; integrityVersion: CourseFormIntegrityVersion } {
  return {
    integrityHash: computeCourseFormIntegrityHash(record, version),
    integrityVersion: version,
  };
}

export function verifyCourseFormIntegrity(
  record: Pick<CourseFormRecord, "integrityHash" | "integrityVersion"> & SealableRecord,
): CourseFormIntegrityState {
  if (!record.integrityHash || !record.integrityVersion) return "unsealed";
  const version = record.integrityVersion;
  if (
    version !== COURSE_FORM_INTEGRITY_VERSION_SIGNED &&
    version !== COURSE_FORM_INTEGRITY_VERSION_ERASED
  ) {
    return "invalid";
  }
  // A version 2 seal means the record was erased; without the stamp it covers,
  // or with a name back on it, it is not the record that was sealed.
  if (
    version === COURSE_FORM_INTEGRITY_VERSION_ERASED &&
    (!record.anonymizedAt || record.signedName !== null || record.guardianName !== null)
  ) {
    return "invalid";
  }
  return computeCourseFormIntegrityHash(record, version) === record.integrityHash
    ? "valid"
    : "invalid";
}
