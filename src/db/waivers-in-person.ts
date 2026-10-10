/**
 * Waivers: a release signed at the counter, attested by a staff member.
 * Imported through the `./waivers` barrel.
 */
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  type GuardianRelationship,
  type GuardianSigner,
  guardianSignatureMissing,
  guardianSignatureRequired,
  isGuardianRelationship,
  signingDate,
} from "@/lib/guardian";
import { personNamesMatch } from "@/lib/person-name";
import { inPersonAttestationProvider, namesakeAttestationProvider } from "@/lib/signatures";
import { computeWaiverIntegrityHash } from "@/lib/waiver-integrity";
import { createWaiverToken, hashWaiverToken } from "@/lib/waiver-tokens";
import { isCompletedWaiverCurrent, isUnresolvedMedicalHold } from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { bookings, people, trips, waiverRecords, waiverTemplates } from "./schema";
import { shopTimezone } from "./waivers-templates";

export type InPersonWaiverOutcome =
  | { ok: true; recordId: string; alreadySigned: boolean }
  | {
      ok: false;
      reason:
        | "booking_not_found"
        | "booking_unavailable"
        | "person_not_found"
        | "template_not_found"
        | "staff_not_found"
        | "medical_attestation_required"
        | "invalid_signature"
        /** The diver is a minor on the signing day and no guardian was named on the paper. */
        | "guardian_required"
        /**
         * A guardian was named and cannot be one: an unusable signature, or a
         * relationship outside the allowed set. The relationship arm is
         * genuinely unreachable from the form, whose `<select>` offers only the
         * two codes. The signature arm is *nearly* so — the input carries
         * `minLength={2}`, which the browser measures on the raw value while
         * `inPersonAttestationProvider.capture` trims first, so `"J "` reaches
         * here. Retyping fixes that, which is why a generic refusal is still
         * the honest answer for both, unlike the one below.
         */
        | "guardian_invalid"
        /**
         * A guardian was named and it is the diver's own name.
         *
         * Its own reason rather than `guardian_invalid`'s company (issue 1539),
         * because it is the one cause here an *honest* submission produces: a
         * father and son who share a legal name (#1454's family). The staffer
         * typing it in can act on that, and cannot act on "invalid" — and
         * telling them the names match would be wrong for either of the two
         * above, which is why splitting beats re-wording.
         */
        | "guardian_name_matches_diver"
        /**
         * **The seat is held over who the diver is** (H-13), so nobody may
         * attest a release onto it yet.
         *
         * A staff-attested paper record is the strongest evidence in the
         * product — it says a named staffer watched this person sign, and it
         * carries the medical tick — and it lands on the *matched* person's
         * history, which is precisely the record the flag says the shop is not
         * sure about. Recorded there, it cannot be taken back by clearing a
         * flag later.
         *
         * Refused at the writer rather than left to the surfaces
         * (`dive-domain-expert` review of issue #1696). The counter only hid its
         * control because `identity` outranks `waiver` in `KIND_SEVERITY`
         * (`src/lib/today.ts`) and `blockerFixFor` offers one fix at a time —
         * re-rank that table for an unrelated reason and the control comes back
         * — and the roster's `PaperWaiverControl` never consulted the flag at
         * all, so that door was open. The fix for a diver standing there with
         * paper in hand is one tap away on both surfaces: confirm the identity,
         * then record the release.
         */
        | "identity_unconfirmed";
    };

/**
 * The `people.id` of the staff member whose name goes on a paper release, or
 * `null` when whoever is claiming to attest it is not this shop's live staff
 * right now.
 *
 * This used to be a hand-rolled `person_roles` join here — `people.id` /
 * `people.shopId` / `person_roles.role` and nothing else. That catches what it
 * was written for (a diver, or somebody demoted out of every staff role) and
 * misses the two cases `loadActiveStaffRoles` exists for: a **deleted** person,
 * because `deleteDiver` sets `people.deleted_at` and leaves every role row
 * where it is, and a **disabled** account, because `setStaffAccountStatus`
 * revokes sign-in and leaves `person_roles` entirely intact — a suspended
 * employee keeps every role row they had. Both wrote a real, immutable
 * `waiver_records` row stamped `recorded_by_person_id`.
 *
 * That row is a signed medical and liability release, and the stamp is the
 * shop's answer to "who watched this diver sign?". A release attributed to
 * somebody the shop had already removed is a document that may have to stand up
 * outside the company, so the gate belongs in the writer rather than only in
 * the two server actions above it.
 *
 * `src/db/authz.ts` is the one place the rule lives; `loadActiveStaffRoles`
 * takes a `DbExecutor`, so it composes inside this transaction unchanged and
 * "who counts as live staff" widens once for the role gates and this writer
 * together. Same shape as `activeStaffRecorderId` in `src/db/manifests.ts`.
 */
