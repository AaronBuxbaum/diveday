import type { MedicalAnswers, WaiverRecord as StoredWaiverRecord } from "@/db/schema";
import { type CalendarDate, calendarDateInTimezone, isValidCalendarDate } from "./calendar-date";
import { nowDate } from "./clock";
import {
  type GuardianSignature,
  type GuardianSigner,
  guardianSignatureMissing,
  guardianSignatureOf,
} from "./guardian";
import { flaggedMedicalPrompts, needsPhysicianReview } from "./medical";

/**
 * **A waiver record as a status decision reads it**: every column but the
 * release text, the unsigned draft, the bearer link and the seal
 * (`WAIVER_STATE_COLUMNS`, src/db/waiver-record-columns.ts). Every rule in
 * this file decides from status, signature and clearance stamps, so each takes
 * this narrower shape: a roster or readiness pass can hand over the light row,
 * and a whole stored record still fits.
 */
export type WaiverStateFields = Omit<
  StoredWaiverRecord,
  | "templateBody"
  | "draftSignerName"
  | "draftMedicalAnswers"
  | "draftGuardian"
  | "tokenHash"
  | "tokenSealed"
  | "integrityHash"
>;

type WaiverRecord = WaiverStateFields;

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

// `createWaiverToken` and `hashWaiverToken` used to live here. They are the
// only two things in this file that need `node:crypto`, and this file is
// reachable from three client components through `src/lib/readiness.ts` and
// `src/i18n/readiness-labels.ts` — so that one import put 440 KB of Node
// polyfills, `eval` and all, into the first-load bundle of the public schedule
// and the page a diver books on. They now live in `src/lib/waiver-tokens.ts`,
// which nothing but `src/db` may import; see that file for the whole chain
// (found by the CSP report-only pass, issue #718).

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
 * current material generation (a later material edit is different terms the
 * diver never agreed to), and inside the validity window. Display versions may
 * advance for a non-material correction without invalidating a signature.
 * Applied uniformly — to the
 * booking's own record and to any carried from another booking — so a signature
 * that is stale or against superseded terms is never treated as current, whoever
 * it was signed for. Fails closed on anything missing.
 *
 * An `imported` record (ADR 20260724-import-waiver-acceptance) is exempt from
 * the template-generation check: it was never signed against any version of this
 * shop's own template, only snapshotted against the current one for reference,
 * so comparing versions would always — and wrongly — read it as stale. Its
 * `signedAt` is the diver's real acceptance date at the prior shop, so the
 * validity window still ages it out exactly like any other signature.
 */
/**
 * A medical hold nobody has resolved — the thing that fails closed.
 *
 * The questionnaire refers a diver, the record parks in `medical_review`, and
 * readiness refuses to board them. A physician evaluation recorded against that
 * record (`medicalClearedAt`, issue #1252) is what ends the hold; absence of one
 * is every other case, including the overwhelmingly common one of a record that
 * never needed clearing. Fails closed by construction: only an explicit
 * clearance narrows this, never the lack of a field.
 *
 * **A recorded refusal is still a hold** (issue #1283), and deliberately reads
 * as one here: `medicalClearanceDeclinedAt` is not consulted, so a diver whose
 * physician said no stays exactly as blocked as one nobody has heard from. The
 * refusal changes what the surfaces *say* — an answer arrived, stop chasing —
 * and nothing about who boards. Anything that wants that distinction asks
 * {@link waiverState}, which is presentation; this one is the gate.
 */
export function isUnresolvedMedicalHold(record: WaiverRecord): boolean {
  return record.status === "medical_review" && !record.supersededAt && !record.medicalClearedAt;
}

/**
 * **A physician's "no" outranks every signature older than it, even once its
 * seat has been given a new link** (Aaron, 2026-10-06: "a way for people who
 * don't clear a waiver to be able to supply a new waiver").
 *
 * Retiring a refusal (`retireMedicalRefusal`) supersedes the refused record so
 * the seat can carry a fresh release, and a superseded record is no longer an
 * {@link isUnresolvedMedicalHold}. Left there, sign-once would fall straight
 * back to whatever clean signature the diver gave *before* the disclosure, and
 * a seat would read Ready on a release the physician's answer already
 * overruled. So a refusal keeps counting as a hold by **time**, superseded or
 * not: only a signature newer than it — the fresh release, answered on its own
 * terms — stands over it.
 */
