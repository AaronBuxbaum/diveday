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
  addressStreet: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
};

const replyToSchema = z.email().max(200);

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
 */
export function shopSenderOf(shop: ShopSenderSource): NotificationSender | undefined {
  const replyTo = replyToSchema.safeParse(shop.contactEmail?.trim());
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
    ...(replyTo.success && { replyTo: replyTo.data }),
    ...(postalAddress.success && postalAddress.data && { postalAddress: postalAddress.data }),
  };
  return Object.keys(sender).length > 0 ? sender : undefined;
}