export async function activeStaffAttestorId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  // `loadActiveStaffRoles` has already proven the person is this shop's, alive,
  // and holds an active account; `isStaff` is the same `STAFF_ROLES` membership
  // the old join expressed as an `inArray`.
  return roles && isStaff(roles) ? personId : null;
}

/** The diver a paper release will be filed for, resolved from either subject. */
type WaiverSigner = {
  ok: true;
  /** Null for a person-scoped record — there is no seat to stamp on it. */
  bookingId: string | null;
  personId: string;
  fullName: string;
  /** For the guardian rule (`src/lib/guardian.ts`); null when the shop never asked. */
  dateOfBirth: string | null;
};

async function bookingSigner(
  tx: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<WaiverSigner | Extract<InPersonWaiverOutcome, { ok: false }>> {
  const [booking] = await tx
    .select({
      id: bookings.id,
      personId: bookings.personId,
      fullName: people.fullName,
      dateOfBirth: people.dateOfBirth,
      tripStatus: trips.status,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!booking) return { ok: false, reason: "booking_not_found" };
  if (booking.tripStatus !== "scheduled") return { ok: false, reason: "booking_unavailable" };
  // A seat still held over whose seat it is cannot take an attestation about
  // the person in it — see `identity_unconfirmed` on `InPersonWaiverOutcome`.
  // `personSigner` below has no such check and needs none: there is no seat, so
  // there is no guess, and the release lands on the diver the caller named.
  if (booking.identityUnconfirmedAt) return { ok: false, reason: "identity_unconfirmed" };
  return {
    ok: true,
    bookingId: booking.id,
    personId: booking.personId,
    fullName: booking.fullName,
    dateOfBirth: booking.dateOfBirth,
  };
}

/**
 * The diver themselves, with no seat in sight.
 *
 * Deliberately does *not* require a `diver` role row: a shop hands a release to
 * whoever is about to get in the water, and the record is evidence of that act
 * rather than a claim about how the person is filed. It does require a live
 * record of this shop's — removed or erased people cannot be attested for, the
 * same rule `activeStaffAttestorId` applies to the staffer signing it off.
 */
async function personSigner(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<WaiverSigner | Extract<InPersonWaiverOutcome, { ok: false }>> {
  const [person] = await tx
    .select({ id: people.id, fullName: people.fullName, dateOfBirth: people.dateOfBirth })
    .from(people)
    .where(
      and(
        eq(people.id, personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!person) return { ok: false, reason: "person_not_found" };
  return {
    ok: true,
    bookingId: null,
    personId: person.id,
    fullName: person.fullName,
    dateOfBirth: person.dateOfBirth,
  };
}

/**
 * The record that makes filing another one pointless, or null when there is
 * none — the idempotency check, and the one place the two subjects differ.
 *
 * A booking asks "does this seat already have an answer?", because that is the
 * question the roster and the counter are looking at. A person asks "does this
 * diver still hold one?" — a lapsed signature is exactly what a shop standing
 * there with a fresh sheet of paper is replacing, so it must not read as done.
 */
async function standingWaiverRecord(
  tx: DbExecutor,
  input: {
    shopId: string;
    bookingId: string | null;
    personId: string;
    templateGeneration: number;
    /** For the guardian rule: a minor's solo record is not "already done" (ADR 20260907-guardian-co-signature). */
    signer: GuardianSigner;
    now: Date;
  },
) {
  if (input.bookingId) {
    const current = await tx
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.bookingId, input.bookingId), isNull(waiverRecords.supersededAt)));
    return current.find(
      (record) =>
        (record.status === "completed" || record.status === "medical_review") &&
        !guardianSignatureMissing(record, input.signer),
    );
  }
  const held = await tx
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.personId),
        isNull(waiverRecords.supersededAt),
      ),
    );
  return held.find(
    (record) =>
      isUnresolvedMedicalHold(record) ||
      (isCompletedWaiverCurrent(record, input.templateGeneration, input.now) &&
        !guardianSignatureMissing(record, input.signer)),
  );
}

