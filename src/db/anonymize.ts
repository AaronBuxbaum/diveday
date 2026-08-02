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
 *
 * The scrub is one transaction. A partial erasure — identity gone from
 * `people` but medical answers still sitting in `waiver_records` — is the worst
 * outcome available, so it either all lands or none of it does.
 */

import { and, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { ANONYMIZED_PERSON_NAME, REDACTED_TEXT, redactedUniqueValue } from "@/lib/anonymization";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  computeWaiverIntegrityHash,
  WAIVER_INTEGRITY_VERSION_ERASED,
} from "@/lib/waiver-integrity";
import { createWaiverToken, hashWaiverToken } from "@/lib/waivers";
import { canPersonErasePersonalData } from "./authz";
import type { AppDb, AppTransaction } from "./client";
import { queueMediaDeletion } from "./media-deletions";
import {
  accountTokens,
  activityEvents,
  bookingCapabilities,
  bookingPayments,
  bookings,
  calendarFeeds,
  certifications,
  courseInquiries,
  internalNotes,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  nitroxCertifications,
  notificationDeliveries,
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
} as const;

/**
 * Erase one diver. Idempotent: a second call on an already-erased record
 * reports success without touching anything, so a double-submitted form or a
 * retried job can never half-apply a second pass.
 */
export async function anonymizeDiver(
  db: AppDb,
  input: { shopId: string; personId: string; actorPersonId: string },
): Promise<AnonymizeDiverResult> {
  const now = nowDate();
  return db.transaction(async (tx) => {
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
      return { ok: true, alreadyAnonymized: true, queuedMediaDeletions: 0 } as const;
    }

    const roleRows = await tx
      .select({ role: personRoles.role })
      .from(personRoles)
      .where(eq(personRoles.personId, input.personId));
    if (roleRows.some((row) => STAFF_ROLES.includes(row.role))) {
      return { ok: false, reason: "staff_member" } as const;
    }

    const queuedMediaDeletions = await scrub(tx, {
      shopId: input.shopId,
      personId: input.personId,
      actorPersonId: input.actorPersonId,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      deletedAt: person.deletedAt ?? now,
      now,
    });

    return { ok: true, alreadyAnonymized: false, queuedMediaDeletions } as const;
  });
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

async function scrub(tx: AppTransaction, ctx: ScrubContext): Promise<number> {
  const { shopId, personId, now } = ctx;

  const bookingRows = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId)));
  const bookingIds = bookingRows.map((row) => row.id);
  const owned = bookingIds.length > 0;

  let queued = 0;
  const retire = async (
    kind: "certification_card" | "recap_photo" | "waiver_document",
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

  // The person is no longer a diver of this shop; nothing downstream may treat
  // an erased record as an active one of any kind.
  await tx.delete(personRoles).where(eq(personRoles.personId, personId));

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
  // the diver's agency number and the photograph of their card do not. Cards
  // are archived at the same time: an erased diver has no future readiness to
  // satisfy, and archiving frees the number's partial unique index.
  const levelCards = await tx
    .select()
    .from(certifications)
    .where(and(eq(certifications.shopId, shopId), eq(certifications.personId, personId)));
  for (const card of levelCards) {
    await retire("certification_card", card.cardImageUrl);
    await tx
      .update(certifications)
      .set({
        identifier: redactedUniqueValue("redacted"),
        cardImageUrl: null,
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
    await retire("certification_card", card.cardImageUrl);
    await tx
      .update(specialtyCertifications)
      .set({
        identifier: redactedUniqueValue("redacted"),
        cardImageUrl: null,
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
      .set({ groupPreference: null })
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
  // Two sweeps, because one is not enough. The booking-scoped one catches
  // everything attached to a seat. The name-scoped one catches what it cannot:
  // an internal note attached to the *diver* rather than a booking writes an
  // event with a null `booking_id` and a message that names the diver outright
  // ("… added a private note about Nora Quinn", src/db/operations.ts), and
  // `activity_events` carries no person link to sweep on. Matching the stored
  // name is the only handle that exists.
  //
  // It can over-reach — a staff member who shares a name with the erased diver
  // loses the wording of an unrelated event. That is the right way round: an
  // event redacted too eagerly costs a line of history, while a missed one
  // leaves the name of someone who asked to be forgotten in the shop's log.
  const namePattern = `%${ctx.fullName.replace(/[\\%_]/g, "\\$&")}%`;
  await tx
    .update(activityEvents)
    .set({ message: REDACTED_TEXT })
    .where(
      and(
        eq(activityEvents.shopId, shopId),
        or(
          owned ? inArray(activityEvents.bookingId, bookingIds) : undefined,
          eq(activityEvents.actorPersonId, personId),
          ilike(activityEvents.message, namePattern),
        ),
      ),
    );

  // --- reviews -------------------------------------------------------------
  // A published review is a public statement attributed to a named diver. The
  // words are theirs and go; the row is unpublished rather than left standing
  // over an erased byline. The shop's public average moves as a result — a real
  // cost of erasure, not something to fudge by keeping the star.
  await tx
    .update(tripReviews)
    .set({ comment: null, isPublished: false, publishedAt: null })
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
  // `stripe_customer_id` and `stripe_invoice_id` are NOT NULL pointers into
  // Stripe's own records, which the shop must keep for tax and chargeback and
  // which DiveDay cannot rewrite — see the ADR's residuals. What DiveDay *can*
  // close is the pair of hosted document links: Stripe's hosted invoice page
  // and invoice PDF are publicly reachable URLs that render the customer's name
  // and email, so leaving them in the row leaves the diver's details one click
  // away from an "erased" record.
  await tx
    .update(orders)
    .set({ hostedInvoiceUrl: null, invoicePdfUrl: null })
    .where(and(eq(orders.shopId, shopId), eq(orders.personId, personId)));

  // --- the un-normalized PII blob -----------------------------------------
  // `notification_send_queue.payload` is a rendered outbound message carrying
  // the recipient's name and address, with no person_id to sweep on. It is a
  // work queue, not evidence (that lives in notification_deliveries), so the
  // rows go — including already-sent ones, whose payload is the same blob.
  if (ctx.email) {
    await tx
      .delete(notificationSendQueue)
      .where(
        and(
          eq(notificationSendQueue.shopId, shopId),
          sql`lower(${notificationSendQueue.payload} ->> 'to') = ${ctx.email.toLowerCase()}`,
        ),
      );
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

  // --- course inquiries: the table with no person_id ----------------------
  // A public course-page lead is deliberately unlinked (there is no person yet
  // when it is written), so a person_id-driven sweep structurally cannot reach
  // it. Matched on the contact details the diver themselves supplied — the only
  // link that exists. An inquiry left with neither a matching email nor phone
  // is *not* reached by this; that gap is stated in the ADR rather than papered
  // over here.
  const inquiryByEmail = ctx.email
    ? sql`lower(${courseInquiries.email}) = ${ctx.email.toLowerCase()}`
    : undefined;
  const inquiryByPhone = ctx.phone ? eq(courseInquiries.phone, ctx.phone) : undefined;
  if (inquiryByEmail || inquiryByPhone) {
    await tx
      .update(courseInquiries)
      .set({ name: null, email: null, phone: null, timing: null, message: null })
      .where(and(eq(courseInquiries.shopId, shopId), or(inquiryByEmail, inquiryByPhone)));
  }

  return queued;
}
