/**
 * Waivers: the medical questionnaire's consequences — a physician's
 * evaluation, the hold an unanswered one keeps, and retiring a refusal.
 * Imported through the `./waivers` barrel.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { canRetireMedicalRefusal } from "@/lib/authz";
import { calendarDateInTimezone, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  answeredMedicalForm,
  calculateMedicalResult,
  type MedicalReferralItem,
  type PublishedMedicalForm,
  referralItems,
} from "@/lib/medical";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { isUuid } from "@/lib/uuid";
import {
  awaitsPhysician,
  DOCTOR_UNLOCK_FAILURE_LIMIT,
  doctorPageWithinTrip,
  WAIVER_SIGNATURE_VALIDITY_MS,
} from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEventsForPerson } from "./manifest-events";
import { queueMediaDeletion } from "./media-deletions";
import { recordDiverActivity } from "./operations";
import {
  activityEvents,
  bookings,
  people,
  trips,
  type WaiverRecord,
  waiverRecords,
} from "./schema";
import { livePerson, liveTrip } from "./trips-live";
import { activeStaffAttestorId } from "./waivers-in-person";

/**
 * **Which way the physician answered.** The RSTC Physician's Evaluation Form
 * has two outcomes, and until issue #1283 DiveDay modelled only the first.
 *
 * `not_cleared` is not a weaker clearance: it is the absence of one, recorded.
 * The hold stands either way it is written down — what changes is that the
 * record can finally say the answer *arrived*, so the shop stops chasing a
 * diver whose doctor has already said no and the crew learns it before the
 * dock rather than at it.
 */
export type MedicalEvaluationOutcome = "cleared" | "not_cleared";

/**
 * What happened when a shop tried to record a physician's answer.
 *
 * `no_medical_hold` is the interesting refusal: this diver has nothing parked
 * in review here, so there is nothing to answer. It is not an error state to
 * apologise for — it is the answer to a question the staffer asked — and the
 * surface words it as such.
 */
export type MedicalEvaluationResult =
  | {
      ok: true;
      recordId: string;
      /** Which answer now stands on the record — the one just written, or the one already there. */
      outcome: MedicalEvaluationOutcome;
      /** The answer was already on file, so nothing was written. A double submit, not a failure. */
      alreadyRecorded: boolean;
      /**
       * Set only when the answer was written from a letter that predates the
       * referral it answers (issue #2616): the earlier referral that covered it,
       * and how many of the diver's live seats that referral still holds. The
       * letter answers the open record only, so those seats stay blocked until
       * the desk records the letter against them too, and the surface says so.
       */
      earlierLetter?: { referralId: string; seatsStillHeld: number };
    }
  | {
      ok: false;
      reason:
        | "staff_not_found"
        | "no_medical_hold"
        /**
         * This record already carries the *other* answer, and neither
         * overwrites the other. A physician's "no" is not erasable by whoever
         * is at the desk next, and a diver re-evaluated after a refusal is
         * answering a fresh disclosure — which signs a new release and parks a
         * new hold that can be cleared on its own terms.
         */
        | "answer_already_recorded"
        /**
         * The diver-sent form was ticked as the evidence with no physician's
         * name typed from it (issue #2797, domain review 1): a tick alone
         * would clear a diver on a photo of anything.
         */
        | "diver_form_physician_required"
        /**
         * The diver-sent form was ticked by a staffer with no record of having
         * opened it since it arrived (`diver_medical_form_opened` by them).
         */
        | "diver_form_not_opened"
        /** No evaluation date, or one that is not a calendar date. */
        | "evaluation_date_required"
        /**
         * The letter predates the answers it is supposed to clear. A physician
         * evaluation written in March cannot clear a stent placed in June, and
         * a shop handed a stale letter should be told so rather than have it
         * recorded as a fresh clearance (`dive-domain-expert` review, #1252).
         */
        | "evaluation_predates_disclosure"
        /** An evaluation dated after today is a typo, not a clearance. */
        | "evaluation_in_future"
        /**
         * Neither the evaluation nor the physician's name. Without one of them
         * the row records only that a member of the shop's own staff pressed a
         * button, which is the hearsay the paper-waiver attestation's checkbox
         * exists to avoid.
         */
        | "evidence_required";
    };

/**
 * Whether this diver has a medical hold **no physician has answered yet**, at
 * this shop.
 *
 * A cheap read the surface runs **before** it stores a physician's evaluation.
 * Without it, uploading first and refusing second left the most sensitive file
 * the product holds sitting in the bucket with no row pointing at it — reachable
 * by neither the media-deletion ledger nor `anonymizeDiver`, which walks rows
 * (security review H2). The honest-mistake path was the bad one: a staffer opens
 * the wrong diver's record, uploads a real evaluation, and is told there is
 * nothing to clear.
 *
 * **Not the same question as `isUnresolvedMedicalHold`, and the difference is
 * the point of issue #1283.** That one asks *may this diver board* — a refusal
 * leaves it `true`, because the block stands. This one asks *is there an answer
 * outstanding*, and a refusal makes it `false`: the answer arrived. Reading
 * either for the other's question inverts a safety property in one direction or
 * re-opens a settled refusal in the other, so they are deliberately two
 * functions with two names rather than one shared predicate.
 */
