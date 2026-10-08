import { type GuardianSigner, guardianSignatureRequired, signingDate } from "./guardian";

/**
 * **Course forms**, the pure half (ADR 20261008-course-forms).
 *
 * A course can ask each student to sign forms on top of the shop's release —
 * an agency's liability release for that course, a safe-diving-practices
 * statement. This module decides, from rows the caller has already read,
 * which of a booking's required forms are still unsigned. It reads nothing and
 * writes nothing; `src/db/course-forms.ts` does both, and the readiness engine
 * (`src/lib/readiness.ts`) turns the answer into blockers.
 */

/**
 * **Whether an unsigned course form holds a student off the boat.**
 *
 * `true`: an unsigned required form makes the student Blocked for boarding,
 * exactly like a missing release (`course_form_unsigned` in
 * `src/lib/readiness.ts`). `false`: the form is still owed and still shown on
 * the course roster and the trip's Divers tab, but as a warning that never
 * flips a student to Blocked.
 *
 * One switch on purpose, pending the owner's call (ADR 20261008-course-forms):
 * flipping it is the whole change. Booking-time admission
 * (`src/lib/trip-admission.ts`) never reads it — a student may always *buy* a
 * place on a course before signing its forms.
 */
export const COURSE_FORMS_BLOCK_BOARDING = true;

/** The longest title and body a shop may save, the release's own body limit. */
export const COURSE_FORM_TITLE_MAX = 120;
export const COURSE_FORM_BODY_MIN = 40;
export const COURSE_FORM_BODY_MAX = 12_000;

/** One form a course requires, at its current version. */
export type RequiredCourseForm = {
  shopId: string;
  formId: string;
  /** The current version's id: the one a student signs now. */
  versionId: string;
  version: number;
  title: string;
  position: number;
  /**
   * Older versions that still count for this session: the one that was
   * current when a session that has started began. A student who signed the
   * words in force on the first morning has agreed to the course they are
   * taking; an edit made mid-course asks the next session, not this one, to
   * sign again. Absent before a session starts, when only `versionId` counts.
   */
  alsoAccepted?: readonly string[];
};

/** What a signature has to say about itself for this module to weigh it. */
export type CourseFormSignature = {
  shopId: string;
  bookingId: string;
  personId: string;
  formVersionId: string;
  signedAt: Date;
  guardianSignedAt: Date | null;
  /**
   * The date written on a paper copy, when staff gave one: the day the
   * student's age is measured on, in place of the day it was recorded.
   */
  paperSignedOn?: string | null;
};

/**
 * **A signature that counts for this enrollment.** Every condition fails closed:
 *
 * - the same shop — a record another shop holds is not this shop's evidence;
 * - the same booking and the same person — a form is signed per enrollment, by
 *   the student on it, never carried from another course or another diver;
 * - the current version, or the one current when a started session began
 *   (`alsoAccepted`) — a student who signed different words has not agreed to
 *   these;
 * - a guardian's co-signature when the student was a minor on the day they
 *   signed (ADR 20260907-guardian-co-signature), measured in the shop's zone.
 */
export function signatureSatisfies(
  signature: CourseFormSignature,
  form: RequiredCourseForm,
  enrollment: { shopId: string; bookingId: string; personId: string; signer: GuardianSigner },
): boolean {
  if (signature.shopId !== enrollment.shopId) return false;
  if (form.shopId !== enrollment.shopId) return false;
  if (signature.bookingId !== enrollment.bookingId) return false;
  if (signature.personId !== enrollment.personId) return false;
  if (!signatureNamesForm(signature, form)) return false;
  return !guardianStillOwed(signature, enrollment.signer);
}

function signatureNamesForm(signature: CourseFormSignature, form: RequiredCourseForm): boolean {
  return (
    signature.formVersionId === form.versionId ||
    (form.alsoAccepted ?? []).includes(signature.formVersionId)
  );
}

/** A minor on the day they signed, with no guardian's signature beside theirs. */
function guardianStillOwed(signature: CourseFormSignature, signer: GuardianSigner): boolean {
  const signedOn = signature.paperSignedOn ?? signingDate(signature.signedAt, signer.timezone);
  const minorWhenSigned = guardianSignatureRequired(signer.dateOfBirth, signedOn);
  return minorWhenSigned && signature.guardianSignedAt === null;
}

