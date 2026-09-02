import type { MedicalAnswers, WaiverRecord } from "@/db/schema";
import { nowDate } from "./clock";
import { needsPhysicianReview } from "./medical";

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
 */
export function isUnresolvedMedicalHold(record: WaiverRecord): boolean {
  return record.status === "medical_review" && !record.supersededAt && !record.medicalClearedAt;
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
 * and medical-review records, superseded ones excluded.
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
    .filter(isUnresolvedMedicalHold)
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
  /** A health disclosure is waiting on a person, and fails closed until it is resolved. */
  | { state: "medical_review"; at: Date };

/**
 * The diver's standing with the shop, from their signed evidence here.
 *
 * Mirrors {@link effectiveWaiverForBooking}'s precedence, minus the booking: an
 * unresolved medical hold no older than the last clean signature wins, because a
 * health disclosure made at or after that signature means the signature can no
 * longer be trusted. Fails closed on anything missing.
 *
 * `personSignedWaivers` is the diver's completed and medical-review records at
 * this shop, superseded ones excluded (`listSignedWaiversByPerson`).
 */
export function shopWaiverStatus(input: {
  personSignedWaivers: readonly WaiverRecord[];
  currentTemplateVersion: number | null;
  now?: Date;
}): ShopWaiverStatus {
  const now = input.now ?? nowDate();
  const clean = input.personSignedWaivers
    .filter((record) => isCompletedWaiverCurrent(record, input.currentTemplateVersion, now))
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];

  const cleanTime = clean ? signatureTime(clean) : Number.NEGATIVE_INFINITY;
  const hold = input.personSignedWaivers
    .filter(isUnresolvedMedicalHold)
    .filter((record) => signatureTime(record) >= cleanTime)
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];
  if (hold) return { state: "medical_review", at: new Date(signatureTime(hold)) };

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
  | "medical_review";

/** Presentational state stays derived so an expired pending record fails closed. */
export function waiverState(record: WaiverRecord | null, now: Date = nowDate()): WaiverState {
  if (!record) return "not_sent";
  if (record.status === "completed") return "complete";
  // A cleared referral is a complete release: the diver signed, the answers
  // were reviewed by a physician, and a staff member recorded it. The record
  // keeps saying `medical_review` because that is what happened to it.
  if (record.status === "medical_review") {
    return record.medicalClearedAt ? "complete" : "medical_review";
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
   */
  overriddenReferralAt: Date | null;
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
  if (!standing || !isCleanCompletion(standing)) return null;
  const standingTime = signatureTime(standing);
  const referral = personSignedWaivers
    .filter(isUnresolvedMedicalHold)
    .filter((record) => record.id !== standing.id && signatureTime(record) < standingTime)
    .sort((a, b) => signatureTime(b) - signatureTime(a))[0];
  return referral ? new Date(signatureTime(referral)) : null;
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
  const overridden = overriddenReferralAt(record, personSignedWaivers);
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
    };
  }
  if (record.signatureMethod === "imported") {
    return { at, source: "imported", overriddenReferralAt: overridden };
  }
  if (record.medicalAnswers) return { at, source: "digital", overriddenReferralAt: overridden };
  if (record.signatureMethod === "in_person_attested") {
    return { at, source: "paper", overriddenReferralAt: overridden };
  }
  return null;
}
