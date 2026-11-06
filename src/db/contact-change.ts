import { nowDate } from "@/lib/clock";
import { revokeBookingLinksSentToPerson } from "./booking-capabilities";
import { revokePersonReleaseLinks } from "./capabilities";
import type { DbExecutor } from "./client";
import { retireRecapLinks } from "./recap-links";

/**
 * **A replaced address takes every link sent to the old one with it** (#3902,
 * layer-2 review S1/S2). Called by every write that replaces a person's email
 * or phone (`contactReplaced`): the staff edit, a diver merge choosing the
 * other record's contact, and a contacts import overwriting one.
 *
 * Every kind of link that went to the address on file:
 *  - a booking link: a delivered one, and a course's forms link, which is
 *    mailed undelivered (#3950); both are revoked
 *    (`revokeBookingLinksSentToPerson`). A seat's release is signed on the
 *    holder's thread link (ADR 20261105-waiver-folds-into-the-thread), so this
 *    is what closes its Sign step;
 *  - a recap link (issue #3982): a signed booking id that lives 180 days.
 *    The epoch it signs moves on for every one of the person's bookings
 *    (`retireRecapLinks`), so the old one opens no recap;
 *  - a link to one of the person's releases: a release link mailed or texted
 *    to the old contact, or a counter link handed over before the
 *    correction (issue #3983). Every one is revoked, so it opens nothing,
 *    not even the receipt of a release it already signed.
 *
 * Only the links go (#4057). An unsigned release keeps its draft and a form
 * sent for a physician stays for staff to review: the next send opens the
 * same release on a fresh link, and the boarding gate still reads it. A write
 * in flight through the old link is refused by its own check that the
 * contact it read is still the one on file (`attachDiverMedicalForm`).
 * Links carry no channel, so a replaced phone also closes an emailed link.
 */
export async function revokeLinksSentToOldContact(
  tx: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  await revokeBookingLinksSentToPerson(tx, { ...input, now });
  await revokePersonReleaseLinks(tx, { ...input, now });
  await retireRecapLinks(tx, input);
}

/**
 * Whether a write replaced a contact a link could have gone to: an address on
 * file changed or cleared. Adding one where there was none replaces nothing
 * (#4057).
 */
export function contactReplaced(
  before: { email: string | null; phone: string | null },
  after: { email: string | null; phone: string | null },
): boolean {
  const replaced = (old: string | null, next: string | null) => old !== null && old !== next;
  return replaced(before.email, after.email) || replaced(before.phone, after.phone);
}
