import { and, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { revokeDeliveredBookingLinksForPerson } from "./booking-capabilities";
import type { DbExecutor } from "./client";
import { waiverRecords } from "./schema";

/**
 * **A corrected address takes every link sent to the old one with it** (#3902,
 * layer-2 review S1/S2). Called by every write that changes a person's email
 * or phone: the staff edit, a diver merge choosing the other record's
 * contact, and a contacts import overwriting one.
 *
 * Two kinds of link went to the address on file:
 *  - a delivered booking link, which is revoked;
 *  - an unsigned waiver link. Since #3903 a re-send hands back the same
 *    derived URL, so whoever holds the old address could still read the draft
 *    and sign as the diver. The pending record is superseded instead, and the
 *    next send mints a fresh record and link to the new address.
 *
 * A signed release is evidence and is never touched here.
 */
export async function revokeLinksSentToOldContact(
  tx: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  await revokeDeliveredBookingLinksForPerson(tx, { ...input, now });
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
}

/** Whether a write changed the contact a link could have gone to. */
export function contactChanged(
  before: { email: string | null; phone: string | null },
  after: { email: string | null; phone: string | null },
): boolean {
  return before.email !== after.email || before.phone !== after.phone;
}
