import type { WaiverRecord } from "@/db/schema";
import { isMinorOnDate } from "./age";
import { type CalendarDate, calendarDateInTimezone } from "./calendar-date";

/**
 * **A minor's release is signed twice** (ADR 20260907-guardian-co-signature).
 *
 * H-21 shipped the *fact* of a minor — age on the roster, a badge on the
 * manifest — and deliberately left the waiver as one signature, flagged for
 * the H-01–H-03 legal review rather than forgotten. The owner decided on
 * 2026-09-07 to build the co-signature: when the diver a release is for is
 * under the age of majority on the day they sign, a parent or legal guardian
 * signs the same release, on the same page, with the same typed-consent
 * evidence (`src/lib/signatures.ts`).
 *
 * Everything here is a pure rule over a record and a signer; the writers in
 * `src/db/waivers.ts` refuse on it and the readiness engine blocks on it.
 */

/**
 * Who the co-signer is to the diver. A **code**, never free text: it renders
 * on the roster, the manifest and the signature log, and has to arrive in the
 * reader's language (`src/i18n/guardian-labels.ts`), the same reason a dive
 * site's difficulty is a code (ADR 20260813-dive-site-difficulty-is-a-code).
 */
export const GUARDIAN_RELATIONSHIPS = ["parent", "legal_guardian"] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export function isGuardianRelationship(value: unknown): value is GuardianRelationship {
  return (
    typeof value === "string" && (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(value)
  );
}

/**
 * What the writers need to know about the person a release is for: their date
 * of birth (null when the shop holds none) and the shop's zone, which is what
 * turns a signing instant into the calendar day the age is measured on.
 */
export type GuardianSigner = {
  dateOfBirth: CalendarDate | null | undefined;
  timezone: string;
};

/** The guardian half of a release, as a shape the surfaces and writers share. */
export type GuardianSignature = {
  name: string;
  relationship: GuardianRelationship;
};

/**
 * Whether a release signed **on this day** by **this diver** needs a guardian's
 * signature beside it.
 *
 * Fails open on an unknown date of birth, exactly as H-08's minimum-age gate
 * does: a diver the shop never asked is treated as an adult, and the day a
 * date is put on file, `guardianSignatureMissing` below turns the release
 * they already signed into a block rather than a silent pass.
 */
export function guardianSignatureRequired(
  dateOfBirth: CalendarDate | null | undefined,
  signedOn: CalendarDate,
): boolean {
  if (!dateOfBirth) return false;
  return isMinorOnDate(dateOfBirth, signedOn);
}

/** The shop-local calendar day a signing instant fell on. */
export function signingDate(signedAt: Date, timezone: string): CalendarDate {
  return calendarDateInTimezone(signedAt, timezone);
}

/** A record a guardian has co-signed, whatever else is true about it. */
export function waiverSignedByGuardian(record: Pick<WaiverRecord, "guardianSignedAt">): boolean {
  return record.guardianSignedAt !== null;
}

/**
 * **The gate.** A signed release that a minor gave alone.
 *
 * Measured on the day the diver *signed*, not today: a release a seventeen-
 * year-old executed solo does not become valid on their eighteenth birthday,
 * so the question is whether a guardian was needed when the pen moved. Only a
 * record with a signature on it can be missing one — a pending link, an
 * expired link and a record that was never signed are somebody else's
 * blocker, and the readiness engine names those first.
 *
 * Reaches three places, and deliberately the same predicate in each: the
 * readiness engine raises `guardian_signature_missing` on it, the issue path
 * refuses to treat such a record as *standing* so a fresh link (which asks
 * for both signatures) can go out, and the diver record's status reads it as
 * its own state rather than as "Signed".
 */
export function guardianSignatureMissing(
  record: Pick<WaiverRecord, "status" | "signedAt" | "completedAt" | "guardianSignedAt">,
  signer: GuardianSigner,
): boolean {
  if (record.status !== "completed" && record.status !== "medical_review") return false;
  const signedAt = record.signedAt ?? record.completedAt;
  if (!signedAt) return false;
  if (waiverSignedByGuardian(record)) return false;
  return guardianSignatureRequired(signer.dateOfBirth, signingDate(signedAt, signer.timezone));
}

/**
 * The guardian half of a record, for a surface that shows a signature — or
 * null when nobody co-signed, or when erasure has taken the name
 * (`src/db/anonymize.ts` strips it and keeps the fact of the signature).
 */
export function guardianSignatureOf(
  record: Pick<WaiverRecord, "guardianSignedAt" | "guardianName" | "guardianRelationship">,
): GuardianSignature | null {
  if (!record.guardianSignedAt || !record.guardianName) return null;
  if (!isGuardianRelationship(record.guardianRelationship)) return null;
  return { name: record.guardianName, relationship: record.guardianRelationship };
}