export async function hasUnansweredMedicalHold(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "medical_review"),
        // Superseded or not: a referral keeps holding after its seat takes a
        // fresh link (`isUnclearedReferral`), so it stays answerable.
        isNull(waiverRecords.anonymizedAt),
        isNull(waiverRecords.medicalClearedAt),
        isNull(waiverRecords.medicalClearanceDeclinedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** When a referral was signed: the signature, else its completion, else its creation. */
function signatureInstant(record: WaiverRecord): Date {
  return record.signedAt ?? record.completedAt ?? record.createdAt;
}

/**
 * **The earliest earlier referral a physician's letter could have been written
 * for** (issue #2616), or null when there is none.
 *
 * A diver whose release was referred, and who re-signs the same "yes" before
 * the shop records the physician's letter, holds two open referrals; the letter
 * predates the newer. It may still clear the newer one when the physician saw at
 * least every condition the newer one discloses. So a candidate is an *earlier*
 * referral of this diver at this shop that nobody has answered (a cleared or
 * refused one is finished, and a refusal is never an evidence of fitness), whose
 * flagged prompts include **every** prompt the open record flags, and that is
 * still this diver's own: a record given on a seat that has since passed to
 * somebody else (`passed`) was never this diver's answers
 * (`listSignedWaiversByPerson` drops it the same way). Live or superseded counts;
 * the caller has already scoped `held` to this shop, this diver, and not erased.
 *
 * Fails closed: the open record must itself be a real physician referral (a
 * complete questionnaire flagging at least one prompt), an incomplete or
 * unrecognised questionnaire on either side matches nothing, and a newly flagged
 * prompt has no candidate, so it still needs its own evaluation. The clearance
 * is written to the open record only, never to the earlier one.
 */
function earliestCoveringReferral(
  held: readonly WaiverRecord[],
  open: WaiverRecord,
  passed: ReadonlySet<string>,
): WaiverRecord | null {
  const wanted = physicianFlaggedPrompts(open);
  if (wanted === null) return null;
  const openAt = signatureInstant(open).getTime();
  const covering = held
    .filter(
      (record) =>
        record.id !== open.id &&
        !passed.has(record.id) &&
        record.medicalClearedAt === null &&
        record.medicalClearanceDeclinedAt === null &&
        signatureInstant(record).getTime() <= openAt,
    )
    .filter((record) => {
      const seen = physicianFlaggedPrompts(record);
      return seen !== null && [...wanted].every((prompt) => seen.has(prompt));
    })
    .sort((a, b) => signatureInstant(a).getTime() - signatureInstant(b).getTime());
  return covering[0] ?? null;
}

/**
 * Records of this diver's whose seat has since passed to somebody else (a split
 * or a claim): the booking now belongs to another person, so the answers on it
 * were never this diver's. The same exclusion `listSignedWaiversByPerson` makes.
 */
async function recordsOnPassedSeats(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .innerJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "medical_review"),
        ne(bookings.personId, waiverRecords.personId),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** The diver's medical-review records at this shop, newest first: the pool a physician's answer is read against. */
async function heldReferrals(db: DbExecutor, shopId: string, personId: string) {
  return db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "medical_review"),
        // A superseded referral is answerable too. Superseding moves a hold
        // off a seat and answers nothing (`isUnclearedReferral`): it still
        // holds every seat the diver has, so a physician must still be able
        // to end it, or the desk is told "nothing to clear" about a hold it
        // can see (glossary: Medical hold).
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .orderBy(desc(waiverRecords.completedAt));
}

/**
 * The record a physician's answer would land on: the newest unanswered
 * referral, a live one before a superseded one. A live hold is the one holding
 * its own seat outright (`isUnresolvedMedicalHold`), so an answer landing on a
 * newer superseded referral instead would leave that seat blocked while the desk
 * reads "recorded".
 */
function openReferral(held: readonly WaiverRecord[]): WaiverRecord | undefined {
  const unanswered = held.filter(
    (record) => record.medicalClearedAt === null && record.medicalClearanceDeclinedAt === null,
  );
  return (
    unanswered.find((record) => record.supersededAt === null) ??
    unanswered.find((record) => record.supersededAt !== null)
  );
}

/**
 * **The earlier referral a letter dated before the open one could cover**, for
 * the recording form (issue #2616): its id and its signing day as a UTC calendar
 * date, or null when the open referral has none, so the form asks nothing extra.
 * Read-only; `recordMedicalEvaluation` decides again on its own.
 */
