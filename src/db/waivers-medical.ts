/**
 * Waivers: the medical questionnaire's consequences — a physician's
 * evaluation, the hold an unanswered one keeps, and retiring a refusal.
 * Imported through the `./waivers` barrel.
 */
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
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
import { awaitsPhysician, DOCTOR_UNLOCK_FAILURE_LIMIT, doctorPageWithinTrip } from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEventsForPerson } from "./manifest-events";
import { bookings, people, trips, waiverRecords } from "./schema";
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
    now?: Date;
  },
): Promise<MedicalEvaluationResult> {
  const now = input.now ?? nowDate();
  const physicianName = input.physicianName?.trim() || null;
  const documentUrl = input.documentUrl ?? null;
  if (!isValidCalendarDate(input.evaluatedOn)) {
    return { ok: false, reason: "evaluation_date_required" };
  }
  if (!documentUrl && !physicianName) return { ok: false, reason: "evidence_required" };
  // The shop's own day, not the host's: on a UTC box a Key Largo evening is
  // already tomorrow, and a form dated today would read as the future.
  if (input.evaluatedOn > calendarDateInTimezone(now, "UTC")) {
    return { ok: false, reason: "evaluation_in_future" };
  }
  const result = await db.transaction(async (tx): Promise<MedicalEvaluationResult> => {
    const recordedBy = await activeStaffAttestorId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    const held = await tx
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          eq(waiverRecords.personId, input.personId),
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

    // "Answered" is either stamp: a refusal resolves the question as
    // conclusively as a clearance does, and only an unanswered record is open
    // to be written.
    const answered = held.find(
      (record) => record.medicalClearedAt !== null || record.medicalClearanceDeclinedAt !== null,
    );
    // A live hold before a superseded one: it is the one holding its own seat
    // outright (`isUnresolvedMedicalHold`), so an answer landing on a newer
    // superseded referral instead would leave that seat blocked while the desk
    // reads "recorded". Newest first within each.
    const unanswered = held.filter(
      (record) => record.medicalClearedAt === null && record.medicalClearanceDeclinedAt === null,
    );
    const open =
      unanswered.find((record) => record.supersededAt === null) ??
      unanswered.find((record) => record.supersededAt !== null);
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
    const disclosedOn = open.signedAt ?? open.completedAt ?? open.createdAt;
    if (input.evaluatedOn < calendarDateInTimezone(disclosedOn, "UTC")) {
      return { ok: false, reason: "evaluation_predates_disclosure" };
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
        medicalClearanceDocumentUrl: documentUrl,
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
    return { ok: true, recordId: written.id, outcome: input.outcome, alreadyRecorded: false };
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

type HeldRecord = typeof waiverRecords.$inferSelect;

/**
 * **What the doctor's page shows before anything is unlocked** (fifth-loop
 * ideas, item 17; H-127 and ADR 20261016-doctor-referral-page, both amended by
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
  };
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
