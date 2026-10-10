/**
 * Waivers: the bearer's side — resolving a token, saving a draft, the
 * guardian's co-signature, emergency contacts, and completing the release.
 * Imported through the `./waivers` barrel.
 */
import { and, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { readEmergencyContact } from "@/lib/contact";
import {
  type GuardianRelationship,
  guardianSignatureRequired,
  isGuardianRelationship,
  signingDate,
} from "@/lib/guardian";
import { validateMedicalAnswers } from "@/lib/medical";
import { personNamesMatch } from "@/lib/person-name";
import { localTypedConsentProvider } from "@/lib/signatures";
import { computeWaiverIntegrityHash } from "@/lib/waiver-integrity";
import { hashWaiverToken } from "@/lib/waiver-tokens";
import { needsMedicalReview } from "@/lib/waivers";
import type { AppDb, DbExecutor } from "./client";
import type { DraftGuardian, MedicalAnswers } from "./schema";
import { bookings, people, waiverRecords } from "./schema";
import { shopTimezone } from "./waivers-templates";

export type TokenWaiverState =
  | { state: "unavailable" }
  // Carries the record (a real, once-valid link) so the page can still
  // identify the shop and its contact channels, and the record's own
  // `expiresAt` — a diver reading a dead link still deserves a name and a
  // way to reach someone, not a wall with nothing to click.
  | { state: "expired"; record: typeof waiverRecords.$inferSelect }
  | { state: "available"; record: typeof waiverRecords.$inferSelect }
  /**
   * A live link on a held seat (`identity_unconfirmed_at`): it opens no form,
   * names nobody and takes no draft or signature until the desk confirms who
   * is in the seat (issue #2125). The record is carried for the shop's name.
   */
  | { state: "held"; record: typeof waiverRecords.$inferSelect }
  | { state: "completed"; record: typeof waiverRecords.$inferSelect };

/**
 * `bookingId` is nullable for imported, paper, and independent digital waivers.
 * A bearer token only needs the record's shop and person, so token pages handle
 * both booking-scoped and person-scoped releases.
 */
async function currentRecordForToken(db: AppDb, token: string) {
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(
      and(eq(waiverRecords.tokenHash, hashWaiverToken(token)), isNull(waiverRecords.supersededAt)),
    )
    .limit(1);
  return record ?? null;
}

/** A bearer token reveals only its own record and is rejected on expiry/supersession. */
export async function getWaiverForToken(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<TokenWaiverState> {
  const record = await currentRecordForToken(db, token);
  if (!record) return { state: "unavailable" };
  if (record.status !== "pending") return { state: "completed", record };
  if (record.expiresAt <= now) return { state: "expired", record };
  if (record.bookingId) {
    const [booking] = await db
      .select({ identityUnconfirmedAt: bookings.identityUnconfirmedAt })
      .from(bookings)
      .where(and(eq(bookings.id, record.bookingId), eq(bookings.shopId, record.shopId)))
      .limit(1);
    if (booking?.identityUnconfirmedAt) return { state: "held", record };
  }
  return { state: "available", record };
}

/**
 * The record behind a token that can no longer be signed but is still, provably,
 * the diver's own: pending and either past its expiry or superseded by a fresher
 * link. `getWaiverForToken` reports the first as `expired` and the second as
 * `unavailable`, and issuing a replacement supersedes the very record that asked
 * for it — so this is what keeps the same stale URL landing on the self-serve
 * "email me a fresh link" card on the second tap and every refresh after,
 * instead of a dead end that looks like the tap broke something.
 *
 * Deliberately narrow: never a live record and never a completed one, so this
 * can't become a second way to reach a signable link or to read signed evidence.
 * It returns the record for context only — the rescue flow issues its own fresh
 * token and hands it to the address on file, never back to the caller.
 */
export async function staleWaiverRecordForToken(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<typeof waiverRecords.$inferSelect | null> {
  const [record] = await db
    .select()
    .from(waiverRecords)
    .where(eq(waiverRecords.tokenHash, hashWaiverToken(token)))
    .limit(1);
  if (record?.status !== "pending") return null;
  if (!record.supersededAt && record.expiresAt > now) return null;
  return record;
}

export async function saveWaiverDraft(
  db: AppDb,
  token: string,
  input: {
    signerName?: string;
    acknowledged: boolean;
    medicalAnswers: MedicalAnswers;
    /** The guardian section as typed, for a parent who comes back to the link. */
    guardian?: DraftGuardian;
    now?: Date;
  },
): Promise<boolean> {
  const state = await getWaiverForToken(db, token, input.now);
  if (state.state !== "available") return false;
  const now = input.now ?? nowDate();
  const [saved] = await db
    .update(waiverRecords)
    .set({
      startedAt: state.record.startedAt ?? now,
      draftSignerName: input.signerName?.trim() || null,
      draftAcknowledged: input.acknowledged,
      draftMedicalAnswers: input.medicalAnswers,
      ...(input.guardian === undefined ? {} : { draftGuardian: input.guardian }),
    })
    .where(and(eq(waiverRecords.id, state.record.id), eq(waiverRecords.status, "pending")))
    .returning({ id: waiverRecords.id });
  return Boolean(saved);
}

export type CompleteWaiverOutcome =
  | { ok: true; status: "completed" | "medical_review"; idempotent: boolean }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "expired"
        | "invalid_signature"
        | "name_mismatch"
        | "invalid_medical"
        /** The diver is a minor on the signing day and no guardian section came with the signature. */
        | "guardian_required"
        /** A guardian section came, and it is not a signature: no consent, no relationship, no email, or the diver's own name. */
        | "guardian_invalid"
        /** The booking is a held seat: nothing is signed onto the matched record until the desk confirms (issue #2125). */
        | "identity_unconfirmed";
    };

/**
 * The guardian's half of a minor's release, as the page collects it (ADR
 * 20260907-guardian-co-signature). `agreed` is the guardian's own consent box,
 * the same assurance the diver's signature takes — a typed name is not a
 * signature until it is ticked.
 */
/** Local part, `@`, domain with at least one dot — the shape an address has. */
const GUARDIAN_EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GuardianInput = {
  name: string;
  relationship: string;
  email: string;
  agreed: boolean;
};

/**
 * What the guardian section has to be before it counts as a signature, given
 * the diver it is for. Returns the evidence to write, or the reason it is not.
 *
 * The name check is the co-signature's own version of the name-mismatch rule
 * two lines below for the diver: a minor typing their own name twice is one
 * signature wearing two hats, and the whole point of a second signer is that
 * they are somebody else.
 */
function guardianEvidence(
  guardian: GuardianInput,
  diverFullName: string,
  now: Date,
):
  | {
      ok: true;
      name: string;
      relationship: GuardianRelationship;
      /** Null when the family gave none — the column is nullable (issue #1453). */
      email: string | null;
      method: string;
      consentedAt: Date;
      signedAt: Date;
    }
  | { ok: false } {
  const evidence = localTypedConsentProvider.capture({
    signerName: guardian.name,
    agreed: guardian.agreed,
    signedAt: now,
  });
  if (!evidence) return { ok: false };
  if (!isGuardianRelationship(guardian.relationship)) return { ok: false };
  const email = guardian.email.trim().toLowerCase();
  // **Optional, shape-checked when given** (issue #1453, owner decision
  // 2026-09-10). Blank is a family with no address — a grandparent at a
  // counter, or a household sharing the one the diver already gave — and
  // refusing them outright was the wrong end of the promise, since nothing
  // ever sent to the column. What is *not* relaxed is the shape: the page
  // dropped `required`, so this is what stands between a hand-built request
  // and an address on a signed release that nobody can ever reach the guardian
  // at. A malformed address is still a refusal, never a silent null.
  if (email !== "" && !GUARDIAN_EMAIL_SHAPE.test(email)) return { ok: false };
  // **The online path has no namesake exception and must never grow one**
  // (issue #1573, owner decision 2026-09-10). The paper path does, because a
  // named staffer physically watched two people sign; here the shop has no
  // evidence a second person exists at all, so a co-signer with the diver's
  // own name is one signature wearing two hats and is refused. `GuardianInput`
  // deliberately carries no field a request could set to get past this.
  if (personNamesMatch(evidence.signerName, diverFullName)) return { ok: false };
  return {
    ok: true,
    name: evidence.signerName,
    relationship: guardian.relationship,
    email: email === "" ? null : email,
    method: evidence.method,
    consentedAt: evidence.consentedAt,
    signedAt: evidence.signedAt,
  };
}

function completedStatus(
  status: typeof waiverRecords.$inferSelect.status,
): "completed" | "medical_review" {
  return status === "medical_review" ? "medical_review" : "completed";
}

/** Optional emergency contact captured alongside the waiver, stored on the person. */
export type EmergencyContactInput = { name?: string; phone?: string };

/**
 * Write the diver's emergency contact to their person record, as a pair or not
 * at all — `readEmergencyContact` holds that rule and says why a half-filled
 * submission is refused rather than merged. Both boxes blank is still the
 * no-change case: a diver who leaves the section alone must never wipe a value
 * the shop already has on file. The person is reached through the record's
 * booking, so a bearer token can only ever touch its own diver.
 */
async function saveEmergencyContact(
  db: AppDb,
  bookingId: string,
  contact: EmergencyContactInput,
): Promise<void> {
  const submitted = readEmergencyContact(contact);
  if (submitted.kind !== "pair") return;
  const patch: Partial<typeof people.$inferInsert> = {
    emergencyContactName: submitted.name,
    emergencyContactPhone: submitted.phone,
  };
  const [booking] = await db
    .select({ personId: bookings.personId, identityUnconfirmedAt: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  // A held seat's link may be in someone else's hands: never write onto the
  // diver record it was matched to until staff confirm who it is (#2082).
  if (!booking || booking.identityUnconfirmedAt) return;
  await db.update(people).set(patch).where(eq(people.id, booking.personId));
}

/**
 * The diver's emergency contact on file as the bearer waiver page may show it,
 * reached through their booking. Blank and `held` on a held seat (`identity_unconfirmed_at`): the bearer link that
 * reads it may not belong to the diver record the seat was matched to, so the
 * page asks for nothing it could not save (#2082).
 */
export async function getEmergencyContactForBearer(
  db: AppDb,
  bookingId: string,
): Promise<{ name: string | null; phone: string | null; held: boolean } | null> {
  const [row] = await db
    .select({
      name: people.emergencyContactName,
      phone: people.emergencyContactPhone,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;
  if (row.identityUnconfirmedAt) return { name: null, phone: null, held: true };
  return { name: row.name, phone: row.phone, held: false };
}

/** The same person-level contact read used by a waiver with no booking. */
export async function getEmergencyContactForPerson(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<{ name: string | null; phone: string | null } | null> {
  const [row] = await db
    .select({ name: people.emergencyContactName, phone: people.emergencyContactPhone })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

/**
 * Save an emergency contact for a booking's diver, scoped to the shop so a
 * bearer-token surface (the `/ready` page) can only ever write to its own
 * booking's person. Blanks never overwrite an existing value, and a name
 * without a number (or a number without a name) writes nothing at all and
 * returns `false` — `readEmergencyContact` is where that rule lives. Callers
 * that can say so to a person check the pair themselves first, so the refusal
 * arrives as words rather than as a save that quietly did not happen.
 */
export async function saveBookingEmergencyContact(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    name?: string;
    phone?: string;
    /**
     * Who is writing. A bearer link on a held seat (`identity_unconfirmed_at`)
     * may belong to someone other than the diver record it was matched to, so
     * it never writes onto that record until staff confirm who it is (#2082).
     */
    actor: "bearer" | "staff";
  },
): Promise<boolean> {
  const submitted = readEmergencyContact(input);
  if (submitted.kind !== "pair") return false;
  const patch: Partial<typeof people.$inferInsert> = {
    emergencyContactName: submitted.name,
    emergencyContactPhone: submitted.phone,
  };
  const [booking] = await db
    .select({ personId: bookings.personId, identityUnconfirmedAt: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return false;
  if (input.actor === "bearer" && booking.identityUnconfirmedAt) return false;
  const [updated] = await db
    .update(people)
    .set(patch)
    // The shop is restated rather than inherited from the read above. That
    // read proves the *booking* is this shop's; it does not prove
    // `bookings.person_id` points at a person inside it. This is the write a
    // bearer-token page reaches, so a row that ever goes wrong that way is
    // non-exploitable instead of merely unlikely — the same predicate
    // `savePersonEmergencyContact` below makes.
    .where(and(eq(people.id, booking.personId), eq(people.shopId, input.shopId)))
    .returning({ id: people.id });
  return Boolean(updated);
}

/**
 * Save a person-level emergency contact when the waiver has no booking context.
 * Same pair-or-nothing rule as `saveBookingEmergencyContact`.
 */
export async function savePersonEmergencyContact(
  db: DbExecutor,
  input: { shopId: string; personId: string; name?: string; phone?: string },
): Promise<boolean> {
  const submitted = readEmergencyContact(input);
  if (submitted.kind !== "pair") return false;
  const patch: Partial<typeof people.$inferInsert> = {
    emergencyContactName: submitted.name,
    emergencyContactPhone: submitted.phone,
  };
  const [updated] = await db
    .update(people)
    .set(patch)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .returning({ id: people.id });
  return Boolean(updated);
}

export async function completeWaiver(
  db: AppDb,
  token: string,
  input: {
    signerName: string;
    agreed: boolean;
    medicalAnswers: MedicalAnswers;
    emergencyContact?: EmergencyContactInput;
    /**
     * The guardian's half, when the page collected one. Required when the
     * diver is a minor on the signing day; ignored otherwise — an adult's
     * release carries no co-signer, whatever was typed into a section the
     * page never rendered for them.
     */
    guardian?: GuardianInput;
    now?: Date;
  },
): Promise<CompleteWaiverOutcome> {
  const now = input.now ?? nowDate();
  const evidence = localTypedConsentProvider.capture({
    signerName: input.signerName,
    agreed: input.agreed,
    signedAt: now,
  });
  if (!evidence) return { ok: false, reason: "invalid_signature" };

  const state = await getWaiverForToken(db, token, now);
  if (state.state === "unavailable") return { ok: false, reason: "unavailable" };
  if (state.state === "expired") return { ok: false, reason: "expired" };
  if (state.state === "held") return { ok: false, reason: "identity_unconfirmed" };
  if (state.state === "completed") {
    return { ok: true, status: completedStatus(state.record.status), idempotent: true };
  }

  // "Type your full name" is the signature. It accepted anything at least two
  // characters long, so a release could be executed under "asdf" and still read
  // as a signed waiver on the manifest. The typed name must plausibly be the
  // diver the record belongs to — `personNamesMatch` tolerates case, accents,
  // punctuation, word order and a middle initial (the noise that is *not* a
  // different person) and refuses anything that changes a name token.
  //
  // Refused *before* the record is touched, so a mismatch leaves the link
  // signable rather than burning it. A diver whose booking genuinely holds the
  // wrong name is directed to the shop, which can correct the record.
  const [signer] = await db
    .select({ fullName: people.fullName, dateOfBirth: people.dateOfBirth })
    .from(people)
    .where(eq(people.id, state.record.personId))
    .limit(1);
  if (!signer || !personNamesMatch(evidence.signerName, signer.fullName)) {
    return { ok: false, reason: "name_mismatch" };
  }

  // A minor signs twice (ADR 20260907-guardian-co-signature): the same
  // typed-consent evidence, from a parent or legal guardian, on the same
  // sitting. Decided on the shop's calendar day the signature is given, from
  // the date of birth on file — never from anything the form claims about
  // the diver's age. Refused before the record is touched, like the name
  // mismatch above, so a family that missed the section keeps the link.
  const timezone = await shopTimezone(db, state.record.shopId);
  const minor = guardianSignatureRequired(signer.dateOfBirth, signingDate(now, timezone));
  let guardian: ReturnType<typeof guardianEvidence> | null = null;
  if (minor) {
    if (!input.guardian) return { ok: false, reason: "guardian_required" };
    guardian = guardianEvidence(input.guardian, signer.fullName, now);
    if (!guardian.ok) return { ok: false, reason: "guardian_invalid" };
  }

  // The form is conditional: closed boxes are not submitted, but every
  // applicable question must be answered before signed evidence is written.
  // `requireCurrent`: a retired questionnaire version stays readable so stored
  // evidence can be interpreted, but must never be the question set a *new*
  // signature is taken against — otherwise a corrected form could be answered
  // under the version it corrected. The page already derives the version
  // server-side; this makes that structural rather than a property of one call
  // site staying careful (`coderabbitai`).
  const medicalValidation = validateMedicalAnswers(input.medicalAnswers, {
    requireComplete: true,
    requireCurrent: true,
  });
  if (!medicalValidation.ok) {
    return { ok: false, reason: "invalid_medical" };
  }
  const medicalReviewRequired = needsMedicalReview(input.medicalAnswers);
  const status = medicalReviewRequired ? ("medical_review" as const) : ("completed" as const);
  const [saved] = await db
    .update(waiverRecords)
    .set({
      status,
      signedName: evidence.signerName,
      signatureMethod: evidence.method,
      consentedAt: evidence.consentedAt,
      signedAt: evidence.signedAt,
      medicalAnswers: input.medicalAnswers,
      medicalReviewRequired,
      completedAt: now,
      // Signed: the link has done its job, so the openable copy goes. The token
      // still *resolves* (a diver revisiting sees their signed release) — it
      // just can no longer be read back out of the database and re-sent.
      tokenSealed: null,
      // The guardian's half, on a minor's release only. The draft goes with
      // the rest of the unsubmitted state: what was typed is now what was
      // signed, and a draft of a signed section is a second copy of personal
      // data with no reader.
      ...(guardian?.ok
        ? {
            guardianName: guardian.name,
            guardianRelationship: guardian.relationship,
            guardianEmail: guardian.email,
            guardianSignatureMethod: guardian.method,
            guardianConsentedAt: guardian.consentedAt,
            guardianSignedAt: guardian.signedAt,
          }
        : {}),
      draftGuardian: null,
    })
    .where(and(eq(waiverRecords.id, state.record.id), eq(waiverRecords.status, "pending")))
    .returning({ id: waiverRecords.id, status: waiverRecords.status });
  if (saved) {
    const [signedRecord] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, saved.id))
      .limit(1);
    if (signedRecord) {
      await db
        .update(waiverRecords)
        .set({
          integrityHash: computeWaiverIntegrityHash(signedRecord),
          integrityVersion: 1,
        })
        .where(eq(waiverRecords.id, signedRecord.id));
    }
    if (input.emergencyContact) {
      if (state.record.bookingId) {
        await saveEmergencyContact(db, state.record.bookingId, input.emergencyContact);
      } else {
        await savePersonEmergencyContact(db, {
          shopId: state.record.shopId,
          personId: state.record.personId,
          name: input.emergencyContact.name,
          phone: input.emergencyContact.phone,
        });
      }
    }
    return { ok: true, status: completedStatus(saved.status), idempotent: false };
  }

  // Another submit won the race. Do not overwrite its evidence; report that
  // stable result instead, which makes duplicate browser submits harmless.
  const current = await currentRecordForToken(db, token);
  if (current?.status === "completed" || current?.status === "medical_review") {
    return { ok: true, status: completedStatus(current.status), idempotent: true };
  }
  return { ok: false, reason: "unavailable" };
}