export async function earlierReferralForOpenHold(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<{ referralId: string; on: string } | null> {
  const held = await heldReferrals(db, shopId, personId);
  const open = openReferral(held);
  if (!open) return null;
  const earlier = earliestCoveringReferral(
    held,
    open,
    await recordsOnPassedSeats(db, shopId, personId),
  );
  return earlier
    ? { referralId: earlier.id, on: calendarDateInTimezone(signatureInstant(earlier), "UTC") }
    : null;
}

/** The prompts a complete questionnaire flagged for a physician, or null when it flagged none. */
function physicianFlaggedPrompts(record: WaiverRecord): Set<string> | null {
  if (!record.medicalAnswers) return null;
  const result = calculateMedicalResult(record.medicalAnswers);
  if (result.status !== "physician_review" || result.flaggedPrompts.length === 0) return null;
  return new Set(result.flaggedPrompts);
}

/**
 * **A staff member records what a physician said about this diver.**
 *
 * The questionnaire refers a diver, the release parks in `medical_review`, and
 * readiness refuses to board them (`src/lib/readiness.ts`). Then the diver comes
 * back holding a signed physician evaluation — and until this existed the only
 * lift was `recordInPersonWaiver`'s attestation, whose staff-facing words are
 * "no answer needs physician sign-off": the opposite of what the diver is
 * standing there with. A staffer either attested to something untrue or left a
 * cleared diver blocked (issue #1252).
 *
 * So this is its own act, and deliberately not a widening of that one. It never
 * writes a release, never touches the signed evidence or its integrity seal,
 * and cannot be reached by a tap on "Mark ready" — it stamps the answer and its
 * evidence onto the record that was referred, one column of which is always the
 * accountable staff member.
 *
 * **The subject is the person, and the record is resolved here rather than
 * posted.** A client that could name the waiver record it is clearing could
 * name a different diver's; the caller passes the diver whose page they are on
 * (itself a path segment the surface already gates), and this finds their most
 * recent unresolved hold at *this shop*. Nothing else is clearable.
 *
 * **Fails closed on every unknown.** No live hold and no clearance already on
 * file is a refusal, never a silent success; an erased record is not clearable
 * (there is no longer a questionnaire to have been evaluated); and the actor
 * must be this shop's live staff, the same rule paper attestation applies.
 *
 * Idempotent: a diver whose hold already carries this answer comes back
 * `alreadyRecorded` rather than being stamped twice, so a double submit cannot
 * rewrite who recorded it or when. The *other* answer is a refusal rather than
 * an overwrite — see `answer_already_recorded`.
 *
 * **Both outcomes, one act** (issue #1283). "Not cleared" asks for exactly the
 * same evidence and runs exactly the same refusals, because it is the same
 * conversation at the desk with the opposite result — and it is the outcome
 * with teeth, since it is the one that keeps a paying diver off the boat. What
 * it does *not* do is lift anything: a refusal writes no `medicalClearedAt`, so
 * `isUnresolvedMedicalHold` still holds the diver and readiness still refuses to
 * board them. Nothing about the block changes; only what the surfaces can say
 * about it.
 */
export async function recordMedicalEvaluation(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    recordedByPersonId: string;
    /** Which way the physician answered. Never inferred — the staffer says which. */
    outcome: MedicalEvaluationOutcome;
    /** The day the physician evaluated the diver, as printed on the form. */
    evaluatedOn: string;
    /** The clinician who signed it. Required unless the evaluation itself is attached. */
    physicianName?: string | null;
    /** The physician's evaluation, already re-stored through `storeMedicalClearanceDocument`. */
    documentUrl?: string | null;
    /**
     * The staffer's explicit word that the physician evaluated the diver's
     * **current** condition, not only the earlier referral the letter was
     * written for (issue #2616). Read only when the letter predates the open
     * referral; without it that letter is refused.
     */
    earlierLetterConfirmed?: boolean;
    /**
     * The release whose diver-sent doctor's form the staffer chose to use as
     * the evaluation (issue #2797), as the recording form showed it. Read only
     * with no `documentUrl`: a file the staffer attached wins. Must be one of
     * this diver's unanswered holds at this shop with a form on it, or it is
     * not evidence.
     */
    diverFormRecordId?: string | null;
    now?: Date;
  },
): Promise<MedicalEvaluationResult> {
  const now = input.now ?? nowDate();
  const physicianName = input.physicianName?.trim() || null;
  const documentUrl = input.documentUrl ?? null;
  if (!isValidCalendarDate(input.evaluatedOn)) {
    return { ok: false, reason: "evaluation_date_required" };
  }
  const diverFormRecordId = documentUrl ? null : (input.diverFormRecordId ?? null);
  if (!documentUrl && !physicianName && !diverFormRecordId) {
    return { ok: false, reason: "evidence_required" };
  }
  // The shop's own day, not the host's: on a UTC box a Key Largo evening is
  // already tomorrow, and a form dated today would read as the future.
  if (input.evaluatedOn > calendarDateInTimezone(now, "UTC")) {
    return { ok: false, reason: "evaluation_in_future" };
  }
  const result = await db.transaction(async (tx): Promise<MedicalEvaluationResult> => {
    const recordedBy = await activeStaffAttestorId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    const held = await heldReferrals(tx, input.shopId, input.personId);

    // "Answered" is either stamp: a refusal resolves the question as
    // conclusively as a clearance does, and only an unanswered record is open
    // to be written.
    const answered = held.find(
      (record) => record.medicalClearedAt !== null || record.medicalClearanceDeclinedAt !== null,
    );
    const open = openReferral(held);
    if (!open) {
      if (!answered) return { ok: false, reason: "no_medical_hold" };
      const standing: MedicalEvaluationOutcome = answered.medicalClearedAt
        ? "cleared"
        : "not_cleared";
      // The same answer twice is a double submit. The opposite answer is
      // somebody trying to overwrite a physician's word from the desk, and it
      // is refused in both directions: a "no" is not erasable, and a "yes" is
      // not quietly downgraded either.
      return standing === input.outcome
        ? { ok: true, recordId: answered.id, outcome: standing, alreadyRecorded: true }
        : { ok: false, reason: "answer_already_recorded" };
    }

    // The evaluation must post-date the answers it clears. Compared as calendar
    // dates in UTC, matching how the column is read back everywhere else.
    const disclosedOn = calendarDateInTimezone(signatureInstant(open), "UTC");
    let covering: WaiverRecord | null = null;
    if (input.evaluatedOn < disclosedOn) {
      // A letter older than this record can still be the one that covers it: the
      // diver re-signed the same "yes" before the shop recorded the letter
      // (issue #2616). Only when an earlier referral that is still open (and
      // still this diver's) flagged everything this one does, the letter is on or
      // after it and inside its own year, **and the staffer confirms the
      // physician evaluated the diver's current condition**: the prompts match by
      // text, and "yes" to the same question can mean a different condition now.
      // The same gate guards a refusal stamped from an earlier letter.
      covering = earliestCoveringReferral(
        held,
        open,
        await recordsOnPassedSeats(tx, input.shopId, input.personId),
      );
      const withinItsYear =
        Date.parse(`${input.evaluatedOn}T00:00:00.000Z`) + WAIVER_SIGNATURE_VALIDITY_MS >
        now.getTime();
      if (
        covering === null ||
        input.evaluatedOn < calendarDateInTimezone(signatureInstant(covering), "UTC") ||
        !withinItsYear ||
        input.earlierLetterConfirmed !== true
      ) {
        return { ok: false, reason: "evaluation_predates_disclosure" };
      }
    }

    // **The doctor's form the diver sent** (issue #2797). The answered row is
    // locked first, so a form the diver sends in the same breath either lands
    // before this read, and is used or deleted below, or waits and is refused
    // by `attachDiverMedicalForm`'s own guard. Never left on an answered row
    // (`waiver_records_diver_medical_form_held`).
    const [locked] = await tx
      .select({ form: waiverRecords.diverMedicalFormUrl })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, open.id))
      .for("update");
    const openForm = locked?.form ?? null;
    const usedForm = diverFormRecordId
      ? diverFormToUse(held, open.id, openForm, diverFormRecordId)
      : null;
    const evidenceUrl = documentUrl ?? usedForm?.url ?? null;
    if (!evidenceUrl && !physicianName) return { ok: false, reason: "evidence_required" };
    // A diver's file becomes evidence only when the staffer read it: typed the
    // physician from it, and opened it since it arrived (issue #2797).
    if (usedForm) {
      if (!physicianName) return { ok: false, reason: "diver_form_physician_required" };
      if (!(await staffOpenedDiverForm(tx, input.shopId, input.personId, recordedBy, usedForm))) {
        return { ok: false, reason: "diver_form_not_opened" };
      }
    }

    const cleared = input.outcome === "cleared";
    const [written] = await tx
      .update(waiverRecords)
      .set({
        medicalClearedAt: cleared ? now : null,
        medicalClearedByPersonId: cleared ? recordedBy : null,
        medicalClearanceDeclinedAt: cleared ? null : now,
        medicalClearanceDeclinedByPersonId: cleared ? null : recordedBy,
        medicalClearanceEvaluatedOn: input.evaluatedOn,
        medicalClearancePhysicianName: physicianName,
        medicalClearanceDocumentUrl: evidenceUrl,
        medicalClearanceDocumentFromDiver: usedForm !== null,
        diverMedicalFormUrl: null,
      })
      // Both stamps are in the guard, not just the one being written: two
      // staffers answering opposite ways in the same breath must not both
      // succeed, and narrowing on only the column this call sets would let the
      // second overwrite the first's row from the other side.
      .where(
        and(
          eq(waiverRecords.id, open.id),
          isNull(waiverRecords.medicalClearedAt),
          isNull(waiverRecords.medicalClearanceDeclinedAt),
        ),
      )
      .returning({ id: waiverRecords.id });
    // Lost the race: somebody else answered in the same breath. Re-read rather
    // than assume it was the same answer — reporting a refusal as a recorded
    // clearance is the one mistake this whole path exists to prevent.
    if (!written) {
      const [current] = await tx
        .select({ clearedAt: waiverRecords.medicalClearedAt })
        .from(waiverRecords)
        .where(eq(waiverRecords.id, open.id))
        .limit(1);
      const standing: MedicalEvaluationOutcome = current?.clearedAt ? "cleared" : "not_cleared";
      return standing === input.outcome
        ? { ok: true, recordId: open.id, outcome: standing, alreadyRecorded: true }
        : { ok: false, reason: "answer_already_recorded" };
    }
    // A form used from another of the diver's holds moves: one column, one
    // file. A form on this row the staffer did not use is not evidence of
    // anything now, so it is queued for deletion rather than kept.
    if (usedForm && usedForm.recordId !== open.id) {
      const [moved] = await tx
        .update(waiverRecords)
        .set({ diverMedicalFormUrl: null })
        .where(
          and(
            eq(waiverRecords.id, usedForm.recordId),
            eq(waiverRecords.shopId, input.shopId),
            eq(waiverRecords.diverMedicalFormUrl, usedForm.url),
            isNull(waiverRecords.anonymizedAt),
          ),
        )
        .returning({ id: waiverRecords.id });
      // Erased or changed under us: fail closed and write nothing.
      if (!moved) throw new Error("recordMedicalEvaluation: the diver's form moved");
    }
    if (openForm && openForm !== evidenceUrl) {
      await queueMediaDeletion(tx, {
        shopId: input.shopId,
        kind: "waiver_document",
        url: openForm,
      });
    }
    // Either way the diver's form went, the trail says who decided: accepted
    // as the evaluation, or received and not used (domain review 2 and 3).
    const formOutcome = usedForm
      ? { code: "medical_diver_form_accepted" as const, record: usedForm.recordId }
      : openForm
        ? { code: "medical_diver_form_not_used" as const, record: open.id }
        : null;
    if (
      formOutcome &&
      !(await recordDiverActivity(tx, {
        shopId: input.shopId,
        personId: input.personId,
        actorPersonId: recordedBy,
        code: formOutcome.code,
        waiverRecordId: formOutcome.record,
      }))
    ) {
      throw new Error("recordMedicalEvaluation: the diver's form outcome was not recorded");
    }
    if (!covering) {
      return { ok: true, recordId: written.id, outcome: input.outcome, alreadyRecorded: false };
    }
    // **Which earlier referral covered this answer**, on the trail (issue
    // #2616): a clearance that rests on a letter older than the release it
    // clears must say so wherever the record is read, and the audit is the
    // referral's id, not a guess from dates.
    const names = await tx
      .select({ id: people.id, name: people.fullName })
      .from(people)
      // diveday:allow-deleted-people: two names for an activity line; the diver already holds a live hold here.
      .where(
        and(
          eq(people.shopId, input.shopId),
          or(eq(people.id, recordedBy), eq(people.id, input.personId)),
        ),
      );
    const actorName = names.find((row) => row.id === recordedBy)?.name;
    const diverName = names.find((row) => row.id === input.personId)?.name;
    if (!actorName || !diverName) throw new Error("recordMedicalEvaluation: names missing");
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: recordedBy,
      subjectPersonId: input.personId,
      code: "medical_answered_by_earlier_letter",
      params: {
        actor: actorName,
        diver: diverName,
        evaluated: input.evaluatedOn,
        referred: calendarDateInTimezone(signatureInstant(covering), "UTC"),
        signed: disclosedOn,
        referral: covering.id,
        record: written.id,
        outcome: input.outcome,
      },
      occurredAt: now,
    });
    // The letter answered the open record only. A live seat still held by the
    // covering referral stays blocked until the desk records the letter there
    // too; counted here so the surface can say so plainly.
    const seatsStillHeld = (
      await tx
        .select({ id: waiverRecords.id })
        .from(waiverRecords)
        .innerJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
        .where(
          and(
            eq(waiverRecords.shopId, input.shopId),
            eq(waiverRecords.personId, input.personId),
            eq(waiverRecords.status, "medical_review"),
            isNull(waiverRecords.supersededAt),
            isNull(waiverRecords.anonymizedAt),
            isNull(waiverRecords.medicalClearedAt),
            isNull(waiverRecords.medicalClearanceDeclinedAt),
            eq(bookings.personId, waiverRecords.personId),
            ne(bookings.status, "cancelled"),
          ),
        )
    ).length;
    return {
      ok: true,
      recordId: written.id,
      outcome: input.outcome,
      alreadyRecorded: false,
      earlierLetter: { referralId: covering.id, seatsStillHeld },
    };
  });
  // A physician's answer clears or holds every seat this diver has: open and
  // primed manifests re-read, after the commit (issue #2613).
  if (result.ok && !result.alreadyRecorded) {
    await publishManifestEventsForPerson(db, input.shopId, input.personId);
  }
  return result;
}

