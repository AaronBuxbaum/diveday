import { z } from "zod";
import { parseBrandColor } from "@/lib/brand";
import { shopAddressLines } from "@/lib/shop-address";
import { shopNameUnderReview } from "@/lib/shop-name-review";
import { isManagedStorageUrl } from "@/lib/storage/blob-host";
import { publicAppUrl } from "./app-url";
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
  /** `shops.contact_phone`, the number the shop publishes; ends every shop email (B31). */
  contactPhone?: string | null;
  /** Null until the shop opened the confirmation link sent to `contactEmail` (issue #1288). */
  contactEmailConfirmedAt: Date | null;
  addressStreet: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  /** `shops.is_demo`: its seeded people's mail goes to the SES simulator. */
  isDemo?: boolean;
  /** `shops.name_flagged_at` and `name_cleared_at`: the name is held for review (#2450). */
  nameFlaggedAt?: Date | null;
  nameClearedAt?: Date | null;
  /** `shops.logo_url`: a first-party storage URL, or a path on DiveDay's own origin. */
  logoUrl?: string | null;
  /** `shops.brand_color`, `#rrggbb`. */
  brandColor?: string | null;
};

/**
 * The shop's logo as a URL a mail client can fetch, or null.
 *
 * Only two shapes pass, and both are DiveDay's own: a URL our managed storage
 * produced (`isManagedStorageUrl`, the same predicate that guards every other
 * media decision), or a root-relative path resolved against the public app
 * origin (the demo shop's logo is one). Anything else — a third-party host, a
 * `//` scheme-relative URL, a path with no configured origin to put it on — is
 * dropped, because an `<img>` in an email is a request the diver's own client
 * makes to that host, and nobody but DiveDay gets to be that host.
 */
export function emailLogoUrl(
  logoUrl: string | null | undefined,
  env: NotificationEnvironment = process.env,
): string | null {
  const value = logoUrl?.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) {
    const origin = publicAppUrl(env);
    if (!origin?.startsWith("https://")) return null;
    return new URL(value, `${origin}/`).toString();
  }
  return isManagedStorageUrl(value, env) ? value : null;
}

const replyToSchema = z.email().max(200);

/**
 * The shop's contact address **when DiveDay may actually send to it**: null
 * until somebody opened the one-time link sent there (issue #1288).
 *
 * One function, so every consumer that puts diver information *into* that
 * mailbox asks the same question: `shopSenderOf`'s front-desk `Reply-To`
 * fallback, and the date-request/course-inquiry send
 * (`src/app/actions/inquiry.ts`), which pushes a diver's details to the box
 * unprompted.
 *
 * Delivery starts at the save (#4061): the person saving it is the shop's own
 * owner or manager writing the shop's own address. `contactEmailConfirmedAt`
 * is a badge on the settings page, not a gate.
 */
export function deliverableShopContactEmail(shop: {
  contactEmail: string | null;
  contactEmailConfirmedAt: Date | null;
}): string | null {
  const parsed = replyToSchema.safeParse(shop.contactEmail?.trim());
  return parsed.success ? parsed.data : null;
}

/**
 * `Reply-To` and the postal footer, from what the shop has on file.
 *
 * `Reply-To` is the shop's inbound address (`reply+<token>@<inbound domain>`)
 * whenever one is configured (ADR 20260907-two-way-inbox, amending
 * 20260902-sender-standards-for-ses), so a reply lands in the shop's inbox on
 * the diver's record. Only when no inbound address exists (inbound mail
 * switched off with `EMAIL_INBOUND_DOMAIN=`) does the front-desk address stand
 * in, and then only if it is valid and **confirmed**
 * (`deliverableShopContactEmail`): replies often carry the medical or contact
 * detail a waiver or readiness email asked for, and must not reach a typo or
 * an address the shop does not control.
 *
 * `undefined` when there is nothing: a shop with no front-desk address and no
 * street is legitimate, and the mail goes out without a guessed inbox or an
 * empty line. A value the notification schema would refuse (an unparsable
 * `contact_email`, or address fields joining to more than 300 characters) is
 * dropped rather than carried, since it would throw inside `notify()` on every
 * send for that shop.
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
  const logoUrl = notificationSenderSchema.shape.logoUrl.safeParse(
    emailLogoUrl(shop.logoUrl, env) ?? undefined,
  );
  const brandColor = parseBrandColor(shop.brandColor).value;
  const contactPhone = notificationSenderSchema.shape.contactPhone.safeParse(
    shop.contactPhone?.trim() || undefined,
  );
  const contactEmail = deliverableShopContactEmail(shop);
  const sender: NotificationSender = {
    ...(replyTo && { replyTo }),
    ...(postalAddress.success && postalAddress.data && { postalAddress: postalAddress.data }),
    ...(shop.isDemo === true && { demoShop: true as const }),
    ...(shopNameUnderReview({
      nameFlaggedAt: shop.nameFlaggedAt ?? null,
      nameClearedAt: shop.nameClearedAt ?? null,
    }) && { nameUnderReview: true as const }),
    ...(logoUrl.success && logoUrl.data && { logoUrl: logoUrl.data }),
    ...(brandColor && { brandColor }),
    ...(contactPhone.success && contactPhone.data && { contactPhone: contactPhone.data }),
    ...(contactEmail && { contactEmail }),
  };
  return Object.keys(sender).length > 0 ? sender : undefined;
}
