/**
 * Diver erasure — the destructive counterpart to `deleteDiver`'s reversible
 * removal (ADR 20260802-diver-data-erasure).
 *
 * Removal (`src/db/divers.ts`) sets `people.deleted_at` and nothing else: the
 * name, email, date of birth, emergency contact and every signed medical answer
 * stay on file forever, which is right for archive semantics
 * (ADR 20260719-crud-archive-semantics) and wrong for a diver who asks to be
 * forgotten. This module is the other operation: **anonymize and keep** —
 * destroy the identity and the medical content, preserve the evidence skeleton
 * of every signed release (timestamps, template snapshot, trip linkage, seal)
 * so the shop can still show *that* a release was signed against *which* text
 * on *what day*, and re-seal those releases under integrity version 2 so an
 * erased record reads as erased rather than as tampered.
 *
 * Three properties this file exists to hold:
 *
 *   1. **One way.** There is no un-erase. `people.anonymized_at` is stamped
 *      alongside `deleted_at`, and the `people_anonymized_stays_removed` check
 *      constraint makes an erased row impossible to restore even by a caller
 *      that forgets to look (`restoreDiver` also refuses explicitly).
 *   2. **Owner only, and never yourself.** The gate is re-read live from the
 *      database here, not trusted from the caller, and a staff member is
 *      refused outright: their attribution on activity, roll call, orders and
 *      recorded waivers is operational evidence about the *shop*, and their
 *      login is not a diver record to erase.
 *   3. **Blobs go through the existing ledger.** Card photographs, recap
 *      photos and imported waiver documents have their URL column nulled
 *      locally and a `media_deletion_attempts` row queued
 *      (ADR 20260723-media-validation-and-deletion), so the object itself is
 *      retired by the same durable retry every other blob deletion uses rather
 *      than by a second, parallel mechanism invented here.
 *   4. **The processor is erased too, and what cannot be is recorded.** The
 *      Stripe customer objects the diver's orders point at are deleted through
 *      `DELETE /v1/customers` on the shop's connected account; the name/email
 *      snapshot Stripe keeps on each finalized invoice has no API behind it and
 *      is recorded as an obligation the shop discharges through Stripe's own
 *      data-deletion request (`./processor-erasure`,
 *      ADR 20260803-processor-erasure-obligations). Both go through one ledger,
 *      so an erasure that is not finished at the processor says so out loud.
 *
 *      The Stripe call runs **after** the transaction below commits and can
 *      never fail it. An outage or a revoked Connect token leaves a visible,
 *      retryable `owed` row — it does not undo an erasure a diver asked for.
 *
 * The scrub is one transaction. A partial erasure — identity gone from
 * `people` but medical answers still sitting in `waiver_records` — is the worst
 * outcome available, so it either all lands or none of it does.
 */

import { and, eq, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { ANONYMIZED_PERSON_NAME, REDACTED_TEXT, redactedUniqueValue } from "@/lib/anonymization";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type CustomerProvider, customerProviderFromEnvironment } from "@/lib/payments/customers";
import {
  computeWaiverIntegrityHash,
  WAIVER_INTEGRITY_VERSION_ERASED,
} from "@/lib/waiver-integrity";
import { createWaiverToken, hashWaiverToken } from "@/lib/waiver-tokens";
import { canPersonErasePersonalData } from "./authz";
import type { AppDb, AppTransaction } from "./client";
import { queueMediaDeletion } from "./media-deletions";
import { revokeShelfTokens } from "./person-shelf-tokens";
import { attemptProcessorErasures, recordProcessorErasureObligations } from "./processor-erasure";
import type { ProcessorErasureObligation } from "./schema";
import {
  accountSecurity,
  accountSessions,
  accountTokens,
  activityEvents,
  authProviderAccounts,
  authVerifications,
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingGifts,
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  buddyTeamEvents,
  calendarFeeds,
  certifications,
  courseInquiries,
  dayCloseouts,
  diveSupportNeeds,
  formDrafts,
  gearReservations,
  importedPaymentHistory,
  inboundMessages,
  internalNotes,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  nitroxCertifications,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  orderLineItems,
  orders,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  priorGearAssignments,
  priorVisits,
  recapPhotos,
  recapPulses,
  rentalFitProfiles,
  rollCallCrewEvents,
  rollCallEvents,
  specialtyCertifications,
  staffCredentials,
  staffReplies,
  tips,
  tripLastMinutePromoRecipients,
  tripReviews,
  tripWaitlistEntries,
  userAccounts,
  waiverDeliveries,
  waiverRecords,
} from "./schema";

export type AnonymizeDiverRefusal =
  /** No live person with this id at this shop. */
  | "not_found"
  /** The actor is not a current, active owner of this shop. */
  | "not_authorized"
  /** The actor aimed the erasure at their own record. */
  | "self"
  /**
   * The target holds a staff role. Their name on an activity event, a roll
   * call, an order, or a staff-attested waiver is the shop's own operational
   * record of who did what, and erasing it would blank an accountability trail
   * that is not the diver's data to begin with. Staff offboarding is a
   * different problem with a different answer.
   */
  | "staff_member";

export type AnonymizeDiverResult =
  | {
      ok: true;
      /** True when the record was already erased — the call is a no-op replay. */
      alreadyAnonymized: boolean;
      /** Blob objects handed to the media-deletion ledger by this call. */
      queuedMediaDeletions: number;
      /** Stripe customer objects this call deleted (or found already deleted). */
      dischargedProcessorErasures: number;
      /**
       * Processor-side records still owed after this call: an invoice snapshot
       * only Stripe's data-deletion request can clear, or a customer delete that
       * failed and is waiting on a retry. Non-zero means the erasure is
       * genuinely incomplete at the processor and the reports panel says so.
       */
      owedProcessorErasures: number;
    }
  | { ok: false; reason: AnonymizeDiverRefusal };

/** Every column `listDiverSummaries` already refuses to ship to the browser, plus the rest. */
const ERASED_PERSON_COLUMNS = {
  fullName: ANONYMIZED_PERSON_NAME,
  // Must be null, not a sentinel: `people_shop_email_unique` is a partial
  // unique index on lower(email) over the live rows, and while an erased
  // person is always soft-deleted (so outside that index), a shared sentinel
  // address would still be a standing collision hazard for any future change
  // to that predicate — and an address nobody owns is not an erasure.
  email: null,
  phone: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  dateOfBirth: null,
  diveInsurance: null,
  locale: null,
  courtesyEmailOptOutAt: null,
  // A statement this person made about their own diving, and the erasure takes
  // it with the certifications it stands in for — leaving it would keep saying
  // something about a body whose record is supposed to be gone.
  noCertificationDeclaredAt: null,
  // Its eraser goes with it, both halves. The clear is only meaningful as a
  // correction *of* the stamp above, so keeping it would leave this record
  // asserting that a named staff member corrected a statement that is no longer
  // there — an assertion about a body whose record is supposed to be gone.
  noCertificationClearedAt: null,
  noCertificationClearedByPersonId: null,
  // A published name is a personal name, and it is the one that was on a page
  // the whole internet could read. Unreachable today — `anonymizeDiver` refuses
  // anybody holding a staff role, and the only way to lose every staff role is
  // `removeStaffMember`, which clears both of these in its own transaction — so
  // this is two guards deep rather than a live gap. It costs nothing here and
  // stops the erasure set depending on that refusal never being relaxed.
  //
  // Both halves, and in this order for the check constraint's sake: the pair
  // must be null together, and a `set` writing one without the other would be
  // refused by the database.
  crewPublicConsentAt: null,
  crewPublicName: null,
} as const;

/**
 * A name with fewer letters/digits than this is never used as a search handle
 * against the shop's activity log.
 *
 * `personSchema.fullName` requires only two characters, and the sweep below
 * matches the stored name against every `activity_events.message` in the shop.
 * At two characters the name is simultaneously the weakest identifier on the
 * record and the most indiscriminate matcher available — erasing a diver named
 * `Al` must not be able to reach into unrelated operational history, and a
 * single-character name would match a bare `x` in "3 x tanks". Below the
 * threshold the booking-scoped and actor-scoped sweeps still run; only the
 * name-scoped one is skipped, which is a stated residual in the ADR rather
 * than a licence to redact the log.
 */
const MIN_NAME_MATCH_CHARS = 3;

/** Letters, digits and `_` — what Postgres's `\y` treats as inside a word. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** POSIX ARE metacharacters, escaped so a name can never act as a pattern. */
const REGEX_METACHARACTERS = /[\\^$.|?*+()[\]{}]/g;

/**
 * A **word-boundary**, case-insensitive match of the stored name against an
 * activity message, or `undefined` when the name is too short to be used as a
 * handle at all (see {@link MIN_NAME_MATCH_CHARS}).
 *
 * Deliberately not a substring (`ILIKE '%name%'`) match: a substring pattern
 * built from a two-character name — `Al`, `An`, `Ed` — matches inside `Dana`,
 * `manifest`, `changed`, `credited`, and would irreversibly replace most of a
 * shop's operational history with `[redacted]` inside the erasure transaction.
 * `\y` anchors both ends of the name to a word boundary, so `An` matches the
 * word `An` and nothing else. The anchors are applied only where the name's
 * own first/last character is a word character — `\y` between two non-word
 * characters is never a boundary, so anchoring a name like `Ana.` at the
 * trailing `.` would match nothing at all.
 */
