import { createHmac } from "node:crypto";
import type { WaiverRecord } from "@/db/schema";

export type WaiverIntegrityState = "valid" | "invalid" | "unsealed";

export type IntegrityValue =
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
 * - **3** — a signed release *refiled* under another diver record: its diver
 *   was merged into the record the shop kept (`refileWaiverRecords`, issue
 *   #2080). Version 1's field set plus who moved it, when, and from which
 *   record, so the new `person_id` verifies as the shop's act rather than
 *   reading as tampering.
 * - **4** — a signed release whose **guardian's email was erased** on the
 *   guardian's own request (H-20261007-guardian-email-erasure, issue #1673): every fact version 3 seals
 *   except `guardian_email`, plus who erased it and when. The guardian is a
 *   third party with no record of their own; the address was the one thing on
 *   the release that was theirs to take back, and nulling it under version 1
 *   would have made an honest release read as tampered.
 *
 * A record verifies against the version it declares in `integrity_version`,
 * never against a guess. A version this build does not know reads as `invalid`
 * rather than as valid — a record whose seal cannot be checked must never
 * present itself as checked.
 */
export const WAIVER_INTEGRITY_VERSION_SIGNED = 1;
export const WAIVER_INTEGRITY_VERSION_ERASED = 2;
export const WAIVER_INTEGRITY_VERSION_MOVED = 3;
export const WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED = 4;

export type WaiverIntegrityVersion =
  | typeof WAIVER_INTEGRITY_VERSION_SIGNED
  | typeof WAIVER_INTEGRITY_VERSION_ERASED
  | typeof WAIVER_INTEGRITY_VERSION_MOVED
  | typeof WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED;

export function isWaiverIntegrityVersion(value: number | null): value is WaiverIntegrityVersion {
  return (
    value === WAIVER_INTEGRITY_VERSION_SIGNED ||
    value === WAIVER_INTEGRITY_VERSION_ERASED ||
    value === WAIVER_INTEGRITY_VERSION_MOVED ||
    value === WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED
  );
}

/**
 * The version a still-signed release is re-sealed under after an act by the
 * shop: version 4 once its guardian's address has been erased — whatever
 * happens to it afterwards, the address stays out — otherwise version 3 if it
 * has been refiled, otherwise version 1. Erasure of the diver is not this
 * question; it always seals version 2.
 */
/**
 * **Every column a seal can cover, under any version, and the seal itself.**
 * The integrity readers (the signature log, one signed record) select exactly
 * these (`WAIVER_SEALED_COLUMNS`, src/db/waiver-record-columns.ts), never the
 * bearer token or the unsigned draft. Every field set below takes
 * {@link WaiverSealedFields}, so a field a version starts sealing that is
 * missing here fails to compile rather than hashing `undefined`.
 */
export const WAIVER_SEALED_FIELDS = [
  "id",
  "shopId",
  "bookingId",
  "personId",
  "templateId",
  "templateTitle",
  "templateVersion",
  "templateBody",
  "status",
  "signedName",
  "signatureMethod",
  "recordedByPersonId",
  "consentedAt",
  "signedAt",
  "medicalAnswers",
  "medicalReviewRequired",
  "shopAnswers",
  "medicalAlert",
  "guardianName",
  "guardianRelationship",
  "guardianEmail",
  "guardianSignatureMethod",
  "guardianConsentedAt",
  "guardianSignedAt",
  "completedAt",
  "importedFromLabel",
  "importSourceDocumentUrl",
  "importSourceMedicalDocumentUrl",
  "createdAt",
  "anonymizedAt",
  "anonymizedByPersonId",
  "movedFromPersonId",
  "movedAt",
  "movedByPersonId",
  "guardianEmailErasedAt",
  "guardianEmailErasedByPersonId",
  "integrityHash",
  "integrityVersion",
] as const satisfies readonly (keyof WaiverRecord)[];

export type WaiverSealedField = (typeof WAIVER_SEALED_FIELDS)[number];

/** A waiver record as far as its seal reaches: what verifying it needs, and nothing else. */
export type WaiverSealedFields = Pick<WaiverRecord, WaiverSealedField>;

export function signedIntegrityVersionFor(
  record: Pick<WaiverRecord, "guardianEmailErasedAt" | "movedAt">,
): WaiverIntegrityVersion {
  if (record.guardianEmailErasedAt) return WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED;
  if (record.movedAt) return WAIVER_INTEGRITY_VERSION_MOVED;
  return WAIVER_INTEGRITY_VERSION_SIGNED;
}

/** The signed release fields whose meaning must not drift after completion. */
/**
 * **What version 1 seals, and the one thing it deliberately does not.**
 *
 * The field set is the diver's own signed evidence: who signed, when, against
 * which template body, with which answers. A later act *by the shop* on the
 * same row is outside it, and always has been — `superseded_at` lifts a medical
 * hold and is not sealed, the delivery columns move for months afterwards.
 *
 * The physician clearance (issue #1252) joins that set for the same reason and
 * is called out here because it is the one with teeth: `medical_cleared_at`
 * decides whether a diver may board, and `verifyWaiverIntegrity` answers
 * `valid` over a row where somebody with database write access has set it. So
 * the seal's honest meaning is "the *signed* half of this release is what was
 * recorded", and the departure log prints the clearance as the shop's own act
 * rather than as sealed evidence.
 *
 * `anonymized_at` is inside version 2 for the opposite reason: erasure
 * *destroys* fields this set covers, so without it every erased release would
 * read as tampered rather than as erased.
 *
 * If a future change wants the clearance covered, it is a version 3 over this
 * set plus the clearance columns, re-sealed inside `recordMedicalClearance`'s
 * transaction, with the two fields that survive erasure added to
 * `erasedMetadata` as well (security review M4).
 *
 * **One conditional key: `shopAnswers`** (glossary *Shop question*). The
 * shop's own questions, as asked, with the diver's answers, join this set
 * **only when the record has them** (`shop_answers` not null). Every record
 * signed before the column existed, and every record whose template asked
 * nothing, has no such key, so its digest stays byte-for-byte what it was;
 * a record that has them cannot lose or gain them without reading `invalid`.
 * This bends the rule above that a new field set is a new version number, on
 * purpose: a version 5 for "version 1 plus answers" would have had to be
 * threaded through refiling (3) and the guardian redaction (4), which inherit
 * this set by spreading it and so carry the key without a word of their own.
 * The erased set (2) leaves it out: erasure destroys the answers. The writer
 * keeps the key honest by never writing `[]` and never leaving null under a
 * template that asked something (`buildShopAnswers`). Recorded as an
 * amendment to ADR 20260729-staffing-waiver-audit-and-localized-copy.
 *
 * **A second conditional key: `medicalAlert`** (glossary *Medical alert for
 * the crew*, issue #2960), on exactly the same terms: present only when the
 * diver wrote one (`medical_alert` not null; `readMedicalAlert` never stores
 * `""`), inherited by versions 3 and 4, left out of version 2, and a version 2
 * row that carries one reads `invalid`. Recorded in the same ADR amendment.
 */
function signedMetadata(record: WaiverSealedFields): { [key: string]: IntegrityValue } {
  return {
    // Spread first and only when present: an absent key, not a null one, is
    // what keeps a seal written before shop questions existed verifying.
    ...(record.shopAnswers != null
      ? { shopAnswers: record.shopAnswers as unknown as IntegrityValue }
      : {}),
    ...(record.medicalAlert != null ? { medicalAlert: record.medicalAlert } : {}),
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
    // The guardian's half of a minor's release (ADR
    // 20260907-guardian-co-signature): who co-signed, as what, when, and by
    // which provider. Inside the seal for the same reason `signedName` is — a
    // co-signature removed after the fact is the tampering this exists to
    // catch. Null on every record a guardian never touched, which is what
    // keeps an adult's seal over exactly the fields it always covered.
    guardianName: record.guardianName,
    guardianRelationship: record.guardianRelationship,
    guardianEmail: record.guardianEmail,
    guardianSignatureMethod: record.guardianSignatureMethod,
    guardianConsentedAt: dateValue(record.guardianConsentedAt),
    guardianSignedAt: dateValue(record.guardianSignedAt),
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
function erasedMetadata(record: WaiverSealedFields): IntegrityValue {
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
    // The guardian facts erasure leaves behind: that somebody co-signed, as
    // what, when, and how. Their name and email go with the diver's own.
    guardianRelationship: record.guardianRelationship,
    guardianSignatureMethod: record.guardianSignatureMethod,
    guardianConsentedAt: dateValue(record.guardianConsentedAt),
    guardianSignedAt: dateValue(record.guardianSignedAt),
    completedAt: dateValue(record.completedAt),
    createdAt: dateValue(record.createdAt),
    anonymizedAt: dateValue(record.anonymizedAt),
    anonymizedByPersonId: record.anonymizedByPersonId,
  };
}

/**
 * The refiled field set: everything version 1 seals, plus the move. Only ever
 * written over a record whose version 1 seal verified at the moment it moved
 * (`refileWaiverRecords`), so re-sealing can never launder an edit made
 * before the move. The `version: 3` key separates it from a v1 digest the
 * same way `version: 2` does for erasure.
 *
 * Erasing the diver it now belongs to re-seals it as version 2, which keeps
 * the erasure skeleton and drops the move: the record is then evidence that
 * somebody signed, not of whose record it sat on.
 */
function movedMetadata(record: WaiverSealedFields): IntegrityValue {
  return {
    ...signedMetadata(record),
    version: WAIVER_INTEGRITY_VERSION_MOVED,
    movedFromPersonId: record.movedFromPersonId,
    movedAt: dateValue(record.movedAt),
    movedByPersonId: record.movedByPersonId,
  };
}

/**
 * The redacted field set: everything version 3 seals — the move fields are
 * null on a release that never moved — **minus `guardianEmail`**, plus the
 * redaction itself, so *who took the address off and when* is inside the seal
 * rather than an annotation beside it. The guardian's name, relationship,
 * method and both timestamps stay sealed: they are who signed and when, and a
 * co-signature lifted off a minor's release is still the tampering this
 * catches.
 *
 * Only ever written over a record whose own seal verified at the moment of
 * the erasure (`eraseGuardianEmail`), so it can never launder an earlier edit.
 * The `version: 4` key separates it from every other digest.
 */
function guardianRedactedMetadata(record: WaiverSealedFields): IntegrityValue {
  const { guardianEmail: _redacted, ...signed } = signedMetadata(record);
  return {
    ...signed,
    version: WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
    movedFromPersonId: record.movedFromPersonId,
    movedAt: dateValue(record.movedAt),
    movedByPersonId: record.movedByPersonId,
    guardianEmailErasedAt: dateValue(record.guardianEmailErasedAt),
    guardianEmailErasedByPersonId: record.guardianEmailErasedByPersonId,
  };
}

export function waiverIntegrityMetadata(
  record: WaiverSealedFields,
  version: WaiverIntegrityVersion = WAIVER_INTEGRITY_VERSION_SIGNED,
): IntegrityValue {
  if (version === WAIVER_INTEGRITY_VERSION_ERASED) return erasedMetadata(record);
  if (version === WAIVER_INTEGRITY_VERSION_MOVED) return movedMetadata(record);
  if (version === WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED)
    return guardianRedactedMetadata(record);
  return signedMetadata(record);
}

function integritySecret(): string {
  return (
    process.env.WAIVER_INTEGRITY_SECRET ||
    process.env.AUTH_SECRET ||
    "diveday-development-waiver-integrity-secret"
  );
}

/**
 * The keyed digest every signed-evidence seal is made of: the release's here,
 * and a course form record's (`src/lib/course-form-integrity.ts`). One key and
 * one canonical serialization, so the two cannot drift apart; each field set
 * carries its own domain-separating key so a digest of one kind can never
 * verify as the other.
 */
export function integrityDigest(value: IntegrityValue): string {
  return createHmac("sha256", integritySecret()).update(stable(value)).digest("hex");
}

export function computeWaiverIntegrityHash(
  record: WaiverSealedFields,
  version: WaiverIntegrityVersion = WAIVER_INTEGRITY_VERSION_SIGNED,
): string {
  return integrityDigest(waiverIntegrityMetadata(record, version));
}

export function verifyWaiverIntegrity(
  record: WaiverSealedFields & {
    /**
     * Read when the caller holds the whole row (the signed record page,
     * erasure's re-seal check): an erased record never keeps a draft of its
     * shop answers or its medical alert either. Never part of any digest.
     */
    draftShopAnswers?: unknown;
    draftMedicalAlert?: string | null;
  },
): WaiverIntegrityState {
  if (!record.integrityHash || !record.integrityVersion) return "unsealed";
  if (!isWaiverIntegrityVersion(record.integrityVersion)) return "invalid";
  // A version 2 seal means "erased", and erasure destroys the shop's
  // questions as answered and any draft of them. Answers back on such a row
  // were put there afterwards, and the seal must not vouch for them (security
  // review L2), the way version 4 refuses a guardian address put back. The
  // medical alert for the crew is destroyed the same way (issue #2960).
  if (
    record.integrityVersion === WAIVER_INTEGRITY_VERSION_ERASED &&
    (record.shopAnswers != null ||
      record.draftShopAnswers != null ||
      record.medicalAlert != null ||
      record.draftMedicalAlert != null)
  )
    return "invalid";
  // A version 4 seal is the shop's own redaction, and only means that while
  // the redaction stamp it covers is there and the address is gone. Either
  // missing, the record is not the one that was sealed.
  if (
    record.integrityVersion === WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED &&
    (!record.guardianEmailErasedAt || record.guardianEmail !== null)
  )
    return "invalid";
  return computeWaiverIntegrityHash(record, record.integrityVersion) === record.integrityHash
    ? "valid"
    : "invalid";
}