export type RetireMedicalRefusalResult =
  | { ok: true; personId: string }
  | { ok: false; reason: "not_authorized" | "no_refusal" };

/**
 * **A seat whose physician said no is given a fresh release** — the supersede
 * act the glossary's *Physician clearance* entry describes (Aaron, 2026-10-06:
 * "a way for people who don't clear a waiver to be able to supply a new
 * waiver").
 *
 * A recorded answer stays final for its record: nothing here writes either
 * stamp, and the refused record keeps its evaluation, its document and its
 * seal. What moves is the record's hold on *this seat*: it is superseded, so
 * the seat's next `issueWaiverRequest` mints a new link instead of answering
 * `already_completed` forever.
 *
 * **Nothing is lifted.** The refusal keeps outranking every signature older
 * than it (`isStandingRefusal`, read through `listSignedWaiversByPerson`), so
 * the seat stays blocked — "A physician did not clear this diver to dive" —
 * until the diver signs a new release, online or on paper. A clean one boards
 * them without a second physician (Aaron, 2026-10-07, issue #2158), and every
 * surface that shows it warns that an earlier release was refused, with a
 * link to it (`overriddenRefusal`).
 *
 * Owner or manager, checked here against live roles as well as by the action,
 * because it is the one act that moves a physician's answer off a seat.
 */