export function isStandingRefusal(record: WaiverRecord): boolean {
  return (
    record.status === "medical_review" &&
    Boolean(record.medicalClearanceDeclinedAt) &&
    !record.medicalClearedAt
  );
}

/** What outranks an older clean signature: an open hold, or a refusal. */
function outranksOlderSignatures(record: WaiverRecord): boolean {
  return isUnresolvedMedicalHold(record) || isStandingRefusal(record);
}

/**
 * A release the diver actually completed, with nothing outstanding on it.
 *
 * Two shapes qualify and they are the same evidence: a questionnaire that
 * flagged nothing (`completed`), and one that flagged something a physician has
 * since cleared. A cleared record is a signed release like any other — it
 * carries `signedName`, `signedAt`, `completedAt` and the answers themselves;
 * `medical_review` is where it was *parked*, not a different kind of signature.
 * Its `status` deliberately does not move on clearance, so the row still says
 * that this diver was once referred, and so the integrity seal over the signed
 * evidence stays valid.
 */
export function isCleanCompletion(record: WaiverRecord): boolean {
  if (record.status === "completed") return true;
  return record.status === "medical_review" && Boolean(record.medicalClearedAt);
}

export function isCompletedWaiverCurrent(
  record: WaiverRecord,
  currentTemplateGeneration: number | null,
  now: Date = nowDate(),
): boolean {
  if (!isCleanCompletion(record)) return false;
  if (record.supersededAt) return false;
  if (
    record.signatureMethod !== "imported" &&
    currentTemplateGeneration !== null &&
    // `templateGeneration` is present on every new record; the fallback keeps
    // pre-generation rows (and imported fixtures) readable during the
    // expand/contract migration, where version 1 was generation 1.
    (record.templateGeneration ?? record.templateVersion) !== currentTemplateGeneration
  ) {
    return false;
  }
  const signedAt = record.signedAt ?? record.completedAt;
  if (!signedAt) return false;
  // A cleared referral ages on **two** clocks and stands only while both run.
  // The signature's is the ordinary one; the physician's evaluation has its own,
  // because a shop that records a two-year-old letter today has not established
  // anything for the next twelve months (issue #1252, `dive-domain-expert`
  // review). Whichever expires first ends the release.
  const evaluatedAt = clearanceEvaluatedAt(record);
  if (evaluatedAt !== null && evaluatedAt + WAIVER_SIGNATURE_VALIDITY_MS <= now.getTime()) {
    return false;
  }
  return signedAt.getTime() + WAIVER_SIGNATURE_VALIDITY_MS > now.getTime();
}

/**
 * When the physician evaluated the diver, as an instant, or null on a record
 * nobody cleared.
 *
 * A calendar date has no clock in it, so it is read at UTC midnight — the same
 * convention `src/lib/calendar-date.ts` uses everywhere a day has to become a
 * point on a timeline. Half a day either way is immaterial against a 365-day
 * window, and picking the shop's zone here would make a release expire at a
 * different instant for the same paper depending on where it was filed.
 */