function activityMessageNameMatch(fullName: string) {
  const trimmed = fullName.trim();
  const wordChars = [...trimmed].filter((char) => WORD_CHAR.test(char)).length;
  if (wordChars < MIN_NAME_MATCH_CHARS) return undefined;
  const escaped = trimmed.replace(REGEX_METACHARACTERS, "\\$&");
  const first = trimmed[0] ?? "";
  const last = trimmed[trimmed.length - 1] ?? "";
  const pattern = `${WORD_CHAR.test(first) ? "\\y" : ""}${escaped}${WORD_CHAR.test(last) ? "\\y" : ""}`;
  return sql`${activityEvents.message} ~* ${pattern}`;
}

/**
 * The same word-boundary name pattern as {@link activityMessageNameMatch}, but
 * returned as the bare pattern rather than a predicate over one column — the
 * buddy sweep applies it per *array element* twice (once to find the rows, once
 * to rewrite them), so it cannot be handed a column-bound comparison, and the
 * internal-notes sweep needs it against a third column.
 *
 * `undefined` for a name too short to anchor safely, exactly as above: the
 * two-character-name blast radius is the same hazard on either table.
 */
function buddyMemberNameMatch(fullName: string): string | undefined {
  const trimmed = fullName.trim();
  const wordChars = [...trimmed].filter((char) => WORD_CHAR.test(char)).length;
  if (wordChars < MIN_NAME_MATCH_CHARS) return undefined;
  const escaped = trimmed.replace(REGEX_METACHARACTERS, "\\$&");
  const first = trimmed[0] ?? "";
  const last = trimmed[trimmed.length - 1] ?? "";
  return `${WORD_CHAR.test(first) ? "\\y" : ""}${escaped}${WORD_CHAR.test(last) ? "\\y" : ""}`;
}

/**
 * Record that a predicate which cannot be tied to a `person_id` matched rows.
 *
 * Several sweeps below are matched on something other than a foreign key — a
 * name, a shared household phone number, or an address a soft-deleted duplicate
 * person can legitimately share with a live one. The count is deliberately not
 * written here: it read "four" while the file had twelve of them, because every
 * change that added one updated its own block and not this paragraph. The call
 * sites are the register; this docblock is the reason they exist.
 *
 * Each can therefore reach a third party's row in the same shop. None of them is
 * cross-tenant and all of them are owner-gated, so this is about visibility,
 * not containment: an owner who erases a diver and later finds a bystander's
 * lead blanked deserves a line saying it happened and how much it touched.
 * Ids and counts only — never the name, address or number that was matched
 * (AGENTS.md hard rule on PII in logs).
 */
function logFuzzyMatch(
  ctx: Pick<ScrubContext, "shopId" | "personId">,
  predicate: string,
  matched: number,
): void {
  if (matched === 0) return;
  log("anonymize.fuzzy_match", "info", {
    shopId: ctx.shopId,
    personId: ctx.personId,
    predicate,
    matched,
  });
}

/**
 * Erase one diver. Idempotent: a second call on an already-erased record
 * reports success without touching anything, so a double-submitted form or a
 * retried job can never half-apply a second pass.
 *
 * Two phases, in this order and never the other:
 *
 *   1. **One transaction** scrubs every local table and writes the processor
 *      obligations. All of it lands or none of it does.
 *   2. **After that transaction commits**, the Stripe customer deletes are
 *      attempted. Nothing in phase 2 can fail phase 1 — a failed delete leaves
 *      an `owed` row for the retry, and the erasure the diver asked for stands
 *      either way.
 *
 * `customerProvider` is injectable for tests; it defaults to the environment's,
 * which is the disabled provider when no Stripe key is configured (and that
 * records "stripe not configured" on the row rather than pretending success).
 */
export async function anonymizeDiver(
  db: AppDb,
  input: { shopId: string; personId: string; actorPersonId: string },
  options: { customerProvider?: CustomerProvider } = {},
): Promise<AnonymizeDiverResult> {
  const now = nowDate();
  const outcome = await db.transaction(async (tx) => {
    const [person] = await tx
      .select()
      .from(people)
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!person) return { ok: false, reason: "not_found" } as const;
    // Authorization is answered before anything else about the record is, so a
    // caller with no standing here learns nothing from the reply — not even
    // whether this person has already been erased.
    if (!(await canPersonErasePersonalData(tx, input.shopId, input.actorPersonId))) {
      return { ok: false, reason: "not_authorized" } as const;
    }
    if (input.actorPersonId === input.personId) return { ok: false, reason: "self" } as const;
    if (person.anonymizedAt) {
      return {
        ok: true,
        alreadyAnonymized: true,
        queuedMediaDeletions: 0,
        raisedProcessorErasures: [] as ProcessorErasureObligation[],
      } as const;
    }

    const roleRows = await tx
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, input.personId));
    if (roleRows.some((row) => STAFF_ROLES.includes(row.role))) {
      return { ok: false, reason: "staff_member" } as const;
    }

    const result = await scrub(tx, {
      shopId: input.shopId,
      personId: input.personId,
      actorPersonId: input.actorPersonId,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      deletedAt: person.deletedAt ?? now,
      now,
    });

    return { ok: true, alreadyAnonymized: false, ...result } as const;
  });

  if (!outcome.ok) return outcome;

  // Phase 2. The transaction above has committed; the diver is erased locally
  // whatever happens from here. Every failure is recorded on its own row and
  // reported as "still owed" — none of it throws, because there is nothing left
  // to roll back and a throw would only make a completed erasure look failed.
  const { discharged, stillOwed } = await attemptProcessorErasures(
    db,
    outcome.raisedProcessorErasures,
    options.customerProvider ?? customerProviderFromEnvironment(),
  );
  if (stillOwed > 0) {
    log("anonymize.processor_erasure_owed", "warn", {
      shopId: input.shopId,
      personId: input.personId,
      owed: stillOwed,
    });
  }
  return {
    ok: true,
    alreadyAnonymized: outcome.alreadyAnonymized,
    queuedMediaDeletions: outcome.queuedMediaDeletions,
    dischargedProcessorErasures: discharged,
    owedProcessorErasures: stillOwed,
  };
}

type ScrubContext = {
  shopId: string;
  personId: string;
  actorPersonId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  deletedAt: Date;
  now: Date;
};

type ScrubResult = {
  queuedMediaDeletions: number;
  /** The obligation rows this scrub created — the caller attempts them post-commit. */
  raisedProcessorErasures: ProcessorErasureObligation[];
};

/**
 * Every `people` row whose `merged_into_person_id` chain resolves to this one.
 *
 * A merge into a record that was itself later merged makes this a chain rather
 * than a single hop, so it is walked breadth-first. The walk is **bounded** two
 * ways: a `seen` set, so a cycle cannot spin (the schema's
 * `people_merged_into_not_self` check rules out the one-hop case, and nothing
 * rules out a longer loop), and a hard step ceiling, so a pathological graph
 * cannot hold the erasure transaction open. Both are belt and braces on a chain
 * that is one hop deep in practice.
 */
const MERGE_CHAIN_MAX_STEPS = 64;

async function mergedIntoChain(
  tx: AppTransaction,
  shopId: string,
  personId: string,
): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>([personId]);
  let frontier = [personId];
  for (let step = 0; step < MERGE_CHAIN_MAX_STEPS && frontier.length > 0; step += 1) {
    const rows = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), inArray(people.mergedIntoPersonId, frontier)));
    frontier = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      found.push(row.id);
      frontier.push(row.id);
    }
  }
  return found;
}