export async function retireMedicalRefusal(
  db: AppDb,
  input: { shopId: string; bookingId: string; actorPersonId: string; now?: Date },
): Promise<RetireMedicalRefusalResult> {
  const now = input.now ?? nowDate();
  const result = await db.transaction(async (tx): Promise<RetireMedicalRefusalResult> => {
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
    if (!canRetireMedicalRefusal(roles ?? undefined))
      return { ok: false, reason: "not_authorized" };
    const [retired] = await tx
      .update(waiverRecords)
      .set({ supersededAt: now, tokenSealed: null })
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          eq(waiverRecords.bookingId, input.bookingId),
          eq(waiverRecords.status, "medical_review"),
          isNotNull(waiverRecords.medicalClearanceDeclinedAt),
          isNull(waiverRecords.medicalClearedAt),
          isNull(waiverRecords.supersededAt),
        ),
      )
      .returning({ personId: waiverRecords.personId });
    if (!retired) return { ok: false, reason: "no_refusal" };
    return { ok: true, personId: retired.personId };
  });
  if (result.ok) await publishManifestEventsForPerson(db, input.shopId, result.personId);
  return result;
}

/**
 * The stored physician's evaluation for one waiver record, or null (issue
 * #1283).
 *
 * Shop-scoped in the query rather than by the caller, and narrowed to a record
 * that actually holds a physician's answer: a URL on a row carrying neither
 * stamp cannot exist (the `waiver_records_medical_clearance_attributed` check
 * refuses it), and asking for one anyway means the read matches the state the
 * route claims to be showing rather than whatever the column happens to hold.
 *
 * Returns the URL rather than the bytes. Fetching is `src/lib/storage`'s job
 * and `src/db` has no business signing an S3 request; keeping the split means
 * this stays a plain, testable read. The diver's id rides along because the
 * route has to write who opened their file onto their own record.
 */
