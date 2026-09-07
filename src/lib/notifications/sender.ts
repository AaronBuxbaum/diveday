import { z } from "zod";
import { shopAddressLines } from "@/lib/shop-address";
import { shopInboundReplyAddress } from "./inbound-address";
import { type NotificationSender, notificationSenderSchema } from "./kinds";
import type { NotificationEnvironment } from "./provider";

/**
 * The shop-row columns that become a notification's `sender` profile
 * (ADR 20260902-sender-standards-for-ses). Named after `shops` so a caller
 * holding the row passes it straight through.
 */
export type ShopSenderSource = {
  /**
   * The token in the shop's inbound reply address (ADR 20260907-two-way-inbox).
   * Optional only so a caller holding a partial row can still ask for the
   * postal footer; every shop row carries one.
   */
  inboundEmailToken?: string | null;
  contactEmail: string | null;
  /** Null until the shop opened the confirmation link sent to `contactEmail` (issue #1288). */
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
 * **`Reply-To` is the shop's inbound address** — `reply+<token>@<inbound
 * domain>` — whenever inbound mail is switched on (ADR 20260907-two-way-inbox,
 * amending 20260902-sender-standards-for-ses). A diver who hits reply then
 * lands in the shop's own inbox on their record, in the channel they wrote in,
 * rather than in a front-desk mailbox the app cannot see. The confirmed
 * front-desk address is the fallback for a deployment that switched inbound
 * mail off (`EMAIL_INBOUND_DOMAIN=`), and it keeps its proof-of-ownership rule
 * there: an unconfirmed one is absent, exactly as before.
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
 * `Reply-To` only from a **confirmed** address: the shop has to have opened the
 * link sent to it (`shops.contact_email_confirmed_at`, issue #1288). Until
 * then a manager's typo, or an address they do not control, would have every
 * diver's reply -- often carrying the medical or contact detail a waiver or
 * readiness email asked for -- routed to a stranger. An unconfirmed address is
 * simply absent here, exactly as if none were on file.
 */
export function shopSenderOf(
  shop: ShopSenderSource,
  env: NotificationEnvironment = process.env,
): NotificationSender | undefined {
  const inboundAddress = shop.inboundEmailToken
    ? shopInboundReplyAddress(shop.inboundEmailToken, env)
    : undefined;
  const replyTo = inboundAddress ?? deliverableShopContactEmail(shop);
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
