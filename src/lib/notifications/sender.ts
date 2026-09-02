import { z } from "zod";
import { shopAddressLines } from "@/lib/shop-address";
import { type NotificationSender, notificationSenderSchema } from "./kinds";

/**
 * The shop-row columns that become a notification's `sender` profile
 * (ADR 20260902-sender-standards-for-ses). Named after `shops` so a caller
 * holding the row passes it straight through.
 */
export type ShopSenderSource = {
  contactEmail: string | null;
  /**
   * When somebody proved the shop controls that address. Null gates `replyTo`
   * off — see the note on the `replyTo` line below.
   */
  contactEmailConfirmedAt: Date | null;
  addressStreet: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
};

const replyToSchema = z.email().max(200);

/**
 * The shop's contact address **when DiveDay may actually send to it** — null
 * until somebody opened the one-time link sent there (issue #1288).
 *
 * One function, so that every consumer that puts diver information *into* that
 * mailbox asks the same question. `shopSenderOf` below is one caller; the other
 * is the date-request/course-inquiry send (`src/app/actions/inquiry.ts`), which
 * is the stronger case of the two: a `Reply-To` only leaks if a diver hits
 * reply, while that mail pushes a diver's name, address, phone, experience and
 * free text to whatever string is in the box, unprompted, from a public page.
 *
 * **Not for display.** `shops.contact_email` is published on the shop's own
 * pages and always has been; confirming changes nothing about that. What waits
 * for proof is *delivery*.
 */
export function deliverableShopContactEmail(shop: {
  contactEmail: string | null;
  contactEmailConfirmedAt: Date | null;
}): string | null {
  if (!shop.contactEmailConfirmedAt) return null;
  const parsed = replyToSchema.safeParse(shop.contactEmail?.trim());
  return parsed.success ? parsed.data : null;
}

/**
 * `Reply-To` and the postal footer, from what the shop has on file.
 *
 * `undefined` when there is nothing: a shop with no front-desk address and no
 * street is a legitimate state, and the mail then goes out exactly as it did
 * before rather than with a guessed inbox or an empty line. A value the
 * notification schema would refuse is dropped rather than carried: a
 * `contact_email` that does not parse as an address, or an address whose five
 * fields (the settings form allows ~470 characters between them) join to more
 * than the schema's 300. Either would otherwise throw inside `notify()` on
 * every send for that shop -- booking confirmations included -- for the sake
 * of a header or a footer line (security review finding on this change).
 *
 * **`replyTo` additionally waits for `contact_email_confirmed_at`** (issue
 * #1288). The address is a manager's claim until somebody opens the link sent
 * to it, and *routing* a diver's reply somewhere is a different act from
 * *displaying* the address on a public page, which this app has always done. A
 * diver answering a waiver or a readiness email writes back medical and contact
 * details; a typo, or a manager who fills in somebody else's address, would
 * send every one of those to a third party. An unconfirmed shop sends exactly
 * as it did before the header existed — no `Reply-To`, never a failed send.
 * The postal footer is unaffected: an address is not a destination.
 */
export function shopSenderOf(shop: ShopSenderSource): NotificationSender | undefined {
  const replyTo = deliverableShopContactEmail(shop);
  const postalAddress = notificationSenderSchema.shape.postalAddress.safeParse(
    shopAddressLines({
      street: shop.addressStreet,
      locality: shop.addressLocality,
      region: shop.addressRegion,
      postalCode: shop.addressPostalCode,
      country: shop.addressCountry,
    }).join(", ") || undefined,
  );
  const sender: NotificationSender = {
    ...(replyTo && { replyTo }),
    ...(postalAddress.success && postalAddress.data && { postalAddress: postalAddress.data }),
  };
  return Object.keys(sender).length > 0 ? sender : undefined;
}