export async function getMedicalClearanceDocument(
  db: DbExecutor,
  shopId: string,
  recordId: string,
): Promise<{ url: string; personId: string } | null> {
  // An id Postgres cannot parse raises 22P02 rather than selecting nothing, and
  // the throw would escape the route as a 500 where it promises a uniform 404.
  // The house rule is written at `src/lib/uuid.ts`: an unparseable id names no
  // row, which is a 404.
  if (!isUuid(recordId)) return null;
  const [row] = await db
    // The person as well as the file: opening a diver's medical document is an
    // act their own record has to be able to show (issue #1283).
    .select({ url: waiverRecords.medicalClearanceDocumentUrl, personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.id, recordId),
        eq(waiverRecords.shopId, shopId),
        // Either answer, because a physician's letter saying *no* is a stored
        // evaluation like any other — the `..._attributed` check lets a
        // document hang off either stamp, and a read narrowed to clearances
        // would leave the refusal's own evidence unreachable, which is the
        // retention-liability-with-no-retrieval-value shape issue #1283 exists
        // to close.
        or(
          isNotNull(waiverRecords.medicalClearedAt),
          isNotNull(waiverRecords.medicalClearanceDeclinedAt),
        ),
        // An erased diver's document is destroyed, and the row keeps the
        // stamp. Reading through it would be reaching for bytes that are gone.
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .limit(1);
  return row?.url ? { url: row.url, personId: row.personId } : null;
}

/**
 * The diver-sent form a staffer chose (`diverFormRecordId`), if it is still
 * one: on the answered row (read under its lock), or on another of this
 * diver's unanswered holds at this shop (`held` is already scoped to both).
 */
function diverFormToUse(
  held: readonly WaiverRecord[],
  openId: string,
  openForm: string | null,
  recordId: string,
): { recordId: string; url: string } | null {
  if (recordId === openId) return openForm ? { recordId, url: openForm } : null;
  const source = held.find(
    (record) =>
      record.id === recordId &&
      record.medicalClearedAt === null &&
      record.medicalClearanceDeclinedAt === null,
  );
  return source?.diverMedicalFormUrl ? { recordId, url: source.diverMedicalFormUrl } : null;
}

/**
 * Whether this staffer opened this diver-sent form since it arrived: a
 * `diver_medical_form_opened` line on the diver's trail, by them, naming the
 * release, no earlier than the form's sent time (so an open of a form they
 * turned away does not count for the one sent after it).
 */
async function staffOpenedDiverForm(
  tx: DbExecutor,
  shopId: string,
  personId: string,
  actorPersonId: string,
  form: { recordId: string },
): Promise<boolean> {
  const [source] = await tx
    .select({ sentAt: waiverRecords.diverMedicalFormSentAt })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.id, form.recordId), eq(waiverRecords.shopId, shopId)))
    .limit(1);
  if (!source?.sentAt) return false;
  const [read] = await tx
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.shopId, shopId),
        eq(activityEvents.code, "diver_medical_form_opened"),
        eq(activityEvents.actorPersonId, actorPersonId),
        eq(activityEvents.subjectPersonId, personId),
        sql`${activityEvents.params}->>'record' = ${form.recordId}`,
        gte(activityEvents.occurredAt, source.sentAt),
      ),
    )
    .limit(1);
  return Boolean(read);
}

export type RejectDiverMedicalFormResult =
  | { ok: true }
  | { ok: false; reason: "not_authorized" | "no_form" };

/**
 * **"Can't use this form"** (issue #2797, domain review 3): a staffer turns
 * away a diver-sent form that is blurry, the wrong page or unsigned. The file
 * is queued for deletion, both columns are emptied so the diver can send
 * again from the doctor's page, and `medical_diver_form_not_used` names who
 * decided. The link alone still cannot replace a form; only this reopens it.
 *
 * The same roles that may record the answer (live staff of this shop), and
 * only a form on one of this diver's unanswered holds here.
 */
export async function rejectDiverMedicalForm(
  db: AppDb,
  input: { shopId: string; personId: string; recordId: string; actorPersonId: string },
): Promise<RejectDiverMedicalFormResult> {
  return db.transaction(async (tx): Promise<RejectDiverMedicalFormResult> => {
    const actor = await activeStaffAttestorId(tx, input.shopId, input.actorPersonId);
    if (!actor) return { ok: false, reason: "not_authorized" };
    if (!isUuid(input.recordId)) return { ok: false, reason: "no_form" };
    const [held] = await tx
      .select({ url: waiverRecords.diverMedicalFormUrl })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.id, input.recordId),
          eq(waiverRecords.shopId, input.shopId),
          eq(waiverRecords.personId, input.personId),
          eq(waiverRecords.status, "medical_review"),
          isNull(waiverRecords.medicalClearedAt),
          isNull(waiverRecords.medicalClearanceDeclinedAt),
          isNull(waiverRecords.anonymizedAt),
          isNotNull(waiverRecords.diverMedicalFormUrl),
        ),
      )
      .for("update")
      .limit(1);
    if (!held?.url) return { ok: false, reason: "no_form" };
    await tx
      .update(waiverRecords)
      .set({ diverMedicalFormUrl: null, diverMedicalFormSentAt: null })
      .where(eq(waiverRecords.id, input.recordId));
    await queueMediaDeletion(tx, { shopId: input.shopId, kind: "waiver_document", url: held.url });
    if (
      !(await recordDiverActivity(tx, {
        shopId: input.shopId,
        personId: input.personId,
        actorPersonId: actor,
        code: "medical_diver_form_not_used",
        waiverRecordId: input.recordId,
      }))
    ) {
      throw new Error("rejectDiverMedicalForm: the trail line was not written");
    }
    return { ok: true };
  });
}

