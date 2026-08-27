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

import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
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
import { attemptProcessorErasures, recordProcessorErasureObligations } from "./processor-erasure";
import type { ProcessorErasureObligation } from "./schema";
import {
  accountSecurity,
  accountSessions,
  accountTokens,
  activityEvents,
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  buddyTeamEvents,
  calendarFeeds,
  certifications,
  courseInquiries,
  diveSupportNeeds,
  internalNotes,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  nitroxCertifications,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  orders,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  priorVisits,
  recapPhotos,
  rentalFitProfiles,
  rollCallEvents,
  specialtyCertifications,
  staffCredentials,
  tripReviews,
  tripWaitlistEntries,
  userAccounts,
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

/** Every column `summarizeDivers` already refuses to ship to the browser, plus the rest. */
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
 * Four of the sweeps below are matched on something other than a foreign key —
 * the name match above, a shared household phone number on a course inquiry, an
 * address in the send queue that a soft-deleted duplicate person can
 * legitimately share with a live one, and the address on a checkout that covers
 * only this diver's seats but may have been submitted by whoever booked them.
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

  const bookingRows = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)));
  const bookingIds = bookingRows.map((row) => row.id);
  const owned = bookingIds.length > 0;

  let queued = 0;
  const retire = async (kind: "recap_photo" | "waiver_document", url: string | null) => {
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

    const [stripped] = await tx
      .update(waiverRecords)
      .set({
        draftSignerName: null,
        draftMedicalAnswers: null,
        draftAcknowledged: false,
        signedName: null,
        medicalAnswers: null,
        importedFromLabel: null,
        importSourceDocumentUrl: null,
        importSourceMedicalDocumentUrl: null,
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

  // --- the diver's own login, if they ever had one -------------------------
  const [account] = await tx
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  if (account) {
    await tx.delete(accountTokens).where(eq(accountTokens.userAccountId, account.id));
    await tx.delete(accountSecurity).where(eq(accountSecurity.userAccountId, account.id));
    // Revoke any session issued before this instant — status alone
    // (`disabled` below) is not read by the session lookup itself, so a
    // live sign-in would otherwise keep working until it naturally expires.
    await tx.delete(accountSessions).where(eq(accountSessions.userAccountId, account.id));
    await tx
      .update(userAccounts)
      .set({
        // `email` is NOT NULL and globally unique, and `hashed_password` is
        // NOT NULL, so both take unique unusable values rather than null. The
        // replacement hash is not a hash of anything: no password verifies
        // against it, which is the point.
        email: `${redactedUniqueValue("erased")}@invalid`,
        hashedPassword: redactedUniqueValue("erased"),
        emailVerifiedAt: null,
        status: "disabled",
      })
      .where(eq(userAccounts.id, account.id));
  }

  // --- booking-scoped rows -------------------------------------------------
  if (owned) {
    await tx
      .update(bookings)
      .set({ groupPreference: null, hotelPickupLocation: null, pickupTime: null })
      .where(inArray(bookings.id, bookingIds));

    await tx
      .update(bookingCapabilities)
      .set({ revokedAt: now, expiresAt: now })
      .where(
        and(
          inArray(bookingCapabilities.bookingId, bookingIds),
          isNull(bookingCapabilities.revokedAt),
        ),
      );

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
      .update(bookingPayments)
      .set({ note: null })
      .where(
        and(eq(bookingPayments.shopId, shopId), inArray(bookingPayments.bookingId, bookingIds)),
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
      stripeAccountId: orders.stripeAccountId,
      stripeCustomerId: orders.stripeCustomerId,
      stripeInvoiceId: orders.stripeInvoiceId,
    })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.personId, personId)));
  await tx
    .update(orders)
    .set({ hostedInvoiceUrl: null, invoicePdfUrl: null })
    .where(and(eq(orders.shopId, shopId), eq(orders.personId, personId)));

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
          .set({ customerEmail: null })
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
  // `notification_send_queue.payload` is a rendered outbound message carrying
  // the recipient's name and address, with no person_id to sweep on. It is a
  // work queue, not evidence (that lives in notification_deliveries), so the
  // rows go — including already-sent ones, whose payload is the same blob.
  //
  // The address match is fuzzy in one direction that is worth seeing:
  // `people_shop_email_unique` is partial on *live* rows, so a soft-deleted
  // duplicate person can legitimately hold the same address as a live one, and
  // erasing the deleted record drops the live person's queued mail. There is
  // no tighter predicate — the payload carries no `person_id` — so the match
  // stays and the count is logged.
  if (ctx.email) {
    const dropped = await tx
      .delete(notificationSendQueue)
      .where(
        and(
          eq(notificationSendQueue.shopId, shopId),
          sql`lower(${notificationSendQueue.payload} ->> 'to') = ${ctx.email.toLowerCase()}`,
        ),
      )
      .returning({ id: notificationSendQueue.id });
    logFuzzyMatch(ctx, "send_queue_recipient", dropped.length);
  }
  if (owned) {
    await tx
      .delete(notificationSendQueue)
      .where(
        and(
          eq(notificationSendQueue.shopId, shopId),
          inArray(sql`${notificationSendQueue.payload} ->> 'bookingId'`, bookingIds),
        ),
      );
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

  return { queuedMediaDeletions: queued, raisedProcessorErasures };
}