/**
 * Who a paper release is being recorded for.
 *
 * A signature is a fact about a **person and a shop** — one current record
 * clears every booking the diver holds here (`effectiveWaiverForBooking`) — so
 * a seat is context, not a requirement. Both shapes write the same record;
 * `bookingId` only says where the shop was standing when they filed it.
 *
 * - `{ bookingId }` — the roster and the check-in queue, where the staffer is
 *   already looking at one departure. The seat is stamped on the record, and
 *   the booking's own live pending link is retired.
 * - `{ personId }` — the diver's record, where the conversation is about the
 *   diver: they phoned ahead, or handed the release over months before they
 *   book anything. `bookingId` stays null, exactly as it does for an imported
 *   record (ADR 20260811-person-scoped-paper-waivers).
 */
export type InPersonWaiverSubject = { bookingId: string } | { personId: string };

/**
 * A staff member records that a diver signed the release on paper — a copy on
 * the boat or handed over on shore — for a diver the app never sees sign. The
 * result is the same immutable completed record a diver self-service completion
 * produces (ADR 20260718), snapshotting the current template, but marked
 * `in_person_attested` and stamped with the accountable staff member. Because
 * the record is person-scoped it carries forward like any other signature.
 *
 * The medical block is load-bearing and cannot be conjured from thin air: this
 * path records a clean release only, so the caller must pass an explicit
 * `medicalAttested` — staff affirming they reviewed the paper medical form and
 * no answer needs physician sign-off. Without it the record is refused, and a
 * flagged medical must go through the diver-facing link, which captures the
 * questionnaire and routes to review. The actor must be this shop's live staff
 * either way; a booking subject must additionally be a live seat on a scheduled
 * trip, the same guard `issueWaiverRequest` applies.
 *
 * Idempotent, and the two subjects mean subtly different things by it. A
 * booking already signed or in medical review keeps its existing record rather
 * than stacking a second one. A *person* is only "already done" if what they
 * hold still stands — a current clean signature or an unresolved medical hold —
 * because a lapsed release is precisely what the shop is standing there with a
 * fresh sheet of paper to replace.
 */
