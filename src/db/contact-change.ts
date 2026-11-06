import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { createWaiverToken, hashWaiverToken } from "@/lib/waiver-tokens";
import { revokeBookingLinksSentToPerson } from "./booking-capabilities";
import type { DbExecutor } from "./client";
import { queueMediaDeletion } from "./media-deletions";
import { waiverRecords } from "./schema";

/**
 * **A corrected address takes every link sent to the old one with it** (#3902,
 * layer-2 review S1/S2). Called by every write that changes a person's email
 * or phone: the staff edit, a diver merge choosing the other record's
 * contact, and a contacts import overwriting one.
 *
 * Two kinds of link went to the address on file:
 *  - a booking link: a delivered one, and a course's forms link, which is
 *    mailed undelivered (#3950); both are revoked
 *    (`revokeBookingLinksSentToPerson`). A seat's release is signed on the
 *    holder's thread link (ADR 20261105-waiver-folds-into-the-thread), so this
 *    is what closes its Sign step;
 *  - an unsigned waiver link. Since #3903 a re-send hands back the same
 *    derived URL, so whoever holds the old address could still read the draft
 *    and sign as the diver. The pending record is superseded instead, and the
 *    next send mints a fresh record and link to the new address;
 *  - a signed release (final attacker review B3, security review S2). Its
 *    waiver link still opens the receipt, which says where the medical stands
 *    ("the physician did not clear you"), and on a release still waiting for
 *    a physician the doctor's page: the diver's name, the conditions behind a
 *    date of birth, and the one form upload. Every signed release's bearer
 *    link is rotated, as erasure rotates it (`token_hash` is outside both
 *    seals), and a doctor's form sent before the change, which nobody has
 *    reviewed, is withdrawn so the slot reopens for the diver. The diver
 *    reaches the page again through the thread link the re-send mails to the
 *    new address.
 *
 * Every other column of a signed release is evidence and is never touched here.
 */
export async function revokeLinksSentToOldContact(
  tx: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  await revokeBookingLinksSentToPerson(tx, { ...input, now });
  await tx
    .update(waiverRecords)
    .set({ supersededAt: now })
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.personId),
        eq(waiverRecords.status, "pending"),
        isNull(waiverRecords.supersededAt),
      ),
    );
  const signed = await tx
    .select({
      id: waiverRecords.id,
      awaitsPhysician: sql<boolean>`${waiverRecords.status} = 'medical_review'
        and ${waiverRecords.medicalClearedAt} is null
        and ${waiverRecords.medicalClearanceDeclinedAt} is null`.mapWith(Boolean),
      form: waiverRecords.diverMedicalFormUrl,
    })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.personId),
        ne(waiverRecords.status, "pending"),
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .for("update");
  for (const record of signed) {
    await tx
      .update(waiverRecords)
      .set({
        tokenHash: hashWaiverToken(createWaiverToken()),
        // Only a form nobody has reviewed: an answered record holds none.
        ...(record.awaitsPhysician
          ? { diverMedicalFormUrl: null, diverMedicalFormSentAt: null }
          : {}),
      })
      .where(eq(waiverRecords.id, record.id));
    if (record.awaitsPhysician && record.form) {
      await queueMediaDeletion(tx, {
        shopId: input.shopId,
        kind: "waiver_document",
        url: record.form,
      });
    }
  }
}

/** Whether a write changed the contact a link could have gone to. */
export function contactChanged(
  before: { email: string | null; phone: string | null },
  after: { email: string | null; phone: string | null },
): boolean {
  return before.email !== after.email || before.phone !== after.phone;
}
