import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { revokeBookingLinksSentToPerson } from "./booking-capabilities";
import { revokePersonReleaseLinks } from "./capabilities";
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
 *  - a link to one of the person's releases: a release link mailed or texted
 *    to the old contact, or a counter link handed over before the
 *    correction (issue #3983). Every one is revoked, so it opens nothing: not
 *    a form, and not the receipt of a release it already signed, which says
 *    where the medical stands ("the physician did not clear you"). The
 *    unsigned release is superseded too, and the next send opens a fresh one
 *    and mails its link to the new address;
 *  - a signed release's doctor's page (final attacker review B3, security
 *    review S2): on a release still waiting for a physician, the diver's name,
 *    the conditions behind a date of birth, and the one form upload. It is
 *    reached on the thread link, revoked above; a doctor's form sent before
 *    the change, which nobody has reviewed, is withdrawn so the slot reopens
 *    for the diver, and a write in flight through the old link is refused by
 *    its own check that the contact it read is still the one on file
 *    (`attachDiverMedicalForm`).
 *
 * Every other column of a signed release is evidence and is never touched here.
 */
export async function revokeLinksSentToOldContact(
  tx: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  await revokeBookingLinksSentToPerson(tx, { ...input, now });
  await revokePersonReleaseLinks(tx, { ...input, now });
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
  // Only a form nobody has reviewed: an answered record holds none.
  const awaiting = await tx
    .select({ id: waiverRecords.id, form: waiverRecords.diverMedicalFormUrl })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.personId),
        eq(waiverRecords.status, "medical_review"),
        isNull(waiverRecords.medicalClearedAt),
        isNull(waiverRecords.medicalClearanceDeclinedAt),
        isNull(waiverRecords.anonymizedAt),
        isNotNull(waiverRecords.diverMedicalFormSentAt),
      ),
    )
    .for("update");
  for (const record of awaiting) {
    await tx
      .update(waiverRecords)
      .set({ diverMedicalFormUrl: null, diverMedicalFormSentAt: null })
      .where(eq(waiverRecords.id, record.id));
    if (record.form) {
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