export function clearanceEvaluatedAt(record: WaiverRecord): number | null {
  if (!record.medicalClearedAt || !record.medicalClearanceEvaluatedOn) return null;
  const parsed = Date.parse(`${record.medicalClearanceEvaluatedOn}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
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
 * and medical-review records, superseded ones excluded except a retired
 * refusal, which still outranks the signatures older than it
 * ({@link isStandingRefusal}).
 */
export function effectiveWaiverForBooking(input: {
  bookingWaiver: WaiverRecord | null;
  personSignedWaivers: readonly WaiverRecord[];
  currentTemplateVersion: number | null;
  now?: Date;
}): WaiverRecord | null {
  const now = input.now ?? nowDate();
  const own = input.bookingWaiver;
  if (own && isUnresolvedMedicalHold(own)) return own;

  const clean = [
    ...(own && isCompletedWaiverCurrent(own, input.currentTemplateVersion, now) ? [own] : []),
    ...input.personSignedWaivers.filter((record) =>
      isCompletedWaiverCurrent(record, input.currentTemplateVersion, now),
    ),
  ].sort((a, b) => signatureTime(b) - signatureTime(a))[0];

  const cleanTime = clean ? signatureTime(clean) : Number.NEGATIVE_INFINITY;
  const hold = input.personSignedWaivers
    .filter(outranksOlderSignatures)
    .filter((record) => signatureTime(record) >= cleanTime)
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];
  if (hold) return hold;

  if (clean) return clean;

  return own && !isCleanCompletion(own) ? own : null;
}

/**
 * Where a diver stands with **the shop**, independent of any one booking.
 *
 * A release is signed once and carries across every booking the diver has here
 * ({@link effectiveWaiverForBooking}), so "has this person signed?" is a fact
 * about the diver and the shop — not about a seat on Saturday's boat. This is
 * that fact, for the diver record, where staff go to answer it.
 *
 * Codes, never sentences: the surface picks the words. Deliberately carries
 * dates and nothing else from the signed evidence — never the medical answers,
 * which stay on the waiver surfaces that exist to review them.
 */
export type ShopWaiverStatus =
  | { state: "none" }
  /** Signed, clean, against current terms, and inside the validity window. */
  | { state: "current"; signedAt: Date; expiresAt: Date; medical: MedicalWaiverMark | null }
  /**
   * Signed before, but the signature no longer stands — aged past the validity
   * window, or given against terms the shop has since edited. Either way the
   * diver signs again, and `signedAt` says how long ago they last did.
   */
  | { state: "expired"; signedAt: Date }
  /**
   * Signed, current — and given by a minor alone (ADR
   * 20260907-guardian-co-signature). Not "Signed": readiness blocks on it, and
   * the way out is the same as `expired`'s, a fresh link that asks for both
   * signatures. `signedAt` says when the solo signature was given.
   */
  | { state: "guardian_missing"; signedAt: Date }
  /** A health disclosure is waiting on a person, and fails closed until it is resolved. */
  | { state: "medical_review"; at: Date }
  /**
   * The physician answered and the answer was no (issue #1283). The block is
   * the same block — this diver does not board — and the difference is that
   * there is nothing left to wait for, so the shop can stop chasing and the
   * crew can be told before the dock instead of at it. `at` is still the
   * disclosure the refusal answers, so the row ages the way every other waiver
   * row does; `declinedAt` is when the shop recorded the answer.
   */
  | {
      state: "medical_not_cleared";
      at: Date;
      declinedAt: Date;
      /**
       * The refused evaluation itself, when the shop attached it — the same
       * door a clearance gets (`MedicalWaiverMark.clearance`). A physician's
       * letter saying *no* is the one a claims adjuster asks for first, and
       * storing it with no way back to it is the shape issue #1283 exists to
       * close.
       */
      evaluation: { recordId: string; documentOnFile: boolean };
    };

/**
 * The diver's standing with the shop, from their signed evidence here.
 *
 * Mirrors {@link effectiveWaiverForBooking}'s precedence, minus the booking: an
 * unresolved medical hold no older than the last clean signature wins, because a
 * health disclosure made at or after that signature means the signature can no
 * longer be trusted. Fails closed on anything missing.
 *
 * `personSignedWaivers` is the diver's completed and medical-review records at
 * this shop, superseded ones excluded but for a retired refusal
 * (`listSignedWaiversByPerson`).
 */
export function shopWaiverStatus(input: {
  personSignedWaivers: readonly WaiverRecord[];
  currentTemplateVersion: number | null;
  /**
   * Who the diver is, for the guardian rule (`src/lib/guardian.ts`). A caller
   * that omits it gets the answer every adult gets; the diver record and the
   * readiness thread both pass it, so a minor's solo signature reads as its
   * own state there rather than as "Signed".
   */
  signer?: GuardianSigner;
  now?: Date;
}): ShopWaiverStatus {
  const now = input.now ?? nowDate();
  const clean = input.personSignedWaivers
    .filter((record) => isCompletedWaiverCurrent(record, input.currentTemplateVersion, now))
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];

  const cleanTime = clean ? signatureTime(clean) : Number.NEGATIVE_INFINITY;
  const hold = input.personSignedWaivers
    .filter(outranksOlderSignatures)
    .filter((record) => signatureTime(record) >= cleanTime)
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];
  if (hold) {
    const at = new Date(signatureTime(hold));
    return hold.medicalClearanceDeclinedAt
      ? {
          state: "medical_not_cleared",
          at,
          declinedAt: hold.medicalClearanceDeclinedAt,
          evaluation: {
            recordId: hold.id,
            documentOnFile: Boolean(hold.medicalClearanceDocumentUrl),
          },
        }
      : { state: "medical_review", at };
  }

  // The same precedence the readiness engine applies: a hold outranks it, and
  // it outranks "Signed". The record still *is* the diver's current signature
  // for every other purpose; it is only the standing that changes word.
  if (clean && input.signer && guardianSignatureMissing(clean, input.signer)) {
    return { state: "guardian_missing", signedAt: new Date(signatureTime(clean)) };
  }

  if (clean) {
    return {
      state: "current",
      signedAt: new Date(signatureTime(clean)),
      expiresAt: new Date(signatureTime(clean) + WAIVER_SIGNATURE_VALIDITY_MS),
      medical: medicalWaiverMark(clean, input.personSignedWaivers),
    };
  }

  // Nothing current, but they have signed here before: "sign again", not
  // "never signed". The two send staff down very different conversations.
  const lapsed = input.personSignedWaivers
    .filter(isCleanCompletion)
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];
  if (lapsed) return { state: "expired", signedAt: new Date(signatureTime(lapsed)) };

  return { state: "none" };
}

export type WaiverState =
  | "not_sent"
  | "awaiting_signature"
  | "expired"
  | "complete"
  | "medical_review"
  /** Referred, answered, and the answer was no (issue #1283). Blocked, and not waiting on anyone. */
  | "medical_not_cleared";

/** Presentational state stays derived so an expired pending record fails closed. */
export function waiverState(record: WaiverRecord | null, now: Date = nowDate()): WaiverState {
  if (!record) return "not_sent";
  if (record.status === "completed") return "complete";
  // A cleared referral is a complete release: the diver signed, the answers
  // were reviewed by a physician, and a staff member recorded it. The record
  // keeps saying `medical_review` because that is what happened to it.
  if (record.status === "medical_review") {
    if (record.medicalClearedAt) return "complete";
    // A refusal is not a third kind of pending. It blocks exactly as the hold
    // above it does — `isUnresolvedMedicalHold` does not read this column —
    // and says so in its own words so nobody reads "waiting" and goes chasing
    // an answer that has already arrived (issue #1283).
    return record.medicalClearanceDeclinedAt ? "medical_not_cleared" : "medical_review";
  }
  return record.expiresAt <= now ? "expired" : "awaiting_signature";
}

export type MedicalWaiverMark = {
  at: Date;
  /**
   * "digital" — the diver answered the medical questionnaire themselves.
   * "paper" — staff attested a reviewed paper medical (in person).
   * "imported" — trusted from the prior shop's own acceptance, never reviewed
   * here (ADR 20260724-import-waiver-acceptance). "cleared" — the questionnaire
   * referred this diver and a physician's evaluation was recorded against that
   * record (issue #1252); its date is **the evaluation**, because that is the
   * day the fitness question was actually answered and the day its own clock
   * starts. The first three run one 365-day clock from the signature; a cleared
   * record runs two and stands while both do (`isCompletedWaiverCurrent`), so
   * the date shown is the one that expires first in practice.
   */
  source: "digital" | "paper" | "imported" | "cleared";
  /**
   * **A referral this signature stands over, that nobody ever resolved**
   * (issue #1282) — the date of it, or null in the ordinary case.
   *
   * The sign-once rules are deliberately symmetric: a disclosure made *at or
   * after* the last clean signature invalidates it (fail-closed, and correct),
   * and a clean signature made *after* a disclosure ends the hold. The second
   * half is the hole. A diver referred to a physician who is simply sent a
   * fresh link and answers "no" to everything is boarded, with no doctor
   * anywhere in it and no trace on the surfaces a crew reads.
   *
   * This does not change that — whether a mis-tapped questionnaire should
   * strand a diver until a letter arrives is a call for a person to make, not
   * an agent. It makes it **visible**: the crew and the diver's record both say
   * that the release standing today replaced a referral rather than answering
   * it, and staff decide. Derived on every read, never stored, so it cannot
   * drift from the records it describes.
   *
   * **The owner kept the override** (2026-10-09, issue #2195, amending H-98):
   * a later clean release may stand over an unresolved referral, and the
   * warning links back to it ({@link overriddenReferral}).
   */
  overriddenReferralAt: Date | null;
  /**
   * The referral itself — its record and date — so a surface that can open a
   * record links the warning to it (issue #2195). `overriddenReferralAt` is
   * this one's `at`, kept for the dated surfaces that carry no id (the
   * offline manifest carries the day and nothing else of the record).
   */
  overriddenReferral: OverriddenReferral | null;
  /**
   * **An earlier release a physician refused, that this one stands over**
   * ({@link overriddenRefusal}) — its record and date, or null. A warning,
   * never a block: the crew reads it with a link to the refused record.
   */
  overriddenRefusal: OverriddenRefusal | null;
  /**
   * **The record a `cleared` mark hangs on, and whether the physician's
   * evaluation itself is stored against it** (issue #1283) — null for every
   * other source.
   *
   * Derived here rather than by the diver record, because this function is
   * already the one place that decides "this release stands because a
   * physician cleared it", and a second selection of that record elsewhere
   * would be a second chance to select a different one.
   *
   * The URL is deliberately **not** here. It names the shop's own storage
   * layout, it is useless to any reader — the bucket blocks public access —
   * and this mark travels to surfaces the crew reads. What travels is the id
   * of a row and a boolean; opening the file is a permission-gated route
   * (`/api/medical-clearances/[recordId]`).
   */
  clearance: { recordId: string; documentOnFile: boolean } | null;
  /**
   * **Who co-signed a minor's release**, or null (ADR
   * 20260907-guardian-co-signature). Rides on the mark because the mark is
   * already the one derivation of "this is the release standing today" that
   * the manifest, the roster and the diver record all read — so "signed by
   * guardian" is said the same way on every surface that shows a signature.
   * Null after erasure took the name; the fact of the co-signature is on the
   * record and inside its seal either way.
   */
  guardian: GuardianSignature | null;
};

/**
 * The most recent unresolved referral a standing clean signature sits on top of.
 *
 * Exported because two surfaces need the same answer from different starting
 * points — the diver record via {@link shopWaiverStatus}, the boat manifest via
 * the readiness row — and a second derivation of a safety fact is a second
 * chance to derive it differently.
 *
 * Strictly older, and never the standing record itself: a hold at or after the
 * signature already wins outright in both resolvers above, so it is a *block*
 * rather than something the crew is being warned about.
 */
export function overriddenReferralAt(
  standing: WaiverRecord | null,
  personSignedWaivers: readonly WaiverRecord[],
): Date | null {
  return overriddenReferral(standing, personSignedWaivers)?.at ?? null;
}

/**
 * An unresolved referral a standing clean release stands over: its record,
 * whose it is (the record's page lives under the person), and when it was
 * signed.
 */
export type OverriddenReferral = { recordId: string; personId: string; at: Date };

/**
 * {@link overriddenReferralAt} with the record it is about, so the warning
 * can link to the referral (issue #2195). The one derivation: the date above
 * is read from this.
 *
 * **Kept as a warning, not a block, by decision** (Aaron, 2026-10-09, issue
 * #2195, amending H-98). A later clean signature clears the diver even over
 * a referral no physician answered, as it does over a physician's "no"; every
 * surface that warns about the refusal warns about this too, with the
 * referral one tap away. `effectiveWaiverForBooking` is unchanged.
 */
export function overriddenReferral(
  standing: WaiverRecord | null,
  personSignedWaivers: readonly WaiverRecord[],
): OverriddenReferral | null {
  if (!standing || !isCleanCompletion(standing)) return null;
  const standingTime = signatureTime(standing);
  const referral = personSignedWaivers
    .filter((record) => isUnresolvedMedicalHold(record) && !isStandingRefusal(record))
    .filter((record) => record.id !== standing.id && signatureTime(record) < standingTime)
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];
  return referral
    ? { recordId: referral.id, personId: referral.personId, at: new Date(signatureTime(referral)) }
    : null;
}

/**
 * When a physician's answer was given, for ordering a "yes" against a "no".
 * The evaluation's own day first, because two referrals can be answered out
 * of the order they were signed in; the moment staff recorded it breaks a tie
 * within one day, and stands in when no day was stored.
 */
function decisionOrder(record: WaiverRecord): [number, number] {
  const recorded = (record.medicalClearedAt ?? record.medicalClearanceDeclinedAt)?.getTime() ?? 0;
  const day = record.medicalClearanceEvaluatedOn
    ? Date.parse(`${record.medicalClearanceEvaluatedOn}T00:00:00.000Z`)
    : Number.NaN;
  return [Number.isFinite(day) ? day : recorded, recorded];
}

function decidedAfter(a: WaiverRecord, b: WaiverRecord): boolean {
  const [dayA, recordedA] = decisionOrder(a);
  const [dayB, recordedB] = decisionOrder(b);
  return dayA !== dayB ? dayA > dayB : recordedA > recordedB;
}

/** The questions a record flagged, which are what a physician answered. */
function flaggedPromptsOf(record: WaiverRecord): string[] {
  return record.medicalAnswers ? flaggedMedicalPrompts(record.medicalAnswers) : [];
}

/**
 * **The physician's "no" a standing clean signature sits on top of** — the
 * refused record and when the physician's answer was recorded, or null in the
 * ordinary case.
 *
 * A diver a physician did not clear gets back on a boat by signing a new
 * release, and a clean one clears them without a second physician (Aaron,
 * 2026-10-07, issue #2158: "allow a waiver without, but show a warning that a
 * previous waiver had a physician say no (with link)"). This is the warning:
 * every surface that shows the standing release also says that a physician did
 * not clear this diver, and links to the refused record, so the crew decides
 * with the refusal in view.
 *
 * A refusal stops being worth a warning only when a physician has since
 * cleared the diver **on everything the refusal was about**: a clearance
 * decided after the "no" (by the evaluation's date, not the signature's — two
 * referrals can be answered out of order) on a record that flagged at least
 * every question the refused one did. An ENT clearing ears says nothing about
 * a cardiologist's "no" (dive-domain review 2026-10-07). Separate from
 * {@link overriddenReferralAt}, which leaves refusals out, so one record is
 * never warned about twice.
 */
export function overriddenRefusal(
  standing: WaiverRecord | null,
  personSignedWaivers: readonly WaiverRecord[],
): OverriddenRefusal | null {
  if (!standing || !isCleanCompletion(standing)) return null;
  const candidates = personSignedWaivers.some((record) => record.id === standing.id)
    ? personSignedWaivers
    : [...personSignedWaivers, standing];
  return unansweredRefusal(candidates, signatureTime(standing));
}

/**
 * An earlier release a physician refused: its record, when staff recorded the
 * "no", and the physician's own evaluation day when one was stored. The day is
 * what a crew reads (dive-domain review of #2163); `at` stands in without it.
 */
export type OverriddenRefusal = {
  recordId: string;
  at: Date;
  /** Optional so a mark built by hand (a test, an older fixture) still types. */
  evaluatedOn?: CalendarDate | null;
};

/**
 * **The two days a crew reads beside a medical warning**, in the shop's zone:
 * the physician's evaluation day for an earlier refusal (falling back to the
 * day staff recorded it), and the day of a referral a release stands over.
 * One derivation for the live roll call and the offline dock copy, so the two
 * never print different days. Absent keys mean no warning.
 */
export function medicalWarningDays(
  mark: Pick<MedicalWaiverMark, "overriddenRefusal" | "overriddenReferralAt"> | null | undefined,
  timeZone: string,
): { refusedOn?: CalendarDate; referredOn?: CalendarDate } {
  const refusal = mark?.overriddenRefusal;
  const referral = mark?.overriddenReferralAt;
  return {
    ...(refusal
      ? { refusedOn: refusal.evaluatedOn ?? calendarDateInTimezone(refusal.at, timeZone) }
      : {}),
    ...(referral ? { referredOn: calendarDateInTimezone(referral, timeZone) } : {}),
  };
}

/**
 * The physician's "no" on file that no later clearance has answered
 * ({@link overriddenRefusal}'s rule), among refusals signed before
 * `signedBefore`.
 */
function unansweredRefusal(
  records: readonly WaiverRecord[],
  signedBefore: number,
): OverriddenRefusal | null {
  const refusals = records
    .filter((record) => isStandingRefusal(record) && signatureTime(record) < signedBefore)
    .sort((a, b) => (decidedAfter(a, b) ? -1 : decidedAfter(b, a) ? 1 : 0));
  for (const refusal of refusals) {
    const refused = flaggedPromptsOf(refusal);
    const answered = records.some(
      (record) =>
        record.medicalClearedAt &&
        decidedAfter(record, refusal) &&
        refused.every((prompt) => flaggedPromptsOf(record).includes(prompt)),
    );
    if (!answered && refusal.medicalClearanceDeclinedAt) {
      return {
        recordId: refusal.id,
        at: refusal.medicalClearanceDeclinedAt,
        evaluatedOn: isValidCalendarDate(refusal.medicalClearanceEvaluatedOn ?? "")
          ? (refusal.medicalClearanceEvaluatedOn ?? null)
          : null,
      };
    }
  }
  return null;
}

/**
 * When and how a diver's medical currency was last established, for spotting a
 * statement drifting toward a year stale. A digital completion carries the
 * questionnaire; a staff paper attestation (`in_person_attested`) carries a
 * staff-affirmed review; an imported record carries the prior shop's own
 * clearance — all three surface a date, *distinctly*, rather than reading as a
 * missing medical next to a dated one. Only a clean completion counts; a
 * pending or in-review record has no settled medical to show.
 */
export function medicalWaiverMark(
  record: WaiverRecord | null,
  /**
   * The diver's other signed evidence at this shop, so the mark can say whether
   * this signature replaced an unresolved referral rather than answering one
   * (issue #1282). Defaults to nothing, which reads as "no referral behind it" —
   * the honest answer for a caller holding one record and no history.
   */
  personSignedWaivers: readonly WaiverRecord[] = [],
): MedicalWaiverMark | null {
  if (record === null || !isCleanCompletion(record)) return null;
  const at = record.signedAt ?? record.completedAt;
  if (!at) return null;
  const referral = overriddenReferral(record, personSignedWaivers);
  const overridden = referral?.at ?? null;
  const refusal = overriddenRefusal(record, personSignedWaivers);
  const guardian = guardianSignatureOf(record);
  // A referral a physician cleared is the strongest medical evidence a shop
  // ever holds, and staff reading the record need to see that it is not an
  // ordinary self-declaration — so it is its own source rather than "digital".
  //
  // Dated by the **evaluation**, never by the moment a staffer typed it in: the
  // mark exists for spotting a statement drifting toward a year stale, and a
  // data-entry stamp would show the crew a date ten months fresher than the
  // clock the release actually ages on.
  if (record.medicalClearedAt) {
    const evaluatedAt = clearanceEvaluatedAt(record);
    return {
      at: evaluatedAt === null ? record.medicalClearedAt : new Date(evaluatedAt),
      source: "cleared",
      overriddenReferralAt: overridden,
      overriddenReferral: referral,
      overriddenRefusal: refusal,
      clearance: {
        recordId: record.id,
        documentOnFile: Boolean(record.medicalClearanceDocumentUrl),
      },
      guardian,
    };
  }
  // Every other source has no clearance behind it by construction — the branch
  // above is the only one a `medical_cleared_at` can reach.
  const uncleared = {
    overriddenReferralAt: overridden,
    overriddenReferral: referral,
    overriddenRefusal: refusal,
    clearance: null,
    guardian,
  } as const;
  if (record.signatureMethod === "imported") return { at, source: "imported", ...uncleared };
  if (record.medicalAnswers) return { at, source: "digital", ...uncleared };
  if (record.signatureMethod === "in_person_attested") {
    return { at, source: "paper", ...uncleared };
  }
  return null;
}