async function scrub(tx: AppTransaction, ctx: ScrubContext): Promise<ScrubResult> {
  const { shopId, personId, now } = ctx;

  // **Read before the redaction, because the redaction is what removes it.**
  // A gift names its giver by address and by nothing else — the giver is a
  // third party with no `people` row of their own — so the only handle an
  // erasure has on "gifts this person bought" is the address they are being
  // erased from (security review of the gift slice, finding 5).
  const [erasedIdentity] = await tx
    .select({ email: people.email })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.id, personId)))
    .limit(1);

  const bookingRows = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)));
  const bookingIds = bookingRows.map((row) => row.id);
  const owned = bookingIds.length > 0;

  let queued = 0;
  const retire = async (
    kind: "recap_photo" | "waiver_document" | "payment_receipt",
    url: string | null,
  ) => {
    if (!url) return;
    if (await queueMediaDeletion(tx, { shopId, kind, url })) queued += 1;
  };

  // --- people --------------------------------------------------------------
  await tx
    .update(people)
    .set({
      ...ERASED_PERSON_COLUMNS,
      deletedAt: ctx.deletedAt,
      anonymizedAt: now,
      anonymizedByPersonId: ctx.actorPersonId,
    })
    .where(eq(people.id, personId));

  // Every record that was merged *into* this one, however deep the chain.
  //
  // A merge (`./diver-merge`) soft-deletes the source, points it at the
  // survivor, and leaves every identifying column on it — and contact fields
  // only move onto the survivor where the survivor's own field was null, so the
  // source's distinct email and phone survive on that shell **only**. Nothing
  // could then reach it: the diver record page redirects a merged id to the
  // survivor before rendering, and that page is the only surface carrying the
  // erase form. So an erasure of the survivor used to leave the real name, the
  // old address and the phone number on file permanently, with no way to erase
  // them by hand (issue #1014). Following the pointer is what makes ADR
  // 20260802-diver-data-erasure true for a merged diver.
  //
  // The shells keep existing — they are soft-deleted rows several history
  // tables still reference, and deleting one is not an option
  // (ADR 20260820-every-delete-is-soft). What goes is the identity, not the row,
  // so the merge audit trail (`merged_into_person_id`, `merged_at`,
  // `merged_by_person_id`) is deliberately left in place.
  for (const shellId of await mergedIntoChain(tx, shopId, personId)) {
    await tx
      .update(people)
      .set({
        ...ERASED_PERSON_COLUMNS,
        anonymizedAt: now,
        anonymizedByPersonId: ctx.actorPersonId,
      })
      .where(eq(people.id, shellId));
  }

  // The person is no longer a diver of this shop; nothing downstream may treat
  // an erased record as an active one of any kind.
  await tx.delete(personRoles).where(eq(personRoles.personId, personId));

  // Credentials belong to the staff member's operational record, but their
  // names and identifiers are still personal data when the target was later
  // entered as a diver. Retire those rows without leaving a credential tied
  // to an erased identity.
  await tx
    .update(staffCredentials)
    .set({
      name: REDACTED_TEXT,
      issuingBody: null,
      identifier: null,
      reviewNote: null,
      deletedAt: now,
      deletedByPersonId: ctx.actorPersonId,
      updatedAt: now,
    })
    .where(
      and(
        eq(staffCredentials.shopId, shopId),
        eq(staffCredentials.personId, personId),
        isNull(staffCredentials.deletedAt),
      ),
    );

  // --- waiver records: strip, retire the link, re-seal under version 2 ------
  const waiverRows = await tx
    .select()
    .from(waiverRecords)
    .where(and(eq(waiverRecords.shopId, shopId), eq(waiverRecords.personId, personId)));

  for (const record of waiverRows) {
    await retire("waiver_document", record.importSourceDocumentUrl);
    await retire("waiver_document", record.importSourceMedicalDocumentUrl);
    // A physician's evaluation is the diver's own medical document, and goes
    // with the rest of them. The *fact* of the clearance survives — like the
    // certification sighting below, and for the same reason: it is the shop's
    // record of an act it performed, not a document about this person.
    await retire("waiver_document", record.medicalClearanceDocumentUrl);

    const [stripped] = await tx
      .update(waiverRecords)
      .set({
        draftSignerName: null,
        draftMedicalAnswers: null,
        draftAcknowledged: false,
        draftGuardian: null,
        signedName: null,
        medicalAnswers: null,
        // The guardian's name and email are a third party's personal data
        // held only because they are on this diver's release, and they go
        // with the diver's own. The fact of the co-signature — relationship,
        // provider, when — survives, exactly as `signed_at` does, and is what
        // the v2 seal covers (ADR 20260907-guardian-co-signature).
        guardianName: null,
        guardianEmail: null,
        // The provider's own words for a bounce quote the address they failed
        // to reach, which is the reason `notification_deliveries.provider_detail`
        // is cleared further down. This column is the same text on the waiver's
        // own row, and the per-channel table below carries a copy of it.
        deliveryError: null,
        importedFromLabel: null,
        importSourceDocumentUrl: null,
        importSourceMedicalDocumentUrl: null,
        medicalClearanceDocumentUrl: null,
        // The URL *is* the capability. A live pending link would let its bearer
        // complete a fresh, un-erased record against this same person after the
        // erasure, so the hash is rotated to a value no issued token maps to,
        // the expiry is pulled back to now, and any still-live record is marked
        // superseded.
        tokenHash: hashWaiverToken(createWaiverToken()),
        // ...and the openable copy goes with it, so the erased record cannot
        // hand its link back out through the reuse path either.
        tokenSealed: null,
        expiresAt: now,
        startedAt: null,
        supersededAt: record.supersededAt ?? (record.status === "pending" ? now : null),
        anonymizedAt: now,
        anonymizedByPersonId: ctx.actorPersonId,
      })
      .where(eq(waiverRecords.id, record.id))
      .returning();
    if (!stripped) throw new Error("anonymizeDiver: waiver strip returned no row");

    // Only a sealed record is re-sealed. A record that was never sealed (a
    // pending link, or a legacy row) stays unsealed: minting a seal here would
    // manufacture assurance the original signing never had.
    if (record.integrityHash && record.integrityVersion) {
      await tx
        .update(waiverRecords)
        .set({
          integrityHash: computeWaiverIntegrityHash(stripped, WAIVER_INTEGRITY_VERSION_ERASED),
          integrityVersion: WAIVER_INTEGRITY_VERSION_ERASED,
        })
        .where(eq(waiverRecords.id, stripped.id));
    }
  }

  // The per-channel mechanics behind the column above (ADR
  // 20260820-waiver-delivery-is-per-channel): one current row per channel, each
  // carrying the provider's own bounce text. Swept by waiver record rather than
  // by booking — a release is attached to a person, and a diver with no seat
  // still has one.
  const waiverRecordIds = waiverRows.map((record) => record.id);
  if (waiverRecordIds.length > 0) {
    await tx
      .update(waiverDeliveries)
      .set({ detail: null })
      .where(
        and(
          eq(waiverDeliveries.shopId, shopId),
          inArray(waiverDeliveries.waiverRecordId, waiverRecordIds),
          isNotNull(waiverDeliveries.detail),
        ),
      );
  }

  // --- certification evidence ---------------------------------------------
  // The card *sighting* survives (agency, level, status, when it was reviewed);
  // the diver's agency number does not. Cards are archived at the same time: an
  // erased diver has no future readiness to satisfy, and archiving frees the
  // number's partial unique index.
  //
  // Nothing to retire from the blob store here any more: a card never carried a
  // photograph after ADR 20260811-retire-the-digital-card dropped
  // `card_image_url`. Recap photos and waiver documents still do, below.
  const levelCards = await tx
    .select()
    .from(certifications)
    .where(and(eq(certifications.shopId, shopId), eq(certifications.personId, personId)));
  for (const card of levelCards) {
    await tx
      .update(certifications)
      .set({
        identifier: redactedUniqueValue("redacted"),
        // The diver's own claimed number is theirs too, and it is the one a
        // staffer never overwrote — so erasure has to reach it explicitly.
        declaredIdentifier: null,
        reviewNote: null,
        importedFromLabel: null,
        deletedAt: card.deletedAt ?? now,
      })
      .where(eq(certifications.id, card.id));
  }

  const specialtyCards = await tx
    .select()
    .from(specialtyCertifications)
    .where(
      and(
        eq(specialtyCertifications.shopId, shopId),
        eq(specialtyCertifications.personId, personId),
      ),
    );
  for (const card of specialtyCards) {
    await tx
      .update(specialtyCertifications)
      .set({
        identifier: redactedUniqueValue("redacted"),
        reviewNote: null,
        importedFromLabel: null,
        deletedAt: card.deletedAt ?? now,
      })
      .where(eq(specialtyCertifications.id, card.id));
  }

  const nitroxCards = await tx
    .select()
    .from(nitroxCertifications)
    .where(
      and(eq(nitroxCertifications.shopId, shopId), eq(nitroxCertifications.personId, personId)),
    );
  for (const card of nitroxCards) {
    await tx
      .update(nitroxCertifications)
      .set({
        identifier: redactedUniqueValue("redacted"),
        reviewNote: null,
        importedFromLabel: null,
        deletedAt: card.deletedAt ?? now,
      })
      .where(eq(nitroxCertifications.id, card.id));
  }

  // --- rows that are only about the person, and are not evidence -----------
  // Deleted outright rather than blanked: a rental fit is body measurement, a
  // wait-list place and a deals subscription are live intentions, and a row of
  // all-nulls preserves nothing worth keeping.
  await tx
    .delete(rentalFitProfiles)
    .where(and(eq(rentalFitProfiles.shopId, shopId), eq(rentalFitProfiles.personId, personId)));
  // Support needs go the same way and for the same reason, only more so: it is
  // the diver's own account of what their dive needs set up, it is evidence of
  // nothing, and it is the most personal thing in this list. A row of all-nulls
  // would preserve exactly nothing worth keeping.
  await tx
    .delete(diveSupportNeeds)
    .where(and(eq(diveSupportNeeds.shopId, shopId), eq(diveSupportNeeds.personId, personId)));
  await tx
    .delete(tripWaitlistEntries)
    .where(and(eq(tripWaitlistEntries.shopId, shopId), eq(tripWaitlistEntries.personId, personId)));

  const listEntries = await tx
    .select({ id: lastMinuteListEntries.id })
    .from(lastMinuteListEntries)
    .where(
      and(eq(lastMinuteListEntries.shopId, shopId), eq(lastMinuteListEntries.personId, personId)),
    );
  if (listEntries.length > 0) {
    const entryIds = listEntries.map((row) => row.id);
    await tx
      .delete(lastMinuteListUnsubscribeTokens)
      .where(inArray(lastMinuteListUnsubscribeTokens.entryId, entryIds));
    await tx.delete(lastMinuteListEntries).where(inArray(lastMinuteListEntries.id, entryIds));
  }
  await tx
    .delete(personCourtesyEmailUnsubscribeTokens)
    .where(eq(personCourtesyEmailUnsubscribeTokens.personId, personId));

  // **The last-minute deal's recipient log keeps its row and loses its
  // address.** `trip_last_minute_promo_recipients` records who was sent which
  // deal, and it stores the address it went *to* — the diver's own email, as a
  // NOT NULL column, keyed by `person_id`. Nothing here touched it, so an
  // erased diver's address survived every deal they were ever offered, and
  // `src/db/export.ts` carries that table out of the shop in the portable
  // bundle (found by the sweep issue #1607 asks for).
  //
  // Redacted rather than deleted, the shape `user_accounts.email` above takes.
  // What is left afterwards is a `person_id` pointing at a row that has itself
  // been erased and nothing else, which is exactly what `course_inquiries`
  // keeps and for the same reason: it is what makes a replayed erasure reach
  // the same rows.
  //
  // Not "the count of who was mailed would move": it would not. The number a
  // shop reads is `trip_last_minute_promos.recipient_count`, denormalized at
  // send time from the messages that actually went out, while these rows are
  // written for every *attempted* recipient — the two already disagree, and
  // deleting these would not change either (security review, 2026-09-10).
  await tx
    .update(tripLastMinutePromoRecipients)
    .set({ email: `${redactedUniqueValue("erased")}@invalid` })
    .where(
      and(
        eq(tripLastMinutePromoRecipients.shopId, shopId),
        eq(tripLastMinutePromoRecipients.personId, personId),
      ),
    );

  // Staff prose about a person is personal data end to end, and the body column
  // carries a non-blank check, so there is nothing to redact it *to*.
  await tx
    .delete(internalNotes)
    .where(and(eq(internalNotes.shopId, shopId), eq(internalNotes.personId, personId)));

  // And the notes filed under *somebody else* that name this diver in the body.
  // The delete above is keyed on `person_id` — whose note it is — which reaches
  // every note *about* the erased diver and none of the ones that merely mention
  // them: "asked to be split from Elena Marsh on the next boat" sits under a
  // different diver and survived verbatim. That was survivable while notes never
  // left the shop; `internal_notes.csv` now carries them out of it in a portable
  // bundle (ADR 20260806-export-operational-records), which is what makes it
  // worth the fuzzy handle (security review, 2026-08-06).
  //
  // Redacted rather than deleted, unlike the sweep above: this row is another
  // diver's record and the shop is entitled to keep it, so only the prose goes
  // — the same treatment, for the same reason, that `activity_events.message`
  // gets below. Word-boundary matched and refused for a name too short to anchor
  // safely, and counted separately because a name match can over-reach.
  const notePattern = buddyMemberNameMatch(ctx.fullName);
  if (notePattern) {
    const byName = await tx
      .update(internalNotes)
      .set({ body: REDACTED_TEXT })
      .where(
        and(
          eq(internalNotes.shopId, shopId),
          sql`${internalNotes.body} ~* ${notePattern}`,
          ne(internalNotes.body, REDACTED_TEXT),
        ),
      )
      .returning({ id: internalNotes.id });
    logFuzzyMatch(ctx, "internal_note_name", byName.length);
  }

  // --- standing credentials ------------------------------------------------
  // A live feed URL is a read credential; revoked rather than deleted so the
  // fact that it was revoked stays on record.
  await tx
    .update(calendarFeeds)
    .set({ revokedAt: now })
    .where(
      and(
        eq(calendarFeeds.shopId, shopId),
        eq(calendarFeeds.personId, personId),
        isNull(calendarFeeds.revokedAt),
      ),
    );

  // The diver's shelf link, on however many phones it reached. Same reasoning
  // as the feed above and the same shape — revoked, not deleted, so the record
  // says the door was closed. `verifyShelfToken` would already refuse an erased
  // person on the join, and this is the belt beside that brace: a future reader
  // querying `person_shelf_tokens` without the join must still find nothing
  // live (ADR 20260802-diver-data-erasure, H-02).
  await revokeShelfTokens(tx, { shopId, personId, now });

  // --- the diver's own login, if they ever had one -------------------------
  const [account] = await tx
    .select({ id: userAccounts.id, email: userAccounts.email })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  if (account) {
    await tx.delete(accountTokens).where(eq(accountTokens.userAccountId, account.id));
    await tx.delete(accountSecurity).where(eq(accountSecurity.userAccountId, account.id));
    // A provider login for this account, if one ever existed. Nothing writes
    // this table today — no OAuth provider is configured and no route mounts
    // better-auth's handler — so this deletes nothing, which is exactly why it
    // belongs here now rather than in the change that enables a provider: the
    // row it will one day remove carries `password`, `access_token`,
    // `refresh_token` and `id_token` (issue #1588's columns), the credential
    // material ADR 20260802-diver-data-erasure promises is destroyed, and the
    // person adding a provider will be thinking about sign-in rather than
    // erasure (issue #1594).
    await tx.delete(authProviderAccounts).where(eq(authProviderAccounts.userAccountId, account.id));
    // And better-auth's `verification` model, which is the same gap one step
    // further out: a pending row holds the address in `identifier` and a live
    // bearer token in `value`, and it reaches a person through neither a
    // `shop_id` nor a foreign key — so no structural guard can ever find it,
    // and it is deleted here by the two handles better-auth would have written
    // it under. Read before the redaction below replaces that address, which
    // is the only ordering this block has.
    await tx
      .delete(authVerifications)
      .where(
        inArray(authVerifications.identifier, [
          ...new Set([account.id, account.email, ctx.email].filter((value) => value !== null)),
        ]),
      );
    // Revoke any session issued before this instant — status alone
    // (`disabled` below) is not read by the session lookup itself, so a
    // live sign-in would otherwise keep working until it naturally expires.
    await tx.delete(accountSessions).where(eq(accountSessions.userAccountId, account.id));
    await tx
      .update(userAccounts)
      .set({
        // `email` is NOT NULL and globally unique, so it takes a unique
        // unusable value. `hashed_password` is nullable (issue #1588) and
        // still takes one too, deliberately: an explicit value that is not a
        // hash of anything says "this was erased", where a null says only
        // "never set". Nothing verifies against either, which is the point.
        email: `${redactedUniqueValue("erased")}@invalid`,
        hashedPassword: redactedUniqueValue("erased"),
        emailVerifiedAt: null,
        status: "disabled",
      })
      .where(eq(userAccounts.id, account.id));
  }

  // **Gifts this person *bought*, which their own bookings never name.**
  //
  // The block below erases the giver stamped on seats this person is *diving*;
  // this one erases the seats they *paid for* — a third party's name and
  // address on somebody else's booking, held only because this person put it
  // there. Matched on the address, case-folded, because that is the only handle
  // a giver has: they have no `people` row, so no id joins them to anything
  // (security review of the gift slice, finding 5).
  //
  // The row survives; the identity does not. The seat and its money are the
  // shop's record and are not this person's to take away.
  const erasedEmail = erasedIdentity?.email?.trim().toLowerCase();
  if (erasedEmail) {
    await tx
      .update(bookingGifts)
      .set({
        giverName: redactedUniqueValue("erased"),
        giverEmail: `${redactedUniqueValue("erased")}@invalid`,
        message: null,
      })
      .where(
        and(
          eq(bookingGifts.shopId, shopId),
          sql`lower(${bookingGifts.giverEmail}) = ${erasedEmail}`,
        ),
      );
  }

  // --- booking-scoped rows -------------------------------------------------
  if (owned) {
    // `welcomeSharedAt` is a consent stamp, not a fact about the seat: the
    // diver said this departure's crew may know it is a first trip or a long
    // return (issue #1182, D22). Two reasons it cannot outlive them. Consent
    // given by a person who has asked to be forgotten is not consent any more.
    // And the cue derives its words at read from this diver's *booking
    // history*, so a stamp left behind keeps the manifest greeting an
    // anonymized shell by name-shaped implication — "first trip with us" —
    // about somebody who is no longer there to have a first trip.
    await tx
      .update(bookings)
      .set({
        diveIntent: null,
        // The diver's own answer to "when did you last dive?" (issue #1404).
        // It is a statement a person made about themselves, and after an
        // erasure there is no person it belongs to. Its two nearest neighbours
        // on this row both cite it by name in their own docblocks as the same
        // kind of value, and both have always been cleared — leaving this one
        // behind was the asymmetry, not a decision.
        lastDivedBand: null,
        reEntryAsk: null,
        welcomeSharedAt: null,
        // The instructor's next step is prose about this named student — "book
        // your deep dive with Marcus before the card arrives" — so it goes
        // with them (issues #1196, #1205). All three columns together, or the
        // attribution check refuses the update.
        courseNextStep: null,
        courseNextStepAt: null,
        courseNextStepByPersonId: null,
        hotelPickupLocation: null,
        pickupTime: null,
      })
      .where(inArray(bookings.id, bookingIds));

    // **The giver of a gift seat is a third party on this diver's booking**
    // (ADR 20260908-one-hand, decision 6, lever W), held for exactly the reason
    // a guardian's name is held on a minor's release — because it is on this
    // person's record and for no other reason. So it goes with the rest of it:
    // the name, the address the receipt went to, the line that was written for
    // this diver, and the name the giver typed for them. The row itself stays,
    // because the seat and its money did.
    await tx
      .update(bookingGifts)
      .set({
        giverName: redactedUniqueValue("erased"),
        giverEmail: `${redactedUniqueValue("erased")}@invalid`,
        receiverName: redactedUniqueValue("erased"),
        message: null,
      })
      .where(inArray(bookingGifts.bookingId, bookingIds));

    await tx
      .update(bookingCapabilities)
      .set({ revokedAt: now, expiresAt: now })
      .where(
        and(
          inArray(bookingCapabilities.bookingId, bookingIds),
          isNull(bookingCapabilities.revokedAt),
        ),
      );

    // The roll-call note is free text a crew member typed at the rail about a
    // person who was unaccounted for (ADR
    // 20260828-a-missing-diver-gets-a-sentence), so an erasure has to take it
    // even though the row it sits on is a boarding fact that stays. Both
    // halves of the head count: this person's own bookings, and — since a crew
    // member is a person who can be erased too — the crew events about them.
    await tx
      .update(rollCallEvents)
      .set({ note: null })
      .where(
        and(
          eq(rollCallEvents.shopId, shopId),
          inArray(rollCallEvents.bookingId, bookingIds),
          isNotNull(rollCallEvents.note),
        ),
      );

    await tx
      .update(rollCallCrewEvents)
      .set({ note: null })
      .where(
        and(
          eq(rollCallCrewEvents.shopId, shopId),
          eq(rollCallCrewEvents.personId, personId),
          isNotNull(rollCallCrewEvents.note),
        ),
      );

    await tx
      .update(bookingPayments)
      .set({ note: null })
      .where(
        and(eq(bookingPayments.shopId, shopId), inArray(bookingPayments.bookingId, bookingIds)),
      );

    // The same sentence, one table over. `setBookingPayment` copies `note` onto
    // every transition it appends (`src/db/payments.ts`), so scrubbing the
    // current row and leaving the trail left the staffer's words about this
    // diver's money legible in full history. Found by the sweep below rather
    // than by anyone reading the line above it (issue #1607) — which is the
    // whole argument for having a sweep.
    await tx
      .update(bookingPaymentEvents)
      .set({ note: null })
      .where(
        and(
          eq(bookingPaymentEvents.shopId, shopId),
          inArray(bookingPaymentEvents.bookingId, bookingIds),
          isNotNull(bookingPaymentEvents.note),
        ),
      );

    // Provider bounce text quotes the address it failed to reach.
    await tx
      .update(notificationDeliveries)
      .set({ providerDetail: null, sendError: null })
      .where(
        and(
          eq(notificationDeliveries.shopId, shopId),
          inArray(notificationDeliveries.bookingId, bookingIds),
        ),
      );

    // The append-only twin of the row above. `sendNotification`
    // (src/db/notifications.ts) writes both from the same `delivery.detail` in
    // the same call, so this `send_error` carries the same quoted address —
    // scrubbing only the denormalized latest state would leave the address
    // sitting in the history table behind it. The provider's own status code
    // (`send_error_code`) is a code, not prose, and stays, exactly as it does
    // on the delivery row.
    await tx
      .update(notificationDeliveryAttempts)
      .set({ sendError: null })
      .where(
        and(
          eq(notificationDeliveryAttempts.shopId, shopId),
          inArray(notificationDeliveryAttempts.bookingId, bookingIds),
        ),
      );

    // A photograph of the diver. There is no skeleton worth keeping once the
    // image is gone, so the row goes with it.
    const photos = await tx
      .select()
      .from(recapPhotos)
      .where(and(eq(recapPhotos.shopId, shopId), inArray(recapPhotos.bookingId, bookingIds)));
    for (const photo of photos) await retire("recap_photo", photo.imageUrl);
    if (photos.length > 0) {
      await tx.delete(recapPhotos).where(
        inArray(
          recapPhotos.id,
          photos.map((photo) => photo.id),
        ),
      );
    }
  }

  // --- activity events -----------------------------------------------------
  // Append-only operational history: the row (who did it, when, on which trip)
  // is the shop's record of its own work and stays; the human-language message
  // names people and goes. `message` carries a non-blank check, so it is
  // redacted rather than cleared.
  //
  // Two statements, because the exact handles are not enough on their own. The
  // first sweeps by booking, by actor and by subject: everything attached to a
  // seat, everything this person did themselves, and everything written *about*
  // them on their own record. That third clause is the same one
  // `pagedDiverActivity` reads under (`src/db/operations.ts`) and the two move
  // together or not at all — a reader wider than this sweep would leave lines
  // legible on a record after an erasure had run.
  //
  // The name-scoped statement after it stays, for what none of the three exact
  // handles can reach: any message that names the diver while hanging off
  // another person's seat or none at all. It used to be the *only* handle on a
  // record-scoped note, whose subject lived solely inside the message text
  // ("… added a private note about Nora Quinn"); `subject_person_id` now carries
  // that outright, so the fuzzy pass is a backstop rather than the mechanism.
  //
  // The name match is bounded to whole words (`activityMessageNameMatch`) and
  // is skipped entirely below MIN_NAME_MATCH_CHARS. A substring match is not
  // "the right way round" at short names — it is unbounded: `Al`, `An` or `Ed`
  // as `%name%` matches inside `Dana`, `manifest` and `changed`, so erasing one
  // two-character name would replace most of the shop's operational history
  // with `[redacted]`, irreversibly, inside this transaction. At a word
  // boundary the residual over-reach is the intended one and is bounded to it:
  // an event naming a *different person with the same name* loses its wording.
  // That trade is still the right way round — a line of history against a name
  // someone asked to have forgotten — but it is a line, not the log.
  await tx
    .update(activityEvents)
    .set({ message: REDACTED_TEXT })
    .where(
      and(
        eq(activityEvents.shopId, shopId),
        or(
          owned ? inArray(activityEvents.bookingId, bookingIds) : undefined,
          eq(activityEvents.actorPersonId, personId),
          eq(activityEvents.subjectPersonId, personId),
        ),
      ),
    );

  // Run second and counted separately, so the number logged is exactly the
  // rows the fuzzy handle reached *beyond* the three exact ones above — the
  // figure an owner needs to judge whether the name match over-reached.
  const nameMatch = activityMessageNameMatch(ctx.fullName);
  if (nameMatch) {
    const byName = await tx
      .update(activityEvents)
      .set({ message: REDACTED_TEXT })
      .where(
        and(
          eq(activityEvents.shopId, shopId),
          nameMatch,
          ne(activityEvents.message, REDACTED_TEXT),
        ),
      )
      .returning({ id: activityEvents.id });
    logFuzzyMatch(ctx, "activity_event_name", byName.length);
  }

  // --- buddy-team trail ----------------------------------------------------
  //
  // `buddy_team_events.member_names` is denormalised on purpose — its whole job
  // is to outlive the membership rows a dissolve deletes (ADR
  // 20260804-buddy-teams) — and the table is deliberately never pruned
  // (`RETENTION_DAYS`). Both are right, and together they made it the one place
  // an erased diver's full name would otherwise stand indefinitely, still
  // rendering on the incident export's timeline. Exactly the class this file
  // already handles for `roll_call_events.note` and `activity_events.message`;
  // it was simply missed when the trail shipped (security review, 2026-08-04).
  //
  // Matched by name and not by id for a reason there is no way around: a
  // dissolved team has no membership rows left to join through, so the names
  // *are* the only handle. Same word-boundary matcher and the same stated
  // over-reach as the activity sweep above — and the same trade, one line of a
  // team's history against a name someone asked to have forgotten.
  //
  // The **element is replaced, never removed**: the array's length is the size
  // of the team, which is a safety fact about the departure and not about the
  // person. A team of three must keep reading as a team of three.
  const buddyNameMatch = buddyMemberNameMatch(ctx.fullName);
  if (buddyNameMatch) {
    const scrubbed = await tx
      .update(buddyTeamEvents)
      .set({
        memberNames: sql`(
          select coalesce(jsonb_agg(
            case when name ~* ${buddyNameMatch} then to_jsonb(${REDACTED_TEXT}::text) else to_jsonb(name) end
            order by ord
          ), '[]'::jsonb)
          from jsonb_array_elements_text(${buddyTeamEvents.memberNames}) with ordinality as t(name, ord)
        )`,
      })
      .where(
        and(
          eq(buddyTeamEvents.shopId, shopId),
          sql`exists (
        select 1 from jsonb_array_elements_text(${buddyTeamEvents.memberNames}) as t(name)
        where t.name ~* ${buddyNameMatch}
      )`,
        ),
      )
      .returning({ id: buddyTeamEvents.id });
    logFuzzyMatch(ctx, "buddy_team_event_name", scrubbed.length);
  }

  // --- reviews -------------------------------------------------------------
  // A published review is a public statement attributed to a named diver. The
  // words are theirs and go; the row is unpublished rather than left standing
  // over an erased byline. The shop's public average moves as a result — a real
  // cost of erasure, not something to fudge by keeping the star.
  await tx
    .update(tripReviews)
    .set({ comment: null, isPublished: false, publishedAt: null, isStandout: false })
    .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.personId, personId)));

  // --- the private word ----------------------------------------------------
  // A pulse is free text a diver typed on their phone about their day (ADR
  // 20260904-reef-all-the-way-down, D40). Nothing bounds it to "the gear was
  // bad": it is whatever they wanted this shop to know, under their name.
  //
  // The note goes and the row stays, which is the same call the review above
  // makes and for the same reason — the shop's record that it received and
  // settled a piece of feedback is operational, the words are the diver's. A
  // withdrawn pulse is scrubbed too: `deleted_at` is the diver taking it back,
  // not an erasure, and the text was still on file.
  //
  // Missed when this table shipped, and found by a `security-reviewer` pass
  // rather than by anything mechanical: nothing enumerates the person-scoped
  // tables, so the next one can be forgotten the same way.
  await tx
    .update(recapPulses)
    .set({ note: null })
    .where(
      and(
        eq(recapPulses.shopId, shopId),
        eq(recapPulses.personId, personId),
        isNotNull(recapPulses.note),
      ),
    );

  // --- imported history ----------------------------------------------------
  // The count of visits is the shop's own history; every label on them came out
  // of the diver's rows in the prior system. `dedupe_key` is NOT NULL and
  // unique per (shop, person), and can embed the source's own reference.
  const visits = await tx
    .select({ id: priorVisits.id })
    .from(priorVisits)
    .where(and(eq(priorVisits.shopId, shopId), eq(priorVisits.personId, personId)));
  for (const visit of visits) {
    await tx
      .update(priorVisits)
      .set({
        title: null,
        statusLabel: null,
        amountLabel: null,
        sourceLabel: null,
        sourceReference: null,
        dedupeKey: redactedUniqueValue("redacted"),
      })
      .where(eq(priorVisits.id, visit.id));
  }

  // The payment trail beside those visits, and the larger of the two. Every
  // label on it is the prior system's words about this diver's money, the
  // references are that system's own handles on them, and
  // `receipt_document_url` points at a re-stored receipt document that will
  // usually render the buyer's name. `imported_payment_history` is also carried
  // out of the shop by `src/db/export.ts` in both bundles, so an unerased row
  // here leaves the building with the next export — the same failure the
  // last-minute deal log had (issue #1607).
  //
  // `amount_cents` and `currency` stay. They are the only two columns on this
  // table the shop reads as its own money rather than as a sentence about a
  // person: the unverified-import slice of the financial aggregates is built
  // from them, and a total is not a fact about who paid it. The verbatim
  // `amount_label` beside them goes, for the reason it goes on `prior_visits`.
  const importedPayments = await tx
    .select({
      id: importedPaymentHistory.id,
      receiptDocumentUrl: importedPaymentHistory.receiptDocumentUrl,
    })
    .from(importedPaymentHistory)
    .where(
      and(eq(importedPaymentHistory.shopId, shopId), eq(importedPaymentHistory.personId, personId)),
    );
  for (const payment of importedPayments) {
    await retire("payment_receipt", payment.receiptDocumentUrl);
    await tx
      .update(importedPaymentHistory)
      .set({
        title: null,
        statusLabel: null,
        amountLabel: null,
        paymentReference: null,
        receiptReference: null,
        receiptDocumentUrl: null,
        sourceLabel: null,
        sourceReference: null,
        stripeReference: null,
        dedupeKey: redactedUniqueValue("redacted"),
      })
      .where(eq(importedPaymentHistory.id, payment.id));
  }

  // The imported rental history, the same shape one table over: `note`,
  // `status_label` and `source_reference` are the prior system's free text
  // about this diver's rentals, and `dedupe_key` can embed its reference. The
  // assignment window and the unit stay — which unit was out and when is the
  // register's own record, and it names nobody once the words are gone.
  const priorAssignments = await tx
    .select({ id: priorGearAssignments.id })
    .from(priorGearAssignments)
    .where(
      and(eq(priorGearAssignments.shopId, shopId), eq(priorGearAssignments.personId, personId)),
    );
  for (const assignment of priorAssignments) {
    await tx
      .update(priorGearAssignments)
      .set({
        statusLabel: null,
        sourceReference: null,
        note: null,
        dedupeKey: redactedUniqueValue("redacted"),
      })
      .where(eq(priorGearAssignments.id, assignment.id));
  }

  // --- last-minute deals ---------------------------------------------------
  // The key sweep of `trip_last_minute_promo_recipients` is above, with the
  // rest of this diver's addresses. This is its other half: the address sweep
  // beside the key sweep, which every other durable address
  // column here already has (issue #1622). `people_shop_email_unique` is
  // partial on *live* rows, so a soft-deleted duplicate person legitimately
  // shares this diver's address — and a duplicate that was never merged keeps
  // their address on its own recipient rows, where `person_id` cannot reach it.
  // The same case the send queue and `booking_checkouts` are swept for.
  //
  // Each row takes its own redacted value rather than one shared value: nothing
  // here is unique-indexed today, but a shared sentinel across rows is what
  // makes two erased people look like one, and `redactedUniqueValue` costs
  // nothing to call per row.
  if (ctx.email) {
    const byAddress = await tx
      .select({ id: tripLastMinutePromoRecipients.id })
      .from(tripLastMinutePromoRecipients)
      .where(
        and(
          eq(tripLastMinutePromoRecipients.shopId, shopId),
          sql`lower(${tripLastMinutePromoRecipients.email}) = ${ctx.email.toLowerCase()}`,
        ),
      );
    for (const row of byAddress) {
      await tx
        .update(tripLastMinutePromoRecipients)
        .set({ email: `${redactedUniqueValue("erased")}@invalid` })
        .where(eq(tripLastMinutePromoRecipients.id, row.id));
    }
    logFuzzyMatch(ctx, "last_minute_recipient_address", byAddress.length);
  }

  // --- hosted processor pages ----------------------------------------------
  // A Stripe-hosted page is a publicly reachable URL that renders the customer
  // it was minted for, which is why `orders.hosted_invoice_url` and
  // `invoice_pdf_url` are already nulled above. Two more of them sit one table
  // over and were missed: a tip's Checkout page is minted with
  // `customer_email` straight off `people.email` (`src/db/tips.ts`), and a
  // booking checkout's is the same object beside the address this file already
  // clears. Both are bounded by session expiry and both columns are durable,
  // so the row outlives the window it is safe in (issue #1607).
  if (owned) {
    await tx
      .update(tips)
      .set({ checkoutUrl: null })
      .where(
        and(
          eq(tips.shopId, shopId),
          inArray(tips.bookingId, bookingIds),
          isNotNull(tips.checkoutUrl),
        ),
      );
  }

  // --- the day's close-out ------------------------------------------------
  // `outstanding` is the snapshot of what was still open when a day was closed,
  // and its leftovers carry a **copied** `subject` and `detail` rather than an
  // id — `src/lib/closeout.ts` says so, and eight producers in `src/db/today.ts`
  // put the diver's own name in that subject. The snapshot's own docblock calls
  // the text "trail text, like `activity_events.message`", which is exactly
  // right and is why leaving it standing was wrong: that column is redacted by
  // this same name match a few statements down, and this one was not. The table
  // carries no retention arm, so the name was permanent and legible from the
  // close-out trail (issue #1607).
  //
  // The **element is replaced, never removed**, like the buddy sweep above: how
  // many things were left open when the shop closed is a fact about the day.
  const closeoutNameMatch = buddyMemberNameMatch(ctx.fullName);
  if (closeoutNameMatch) {
    const closed = await tx
      .update(dayCloseouts)
      .set({
        outstanding: sql`jsonb_set(
          ${dayCloseouts.outstanding},
          '{leftovers}',
          (
            select coalesce(jsonb_agg(
              case
                when (item->>'subject') ~* ${closeoutNameMatch}
                  or (item->>'detail') ~* ${closeoutNameMatch}
                then item || jsonb_build_object(
                  'subject', to_jsonb(${REDACTED_TEXT}::text),
                  'detail', to_jsonb(${REDACTED_TEXT}::text)
                )
                else item
              end
              order by ord
            ), '[]'::jsonb)
            from jsonb_array_elements(${dayCloseouts.outstanding}->'leftovers')
              with ordinality as t(item, ord)
          )
        )`,
      })
      .where(
        and(
          eq(dayCloseouts.shopId, shopId),
          sql`exists (
            select 1 from jsonb_array_elements(${dayCloseouts.outstanding}->'leftovers') as t(item)
            where (t.item->>'subject') ~* ${closeoutNameMatch}
               or (t.item->>'detail') ~* ${closeoutNameMatch}
          )`,
        ),
      )
      .returning({ id: dayCloseouts.id });
    logFuzzyMatch(ctx, "day_closeout_leftover_name", closed.length);
  }

  // --- gear register -------------------------------------------------------
  // Staff prose typed about how a unit came home ("torn strap, needs look"),
  // which is free text about a rental this diver had out. The reservation, its
  // window and its outcome stay: what a unit did and when it came back is the
  // register's own service record, and the sentence is the only part of it
  // written about a person. The asymmetry is what made this a gap rather than a
  // judgement call — the erasure already blanks `roll_call_events.note` and
  // `booking_payments.note` for exactly this reason.
  //
  // Both holder shapes, because `gear_reservations_one_holder` allows only one
  // at a time: a bookingless counter rental carries `person_id`, and a rental
  // against a seat carries `booking_id`.
  // Redacted rather than cleared where the note is the evidence behind a
  // `service_concern`: the writer requires words for that outcome, no database
  // check enforces the pairing, and a unit left flagged for service with a
  // silently empty note reads as "nobody said" — which is the reading the
  // column's own docblock warns against. `[redacted]` tells a technician to
  // ask. A plain return keeps a null.
  const clearedReturnNote = sql`case when ${gearReservations.returnOutcome} = 'service_concern' then ${REDACTED_TEXT} else null end`;
  await tx
    .update(gearReservations)
    .set({ returnNote: clearedReturnNote })
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(gearReservations.personId, personId),
        isNotNull(gearReservations.returnNote),
        ne(gearReservations.returnNote, REDACTED_TEXT),
      ),
    );
  if (owned) {
    await tx
      .update(gearReservations)
      .set({ returnNote: clearedReturnNote })
      .where(
        and(
          eq(gearReservations.shopId, shopId),
          inArray(gearReservations.bookingId, bookingIds),
          isNotNull(gearReservations.returnNote),
          ne(gearReservations.returnNote, REDACTED_TEXT),
        ),
      );
  }

  // --- orders --------------------------------------------------------------
  // `stripe_customer_id` and `stripe_invoice_id` are NOT NULL pointers into the
  // shop's own Stripe account and stay on the row — the local record of which
  // objects the order maps to is what makes the processor-side work findable at
  // all. What this statement closes is the pair of hosted document links:
  // Stripe's hosted invoice page and invoice PDF are publicly reachable URLs
  // that render the customer's name and email, so leaving them here leaves the
  // diver's details one click away from an "erased" record.
  const orderRows = await tx
    .select({
      id: orders.id,
      stripeAccountId: orders.stripeAccountId,
      stripeCustomerId: orders.stripeCustomerId,
      stripeInvoiceId: orders.stripeInvoiceId,
    })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.personId, personId)));
  await tx
    .update(orders)
    // `description` goes with them. It is staff-typed free text on the invoice
    // form, and this repository already treats it as third-party-naming
    // elsewhere: `src/db/export.ts` excludes it from both bundles' order files
    // with that reason written at the exclusion, and `diver-export.test.ts`
    // pins the header with a seeded "Split with <name>'s buddy this trip".
    // Excluded from an export and left on the row after an erasure is not a
    // consistent answer (issue #1607, found by a `security-reviewer` pass).
    .set({ hostedInvoiceUrl: null, invoicePdfUrl: null, description: null })
    .where(and(eq(orders.shopId, shopId), eq(orders.personId, personId)));

  // The per-line half of the same text, on the same form, carried out of the
  // shop under the same exclusion.
  const orderIds = orderRows.map((row) => row.id);
  if (orderIds.length > 0) {
    // NOT NULL, so redacted rather than cleared — the same shape
    // `activity_events.message` takes for the same reason.
    await tx
      .update(orderLineItems)
      .set({ description: REDACTED_TEXT })
      .where(
        and(
          eq(orderLineItems.shopId, shopId),
          inArray(orderLineItems.orderId, orderIds),
          ne(orderLineItems.description, REDACTED_TEXT),
        ),
      );
  }

  // Everything those orders point at *at Stripe* becomes a row in the erasure
  // ledger (ADR 20260803-processor-erasure-obligations): the customer objects,
  // which DiveDay deletes itself once this transaction commits, and the
  // finalized invoices, whose name/email snapshot no API rewrites and which the
  // shop clears through Stripe's own data-deletion request.
  //
  // Recorded here, attempted after — writing the row inside the transaction is
  // what makes the obligation durable against a crash a millisecond later;
  // making the *call* here would put a third-party round trip inside the
  // erasure transaction and let a Stripe outage roll back the scrub. Each
  // order's own `stripe_account_id` travels with the row rather than the shop's
  // current account, the same discipline `refundOrder` uses.
  const raisedProcessorErasures = await recordProcessorErasureObligations(tx, {
    shopId,
    personId,
    targets: [
      ...orderRows.map((row) => ({
        target: "stripe_customer" as const,
        externalId: row.stripeCustomerId,
        stripeAccountId: row.stripeAccountId,
      })),
      ...orderRows.map((row) => ({
        target: "stripe_invoice_snapshot" as const,
        externalId: row.stripeInvoiceId,
        stripeAccountId: row.stripeAccountId,
      })),
    ],
  });

  // --- the checkout's own copy of the diver's address ----------------------
  // `booking_checkouts.customer_email` is the same class of un-normalized PII
  // as the send queue below — a durable address with no `person_id` to sweep
  // on — and it is worse than a stale column. Erasure cancels no booking and
  // settles no payment, so an erased diver with an open, unexpired checkout on
  // a future trip is still a live candidate for `sendDueCheckoutRecoveries`
  // (src/db/checkout-recovery.ts): none of its disqualifiers — cancelled trip,
  // cancelled booking, settled payment, departed trip — fires, and the next
  // daily cron tick would email the address the shop has just told the diver
  // it destroyed.
  //
  // The column holds the *submitter's* address (the schema notes that there is
  // no lead marker on `booking_checkout_bookings`, so the purchaser cannot be
  // re-derived from the join). The party case therefore cuts both ways, and
  // the two sweeps are deliberately asymmetric:
  //
  //   1. **By address.** Both callers of `startBookingCheckout` pass a
  //      `people.email`, so a stored address equal to this diver's is theirs,
  //      whoever the checkout covers — including a party they paid for but
  //      hold no seat on, which the booking join cannot see at all. Nulled
  //      unconditionally. Co-travellers on that party lose the hosted link and
  //      the recovery nudge; staff can quote them a fresh checkout. That is a
  //      cost of erasure, not a reason to leave the address standing.
  //
  //   2. **By booking, but only when the checkout covers nothing but this
  //      diver's own seats.** This reaches an address that is theirs yet no
  //      longer on their person row — they changed it after checking out — for
  //      which the join is the only handle. It stops at a mixed party on
  //      purpose: an address that survived sweep 1 on a checkout covering
  //      other divers is, as far as this row can tell, some live third party's,
  //      and blanking it would destroy a bystander's contact detail and take
  //      the rest of the party's payment link with it to erase an address that
  //      is very likely not the erased diver's at all.
  //
  // Not expired, only blanked. Marking a locally-`expired` row while Stripe's
  // hosted session is still open would make `markCheckoutPaidBySessionId`
  // refuse a completion that genuinely captured money (see its
  // `paid_disqualified` branch), which is a worse failure than an unpaid row
  // that lingers. With no address the recovery scan cannot send at all, and
  // the row leaves the candidate pool on its own once the session expires or
  // the trip departs.
  if (ctx.email) {
    const byAddress = await tx
      .update(bookingCheckouts)
      .set({ customerEmail: null })
      .where(
        and(
          eq(bookingCheckouts.shopId, shopId),
          sql`lower(${bookingCheckouts.customerEmail}) = ${ctx.email.toLowerCase()}`,
        ),
      )
      .returning({ id: bookingCheckouts.id });
    logFuzzyMatch(ctx, "booking_checkout_customer_email", byAddress.length);
  }
  if (owned) {
    const bookingIdSet = new Set(bookingIds);
    const covering = await tx
      .selectDistinct({ checkoutId: bookingCheckoutBookings.checkoutId })
      .from(bookingCheckoutBookings)
      .where(
        and(
          eq(bookingCheckoutBookings.shopId, shopId),
          inArray(bookingCheckoutBookings.bookingId, bookingIds),
        ),
      );
    if (covering.length > 0) {
      const coveringIds = covering.map((row) => row.checkoutId);
      const allLinks = await tx
        .select({
          checkoutId: bookingCheckoutBookings.checkoutId,
          bookingId: bookingCheckoutBookings.bookingId,
        })
        .from(bookingCheckoutBookings)
        // Shop-scoped like every other read in this file. A checkout's links
        // are same-shop by construction and `coveringIds` was itself resolved
        // under the shop scope, so this changes no result today — it is here so
        // the rule holds by inspection rather than by argument.
        .where(
          and(
            eq(bookingCheckoutBookings.shopId, shopId),
            inArray(bookingCheckoutBookings.checkoutId, coveringIds),
          ),
        );
      const soleOccupant = coveringIds.filter((checkoutId) =>
        allLinks
          .filter((link) => link.checkoutId === checkoutId)
          .every((link) => bookingIdSet.has(link.bookingId)),
      );
      if (soleOccupant.length > 0) {
        const byBooking = await tx
          .update(bookingCheckouts)
          // The hosted page goes with the address: it is the same Stripe object
          // rendering the same customer, on the same reasoning that nulls
          // `orders.hosted_invoice_url` (issue #1607).
          .set({ customerEmail: null, checkoutUrl: null })
          .where(
            and(
              eq(bookingCheckouts.shopId, shopId),
              inArray(bookingCheckouts.id, soleOccupant),
              isNotNull(bookingCheckouts.customerEmail),
            ),
          )
          .returning({ id: bookingCheckouts.id });
        logFuzzyMatch(ctx, "booking_checkout_sole_occupant", byBooking.length);
      }
    }
  }

  // --- the un-normalized PII blob -----------------------------------------
  // `notification_send_queue.payload_sealed` is a rendered outbound message
  // carrying the recipient's name and address, with no person_id to sweep on.
  // It is a work queue, not evidence (that lives in notification_deliveries),
  // so the rows go. Only *live* ones are reachable, and only live ones hold
  // anything: a row past its terminal write has had its payload, recipient and
  // booking cleared by the drain, so there is nothing left in it to erase.
  //
  // The two matches read `recipient_email` and `booking_id`, which are columns
  // rather than `payload ->> …` probes because the payload is sealed and
  // nothing can read through it (issue #1297). That made the sweep stronger,
  // not weaker: the same two handles, now typed and indexable, and no longer
  // silently missing a row whose blob spelled a field differently.
  //
  // The address match is fuzzy in one direction that is worth seeing:
  // `people_shop_email_unique` is partial on *live* rows, so a soft-deleted
  // duplicate person can legitimately hold the same address as a live one, and
  // erasing the deleted record drops the live person's queued mail. There is
  // still no tighter predicate — this queue carries no `person_id` — so the
  // match stays and the count is logged.
  //
  // **Both address handles, not just the recipient's.** A kind whose *subject*
  // is not the person it is addressed to used to be out of reach entirely:
  // `course_inquiry` mails the shop's own front desk about a diver who used
  // the public composer and carries their name, address, phone and free-text
  // message, and `new_account_alert` is the same shape about an owner. A
  // retryable failure plus an erasure before the retry drained left all of
  // that in a live row nothing here matched. `subject_email` is what
  // `queueRetry` now lifts out for them (issue #1298); one statement rather
  // than two because the delete is the same delete and the count is the same
  // count.
  if (ctx.email) {
    const address = ctx.email.toLowerCase();
    const dropped = await tx
      .delete(notificationSendQueue)
      .where(
        and(
          eq(notificationSendQueue.shopId, shopId),
          or(
            sql`lower(${notificationSendQueue.recipientEmail}) = ${address}`,
            sql`lower(${notificationSendQueue.subjectEmail}) = ${address}`,
          ),
        ),
      )
      .returning({ id: notificationSendQueue.id });
    logFuzzyMatch(ctx, "send_queue_address", dropped.length);
  }
  // The number, for the lead that gave one and no address. Runs after the
  // address sweep so the count is the rows the number reached that the address
  // did not — the over-reach, isolated, exactly as the `course_inquiries`
  // statements below split theirs. It exists because the public composer takes
  // an address *or* a number (`hasReplyPath`, src/app/actions/inquiry.ts): a
  // diver who leaves only a number produces a `course_inquiry` carrying their
  // name, that number and up to 1,500 characters of free text, and no address
  // handle can see it. The first version of this fix shipped exactly that hole
  // (`security-reviewer`, issue #1298).
  //
  // Fuzzier than the address by the same distance, and accepted for the same
  // written reason: a household number is shared, so this can drop a partner's
  // queued lead. That costs a retry of a notification whose own
  // `course_inquiries` row this transaction blanks anyway.
  if (ctx.phone) {
    const droppedByPhone = await tx
      .delete(notificationSendQueue)
      .where(
        and(
          eq(notificationSendQueue.shopId, shopId),
          eq(notificationSendQueue.subjectPhone, ctx.phone),
        ),
      )
      .returning({ id: notificationSendQueue.id });
    logFuzzyMatch(ctx, "send_queue_subject_phone", droppedByPhone.length);
  }
  if (owned) {
    await tx
      .delete(notificationSendQueue)
      .where(
        and(
          eq(notificationSendQueue.shopId, shopId),
          inArray(notificationSendQueue.bookingId, bookingIds),
        ),
      );
  }

  // --- unfinished forms ----------------------------------------------------
  // `form_drafts.fields` is whatever a staffer had typed into a form and not
  // yet submitted, and on a `new_diver` draft that is a person's name, address,
  // phone and emergency contact. `person_id` on the row is the **author**, so
  // no person-scoped sweep reaches the subject: a draft about this diver sits
  // under a staff member's id.
  //
  // The bound the table was trusted to have is smaller than it looked. Its
  // reader drops anything over 24h and `NEVER_DRAFTED` keeps card, medical and
  // token fields out — but not a name, an address or a phone, and the retention
  // prune runs **weekly** against that one-day cutoff (`30 3 * * 0`). So a draft
  // could outlive an erasure by five more days (issue #1620).
  //
  // Deleted rather than redacted. A draft is one person's unfinished work about
  // one subject: clearing the field that matched would leave the other three
  // standing, because only the address field ever equals the address. The row
  // is the unit that is about somebody, so the row is the unit that goes.
  //
  // **All three handles, not just the address.** The first cut of this ran only
  // when `ctx.email` was non-null, and `people.email` is nullable — so a
  // phone-only walk-in's draft survived the erasure entirely while the coverage
  // guard read green, because that guard sees the `delete` statement and not the
  // `if` above it. A `security-reviewer` pass caught it. The name handle is what
  // makes the sweep unconditional: `people.full_name` is NOT NULL.
  //
  // Each handle costs the over-reach it always costs here, and each is counted
  // separately so an owner can see which one fired: a household shares a phone
  // (the reasoning `course_inquiries` records below), and a name reaches a
  // namesake — which is why it goes through `buddyMemberNameMatch`, anchored on
  // word boundaries and refused below three word characters.
  const draftHandles: { predicate: string; match: SQL }[] = [];
  if (ctx.email) {
    draftHandles.push({
      predicate: "form_draft_address",
      match: sql`lower(field.value) = ${ctx.email.toLowerCase()}`,
    });
  }
  if (ctx.phone) {
    draftHandles.push({
      predicate: "form_draft_phone",
      match: sql`field.value = ${ctx.phone}`,
    });
  }
  const draftNameMatch = buddyMemberNameMatch(ctx.fullName);
  if (draftNameMatch) {
    draftHandles.push({
      predicate: "form_draft_name",
      match: sql`field.value ~* ${draftNameMatch}`,
    });
  }
  for (const handle of draftHandles) {
    const dropped = await tx
      .delete(formDrafts)
      .where(
        and(
          eq(formDrafts.shopId, shopId),
          // `jsonb_typeof` is inside the function argument rather than beside
          // it: Postgres does not promise to evaluate `and` left to right, so a
          // sibling guard would not stop `jsonb_each_text` being handed a
          // non-object — and that raises inside the one transaction the whole
          // erasure runs in, which would refuse every erasure this shop ever
          // asks for. Unreachable today (`draftableFields` only ever builds a
          // string record) and cheap to make unreachable by construction.
          sql`exists (
            select 1 from jsonb_each_text(
              case when jsonb_typeof(${formDrafts.fields}) = 'object'
                then ${formDrafts.fields} else '{}'::jsonb end
            ) as field(name, value)
            where ${handle.match}
          )`,
        ),
      )
      .returning({ id: formDrafts.id });
    logFuzzyMatch(ctx, handle.predicate, dropped.length);
  }

  // --- course inquiries ----------------------------------------------------
  // Three statements, strongest handle first. `person_id` is deliberately left
  // in place on every one of them: it points at a row that is itself already
  // erased, so it discloses nothing, and keeping it makes a replayed erasure
  // reach the same leads a second time.
  //
  // `interest` and the two date columns are deliberately *not* blanked. They
  // hold what the request was about and which days it asked for — no identity,
  // nothing that reaches back to a person once the name, address, phone, timing
  // prose and message above them are gone — and `interest` is what keeps a
  // course-less row legal at all (`course_inquiries_subject_present`): blanking
  // it would turn an erasure into a constraint violation.
  const blankInquiry = { name: null, email: null, phone: null, timing: null, message: null };

  // 1. `person_id`, when the lead carries one. A public lead is still written
  //    before any person may exist, so the column stays nullable — but when the
  //    address on the form matched a live diver of this shop at capture time,
  //    `recordCourseInquiry` (src/db/course-inquiries.ts) snapshotted the link,
  //    and that snapshot is an exact foreign key rather than a match against
  //    whatever the two rows happen to say today. It is the one handle that
  //    survives the diver changing their email afterwards, which the address
  //    sweep below cannot.
  //
  //    A lead written with no email, or with an address no diver of this shop
  //    held at the time, still has no link and is still reachable only by the
  //    two fuzzy handles after it. That residual is narrower than it was, not
  //    closed: see the ADR. Nothing back-fills this column from a later match —
  //    a link inferred after the fact would erase a bystander's lead.
  await tx
    .update(courseInquiries)
    .set(blankInquiry)
    .where(and(eq(courseInquiries.shopId, shopId), eq(courseInquiries.personId, personId)));

  // 2 and 3 match on the contact details the diver themselves supplied, for the
  // leads statement 1 cannot reach.
  //
  // Split into two statements so the phone predicate can be counted on its
  // own. It is the fuzzier of the two by a distance: a household or family
  // number is genuinely shared, so this can blank a partner's or a child's
  // lead — name, message and all — and there is no way to tell from the row.
  // It is not tightened (to "…and the inquiry carries no email", say) because
  // that would drop the real case it exists for: the diver who used a
  // different address on the public lead form than the one on their record.
  // The over-reach is accepted, owner-gated, and logged.
  if (ctx.email) {
    await tx
      .update(courseInquiries)
      .set(blankInquiry)
      .where(
        and(
          eq(courseInquiries.shopId, shopId),
          sql`lower(${courseInquiries.email}) = ${ctx.email.toLowerCase()}`,
        ),
      );
  }
  if (ctx.phone) {
    // Runs after the address sweep, so the count is the rows the number
    // reached that the address did not — the over-reach, isolated.
    const byPhone = await tx
      .update(courseInquiries)
      .set(blankInquiry)
      .where(and(eq(courseInquiries.shopId, shopId), eq(courseInquiries.phone, ctx.phone)))
      .returning({ id: courseInquiries.id });
    logFuzzyMatch(ctx, "course_inquiry_phone", byPhone.length);
  }

  // --- the inbox (ADR 20260907-two-way-inbox) -------------------------------
  // What the diver wrote is theirs end to end — the words, the subject, and the
  // address they wrote from — and what the shop wrote back names them in the
  // `To:` and usually in the body. Redacted rather than deleted, like the pulse
  // above: the row stays as the shop's record that a conversation happened, on
  // the day it happened, and nothing else. Keyed on the link first, then on the
  // address the diver held, for the same reason as the course-inquiry sweep:
  // a stranger's message that matched nobody at the time can still be theirs.
  // `emailMessageId` goes with them: it is a string the diver's own mail client
  // wrote, and many clients build it from the local part of the sender's
  // address, so leaving it behind hands back the address the line above just
  // redacted.
  const blankMessage = {
    body: REDACTED_TEXT,
    subject: null,
    fromAddress: REDACTED_TEXT,
    emailMessageId: null,
  };
  await tx
    .update(inboundMessages)
    .set(blankMessage)
    .where(and(eq(inboundMessages.shopId, shopId), eq(inboundMessages.personId, personId)));
  if (ctx.email) {
    await tx
      .update(inboundMessages)
      .set(blankMessage)
      .where(
        and(
          eq(inboundMessages.shopId, shopId),
          eq(inboundMessages.channel, "email"),
          eq(inboundMessages.fromAddress, ctx.email.toLowerCase()),
        ),
      );
  }
  if (ctx.phone) {
    const digits = ctx.phone.replace(/\D/g, "");
    if (digits.length >= 7) {
      const byPhone = await tx
        .update(inboundMessages)
        .set(blankMessage)
        .where(
          and(
            eq(inboundMessages.shopId, shopId),
            ne(inboundMessages.channel, "email"),
            eq(inboundMessages.fromAddress, digits),
          ),
        )
        .returning({ id: inboundMessages.id });
      logFuzzyMatch(ctx, "inbound_message_phone", byPhone.length);
    }
  }
  await tx
    .update(staffReplies)
    // `sendError` too, and not as tidiness: SES, SNS and Meta all quote the
    // recipient back in their failure strings ("Email address is not
    // verified: ..."), so a reply that failed to a diver who is later erased
    // would leave their address in the one row this sweep had just cleaned.
    .set({ body: REDACTED_TEXT, toAddress: REDACTED_TEXT, sendError: null })
    .where(and(eq(staffReplies.shopId, shopId), eq(staffReplies.personId, personId)));

  return { queuedMediaDeletions: queued, raisedProcessorErasures };
}