/** Why a form is still owed: nobody signed it, or only the student did. */
export type CourseFormGap = "unsigned" | "guardian_missing";

/**
 * **What each owed form is missing**, in the course's order. `guardian_missing`
 * is a form the student signed while a minor with no guardian beside them —
 * often because their date of birth reached the shop after they signed. It is
 * still owed, and it is told apart because the fix is a parent's signature,
 * not the student's.
 */
export function courseFormGaps(input: {
  shopId: string;
  bookingId: string;
  personId: string;
  required: readonly RequiredCourseForm[];
  signatures: readonly CourseFormSignature[];
  signer: GuardianSigner;
}): { form: RequiredCourseForm; gap: CourseFormGap }[] {
  return outstandingCourseForms(input).map((form) => {
    const studentSigned = input.signatures.some(
      (signature) =>
        signature.shopId === input.shopId &&
        signature.bookingId === input.bookingId &&
        signature.personId === input.personId &&
        form.shopId === input.shopId &&
        signatureNamesForm(signature, form),
    );
    return { form, gap: studentSigned ? "guardian_missing" : "unsigned" };
  });
}

/**
 * The forms this enrollment still owes, in the course's own order. A required
 * form that belongs to another shop is owed, never skipped: a requirement the
 * shop cannot satisfy is not a requirement it may ignore.
 */
export function outstandingCourseForms(input: {
  shopId: string;
  bookingId: string;
  personId: string;
  required: readonly RequiredCourseForm[];
  signatures: readonly CourseFormSignature[];
  signer: GuardianSigner;
}): RequiredCourseForm[] {
  return [...input.required]
    .sort((a, b) => a.position - b.position)
    .filter(
      (form) => !input.signatures.some((signature) => signatureSatisfies(signature, form, input)),
    );
}

/** What a form's placeholders are filled with when a student signs it. */
export type CourseFormContext = {
  shopName: string;
  courseTitle: string;
  /** The session's instructors, already joined for reading ("Ana Ruiz, Ben Ode"). */
  instructorNames: string;
};

/**
 * **A form's words as this student signs them**: `{shopName}`,
 * `{courseTitle}` and `{instructorNames}` replaced by this enrollment's
 * values. An agency release names the shop and the instructor in its own
 * blanks; filling them here means one form serves every session, and the
 * filled words are what the record keeps. Any other brace is left exactly as
 * the shop typed it.
 */
export function fillCourseFormText(body: string, context: CourseFormContext): string {
  return body.replace(/\{(shopName|courseTitle|instructorNames)\}/g, (_, key: string) => {
    if (key === "shopName") return context.shopName;
    if (key === "courseTitle") return context.courseTitle;
    return context.instructorNames;
  });
}

/**
 * A form's text as it is stored and compared: line endings as `\n`, Unicode
 * in NFC, ends trimmed — the release's own rule (`src/db/waivers.ts`), so a
 * paste from Word that differs only in encoding is not an edit.
 */
export function normalizeCourseFormText(text: string): string {
  return text.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

/**
 * **A form still waiting for the shop's text.** A course template names the
 * forms its agency expects, by title only (DiveDay ships no agency wording,
 * H-10), so a form made from that list starts with an empty body. Until the
 * shop pastes the agency's wording in, it is asked of nobody: it cannot be
 * signed, sent, or owed, and it blocks no one. Saving text over it is the
 * act that starts asking.
 */
export function courseFormAwaitingText(body: string): boolean {
  return normalizeCourseFormText(body) === "";
}

/**
 * Whether a save would change anything. A form whose title and body read the
 * same once normalised gets no new version — a new version asks every student
 * to sign again, so saving the same words must cost nothing.
 */
export function courseFormTextChanged(
  current: { title: string; body: string } | null,
  next: { title: string; body: string },
): boolean {
  if (!current) return true;
  return (
    normalizeCourseFormText(current.title) !== normalizeCourseFormText(next.title) ||
    normalizeCourseFormText(current.body) !== normalizeCourseFormText(next.body)
  );
}