export async function recordInPersonWaiver(
  db: AppDb,
  input: {
    shopId: string;
    subject: InPersonWaiverSubject;
    recordedByPersonId: string;
    medicalAttested: boolean;
    /**
     * Who countersigned the paper for a minor (ADR
     * 20260907-guardian-co-signature): the staffer attests to the guardian's
     * signature the way they attest to the diver's, so the evidence is the
     * same `in_person_attested` shape. Required when the diver is a minor on
     * the signing day; ignored for an adult.
     */
    guardian?: {
      name: string;
      relationship: string;
      /**
       * The staffer's explicit assertion that the co-signer and the diver
       * genuinely share a name and that they watched both of them sign (issue
       * #1573). Honoured only when the names do actually match — see the
       * refusal below — and never reachable from the online path, whose
       * `GuardianInput` has no such field.
       *
       * A request built by hand can set this without ever seeing the
       * checkbox, and that is contained rather than prevented: the caller is
       * already live staff of this shop attesting that a release was signed
       * on paper at all, the flag changes nothing unless the two names match,
       * and both the assertion and the staffer who made it are written onto
       * the record (`guardian_signature_method`, `recorded_by_person_id`)
       * inside the integrity seal.
       */
      namesakeAttested?: boolean;
    };
    now?: Date;
  },
): Promise<InPersonWaiverOutcome> {
  const now = input.now ?? nowDate();
  if (!input.medicalAttested) return { ok: false, reason: "medical_attestation_required" };
  const bookingSubject = "bookingId" in input.subject ? input.subject.bookingId : null;
  return db.transaction(async (tx): Promise<InPersonWaiverOutcome> => {
    const attestedBy = await activeStaffAttestorId(tx, input.shopId, input.recordedByPersonId);
    if (!attestedBy) return { ok: false, reason: "staff_not_found" };

    const signer = bookingSubject
      ? await bookingSigner(tx, input.shopId, bookingSubject)
      : await personSigner(tx, input.shopId, (input.subject as { personId: string }).personId);
    if (!signer.ok) return signer;

    const timezone = await shopTimezone(tx, input.shopId);
    const guardianSigner: GuardianSigner = { dateOfBirth: signer.dateOfBirth, timezone };
    const minor = guardianSignatureRequired(signer.dateOfBirth, signingDate(now, timezone));
    // Refused before anything is read or written, like the medical attestation
    // above: a paper release a minor signed alone is not a release the shop can
    // record as complete, and the crew's roster would say so the moment it was.
    let guardian: ReturnType<typeof inPersonAttestationProvider.capture> = null;
    let guardianRelationship: GuardianRelationship | null = null;
    if (minor) {
      if (!input.guardian) return { ok: false, reason: "guardian_required" };
      guardian = inPersonAttestationProvider.capture({
        signerName: input.guardian.name,
        agreed: true,
        signedAt: now,
      });
      if (!guardian || !isGuardianRelationship(input.guardian.relationship)) {
        return { ok: false, reason: "guardian_invalid" };
      }
      // Separated from the two above on purpose. Those mean the request did not
      // come from the form; this one is what the form produces for a family who
      // share a legal name, and it is the last door before somebody gives up or
      // writes something untrue on a liability release (issue 1539).
      //
      // **The refusal is still the default** (issue #1573, owner decision
      // 2026-09-10). It stops a minor signing as their own guardian, which is
      // the whole point of a second signer. What moves is that the *paper*
      // path now has one way past it: the staffer ticks a confirmation saying
      // the two really do share a name on their IDs and that they watched both
      // of them sign, and the co-signature is re-captured under
      // `namesakeAttestationProvider` so the assertion is on the record rather
      // than lost into an ordinary attestation. Without that tick the family
      // meets the same refusal they met before.
      //
      // The online path does not move and must not: there the shop has no
      // evidence a second person exists at all. See `guardianEvidence` above.
      if (personNamesMatch(guardian.signerName, signer.fullName)) {
        if (input.guardian.namesakeAttested !== true) {
          return { ok: false, reason: "guardian_name_matches_diver" };
        }
        guardian = namesakeAttestationProvider.capture({
          signerName: input.guardian.name,
          agreed: true,
          signedAt: now,
        });
        if (!guardian) return { ok: false, reason: "guardian_invalid" };
      }
      // A tick on a form whose two names differ asserts nothing, so it records
      // nothing: the assertion is only meaningful for the case it names, and a
      // flag silently honoured anywhere else would turn it into a habit.
      guardianRelationship = input.guardian.relationship;
    }

    const [template] = await tx
      .select()
      .from(waiverTemplates)
      .where(and(eq(waiverTemplates.shopId, input.shopId), isNull(waiverTemplates.deletedAt)))
      .orderBy(desc(waiverTemplates.createdAt))
      .limit(1);
    if (!template) return { ok: false, reason: "template_not_found" };

    const standing = await standingWaiverRecord(tx, {
      shopId: input.shopId,
      bookingId: signer.bookingId,
      personId: signer.personId,
      templateGeneration: template.materialGeneration,
      signer: guardianSigner,
      now,
    });
    if (standing) return { ok: true, recordId: standing.id, alreadySigned: true };
    const evidence = inPersonAttestationProvider.capture({
      signerName: signer.fullName,
      agreed: true,
      signedAt: now,
    });
    if (!evidence) return { ok: false, reason: "invalid_signature" };

    // Retire this booking's live pending link so its bearer token can never
    // complete a second record after the shop has recorded the paper copy.
    // Person-scoped records leave other bookings' links alone: those are a
    // different seat's paperwork, and a diver part-way through signing one
    // online should not find it dead.
    if (signer.bookingId) {
      await tx
        .update(waiverRecords)
        .set({ supersededAt: now, tokenSealed: null })
        .where(
          and(
            eq(waiverRecords.bookingId, signer.bookingId),
            eq(waiverRecords.status, "pending"),
            isNull(waiverRecords.supersededAt),
          ),
        );
    }

    const [record] = await tx
      .insert(waiverRecords)
      .values({
        shopId: input.shopId,
        bookingId: signer.bookingId,
        personId: signer.personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateGeneration: template.materialGeneration,
        templateBody: template.body,
        status: "completed",
        // No link is ever handed out for a paper record; a random unusable hash
        // keeps the unique token column satisfied without granting bearer access.
        tokenHash: hashWaiverToken(createWaiverToken()),
        expiresAt: now,
        signedName: evidence.signerName,
        signatureMethod: evidence.method,
        recordedByPersonId: attestedBy,
        consentedAt: evidence.consentedAt,
        signedAt: evidence.signedAt,
        completedAt: now,
        ...(guardian && guardianRelationship
          ? {
              guardianName: guardian.signerName,
              guardianRelationship,
              // No address on a paper form: the staffer names who signed,
              // and reaching them is the diver's own contact's job.
              guardianEmail: null,
              guardianSignatureMethod: guardian.method,
              guardianConsentedAt: guardian.consentedAt,
              guardianSignedAt: guardian.signedAt,
            }
          : {}),
      })
      .returning();
    if (!record) throw new Error("recordInPersonWaiver: insert returned no row");
    await tx
      .update(waiverRecords)
      .set({ integrityHash: computeWaiverIntegrityHash(record), integrityVersion: 1 })
      .where(eq(waiverRecords.id, record.id));
    return { ok: true, recordId: record.id, alreadySigned: false };
  });
}