/**
 * **The doctor's form a diver sent, for staff to open** (issue #2797, ADR
 * 20261024-diver-sent-doctors-form). Shop-scoped in the query, never through
 * an erased record, and the diver's id rides along for the trail the route
 * writes. A URL, never bytes: fetching is `src/lib/storage`'s job.
 */
export async function getDiverMedicalForm(
  db: DbExecutor,
  shopId: string,
  recordId: string,
): Promise<{ url: string; personId: string } | null> {
  if (!isUuid(recordId)) return null;
  const [row] = await db
    .select({ url: waiverRecords.diverMedicalFormUrl, personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.id, recordId),
        eq(waiverRecords.shopId, shopId),
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .limit(1);
  return row?.url ? { url: row.url, personId: row.personId } : null;
}

/**
 * The newest doctor's form this diver sent for a hold nobody has answered, at
 * this shop: what the diver record offers to open, and to use as the
 * evaluation. Any of the diver's holds, not only the one an answer would land
 * on, so a form sent from a second seat's link is not out of sight.
 */
export async function getDiverMedicalFormForHold(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<{ recordId: string; sentAt: Date } | null> {
  const [row] = await db
    .select({ recordId: waiverRecords.id, sentAt: waiverRecords.diverMedicalFormSentAt })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "medical_review"),
        isNotNull(waiverRecords.diverMedicalFormUrl),
        isNull(waiverRecords.medicalClearedAt),
        isNull(waiverRecords.medicalClearanceDeclinedAt),
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .orderBy(desc(waiverRecords.diverMedicalFormSentAt))
    .limit(1);
  return row?.sentAt ? { recordId: row.recordId, sentAt: row.sentAt } : null;
}

type HeldRecord = typeof waiverRecords.$inferSelect;

/**
 * **What the doctor's page shows before anything is unlocked** (fifth-loop
 * ideas, item 17; H-20261014-physician-form-for-referral and ADR 20261016-doctor-referral-page, both amended by
 * the layer r5-3 reviews). Only the diver's name, and which of three things the
 * answers section says:
 *
 * - `locked`: there are answers to show, behind the diver's date of birth;
 * - `whole`: nothing to show, so the doctor goes through the whole form (no
 *   date of birth on file to unlock with, or a paper or status-only hold);
 * - `unfinished`: the stored form was never finished.
 *
 * Neither the date of birth nor any answer reaches the page module.
 */
export type DoctorReferral = {
  fullName: string;
  answers: "locked" | "whole" | "unfinished";
  /** The diver already sent the signed form from this page (issue #2797). */
  formSent: boolean;
};

/** What the answers section shows once the date of birth matches. */
export type DoctorReferralAnswers = {
  items: MedicalReferralItem[];
  form: PublishedMedicalForm | null;
};

/**
 * The person behind a release still waiting on a physician, while its seat is
 * held and its departure has not ended (plus `DOCTOR_PAGE_TRIP_GRACE_MS`).
 * Anything else is no doctor's page: a hold on a canceled seat or a trip that
 * has sailed is rarely resolved by staff, so without this the page and every
 * printed or forwarded copy of its link would open for ever (security review of
 * layer r5-3, F3).
 */
async function heldPersonForDoctor(db: DbExecutor, record: HeldRecord, now: Date) {
  if (!awaitsPhysician(record) || !record.bookingId) return null;
  const [seat] = await db
    .select({ tripEndsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, record.bookingId),
        eq(bookings.shopId, record.shopId),
        inArray(bookings.status, [...SEAT_HELD_STATUSES]),
        eq(trips.status, "scheduled"),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!seat || !doctorPageWithinTrip(seat.tripEndsAt, now)) return null;
  const [person] = await db
    .select({ fullName: people.fullName, dateOfBirth: people.dateOfBirth })
    .from(people)
    .where(and(eq(people.id, record.personId), eq(people.shopId, record.shopId), livePerson()))
    .limit(1);
  return person ?? null;
}

/** Whether the held waiver page offers the doctor's page at all. */
export async function doctorPageOpen(
  db: DbExecutor,
  record: HeldRecord,
  now: Date = nowDate(),
): Promise<boolean> {
  return (await heldPersonForDoctor(db, record, now)) !== null;
}

/**
 * **The doctor's page's one read.** The caller has already resolved `record`
 * from the diver's own waiver link, so this widens nothing. Null for a release
 * the page does not open for, which the page answers with a redirect.
 */
export async function getDoctorReferral(
  db: DbExecutor,
  record: HeldRecord,
  now: Date = nowDate(),
): Promise<DoctorReferral | null> {
  const person = await heldPersonForDoctor(db, record, now);
  if (!person) return null;
  const hasItems =
    referralItems(record.medicalAnswers).length > 0 &&
    record.doctorUnlockFailures < DOCTOR_UNLOCK_FAILURE_LIMIT;
  const unfinished =
    record.medicalAnswers !== null &&
    calculateMedicalResult(record.medicalAnswers).status === "incomplete";
  return {
    fullName: person.fullName,
    answers:
      hasItems && person.dateOfBirth ? "locked" : unfinished && !hasItems ? "unfinished" : "whole",
    formSent: record.diverMedicalFormSentAt !== null,
  };
}

/**
 * Whether the doctor's page takes a signed form for this release (issue
 * #2797): `open` while the page itself opens and nothing was sent, `sent`
 * once one was, `closed` otherwise. The action asks this **before** it stores
 * anything, so a refusal never leaves a medical document in the bucket with
 * no row pointing at it (the reasoning at `hasUnansweredMedicalHold`).
 */
export async function diverMedicalFormOpen(
  db: DbExecutor,
  record: HeldRecord,
  now: Date = nowDate(),
): Promise<"open" | "sent" | "closed"> {
  if (!(await heldPersonForDoctor(db, record, now))) return "closed";
  return record.diverMedicalFormSentAt === null ? "open" : "sent";
}

/**
 * **Attach the signed doctor's form the diver sent** (issue #2797, ADR
 * 20261024-diver-sent-doctors-form), already re-stored through
 * `storeMedicalClearanceDocument`.
 *
 * Once per release: the write takes only a row with nothing sent, so a second
 * send, a stale read of the link or a forwarded copy of it can never replace
 * the first. And only while the release still waits on a physician: the
 * guard repeats `awaitsPhysician` in the statement, so an answer or an
 * erasure that lands after the caller read the link still refuses it.
 * Anything but `sent` leaves the stored file with nothing pointing at it, and
 * the caller queues it for deletion.
 */
export async function attachDiverMedicalForm(
  db: DbExecutor,
  record: HeldRecord,
  url: string,
  now: Date = nowDate(),
): Promise<"sent" | "already" | "closed"> {
  if (!(await heldPersonForDoctor(db, record, now))) return "closed";
  const [written] = await db
    .update(waiverRecords)
    .set({ diverMedicalFormUrl: url, diverMedicalFormSentAt: now })
    .where(
      and(
        eq(waiverRecords.id, record.id),
        eq(waiverRecords.shopId, record.shopId),
        eq(waiverRecords.status, "medical_review"),
        isNull(waiverRecords.supersededAt),
        isNull(waiverRecords.medicalClearedAt),
        isNull(waiverRecords.medicalClearanceDeclinedAt),
        isNull(waiverRecords.anonymizedAt),
        isNull(waiverRecords.diverMedicalFormSentAt),
      ),
    )
    .returning({ id: waiverRecords.id });
  if (written) return "sent";
  const [current] = await db
    .select({
      sentAt: waiverRecords.diverMedicalFormSentAt,
      clearedAt: waiverRecords.medicalClearedAt,
      declinedAt: waiverRecords.medicalClearanceDeclinedAt,
      anonymizedAt: waiverRecords.anonymizedAt,
    })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.id, record.id), eq(waiverRecords.shopId, record.shopId)))
    .limit(1);
  // "Already" only for a hold still waiting with a form on it; an answered or
  // erased one is closed, whatever it holds.
  return current?.sentAt && !current.clearedAt && !current.declinedAt && !current.anonymizedAt
    ? "already"
    : "closed";
}

/**
 * **The answers, for whoever knows the diver's date of birth** (security
 * review of layer r5-3, F1 and second-pass FIX-1). A forwarded or printed
 * waiver link alone no longer tells its reader which conditions the diver
 * disclosed: the published prompts sit behind a date of birth the page never
 * prints.
 *
 * - null when the page itself would not open;
 * - `whole` without comparing anything when there is nothing to unlock (no
 *   referral items, no date on file), so the action never confirms a date of
 *   birth for its own sake, and once the release has taken
 *   `DOCTOR_UNLOCK_FAILURE_LIMIT` wrong dates;
 * - `mismatch` for a wrong date, counted on the record, the attempt that
 *   reaches the ceiling answering `whole` and logging
 *   `doctor_answers.locked_out` with the record id only.
 *
 * A right date spends nothing. The caller rate-limits as well.
 */
export async function revealDoctorReferral(
  db: DbExecutor,
  record: HeldRecord,
  enteredBirthdate: string,
  now: Date = nowDate(),
): Promise<DoctorReferralAnswers | "mismatch" | "whole" | null> {
  const person = await heldPersonForDoctor(db, record, now);
  if (!person) return null;
  const items = referralItems(record.medicalAnswers);
  if (items.length === 0 || !person.dateOfBirth) return "whole";
  if (record.doctorUnlockFailures >= DOCTOR_UNLOCK_FAILURE_LIMIT) return "whole";
  if (isValidCalendarDate(enteredBirthdate) && enteredBirthdate === person.dateOfBirth) {
    return { items, form: answeredMedicalForm(record.medicalAnswers) };
  }
  // Counted in the statement, never from the read above: two tries racing each
  // other must both be counted.
  const [counted] = await db
    .update(waiverRecords)
    .set({ doctorUnlockFailures: sql`${waiverRecords.doctorUnlockFailures} + 1` })
    .where(and(eq(waiverRecords.id, record.id), eq(waiverRecords.shopId, record.shopId)))
    .returning({ failures: waiverRecords.doctorUnlockFailures });
  const failures = counted?.failures ?? DOCTOR_UNLOCK_FAILURE_LIMIT;
  if (failures < DOCTOR_UNLOCK_FAILURE_LIMIT) return "mismatch";
  if (failures === DOCTOR_UNLOCK_FAILURE_LIMIT) {
    log("doctor_answers.locked_out", "warn", { record: record.id });
  }
  return "whole";
}
