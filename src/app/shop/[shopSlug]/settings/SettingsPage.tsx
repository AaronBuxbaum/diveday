import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid, PriceField } from "@/components/ui/form";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  getShopById,
  setShopAddress,
  setShopContact,
  setShopCurrency,
  setShopDepthUnit,
  setShopDockCallMinutes,
  setShopPackingList,
  setShopRentalItems,
  setShopRentalPricing,
  setShopReviewUrl,
} from "@/db/shops";
import {
  canAcceptPayments,
  disconnectShopStripeAccount,
  getShopStripeAccount,
  refreshShopStripeAccountStatus,
  stripeCurrencyMismatch,
} from "@/db/stripe-accounts";
import { currencyOptions } from "@/i18n/currency-labels";
import { catalogItemLabel, rentableItemLabel } from "@/i18n/rental-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { canExportShopData, canImportShopData, canManageMessagingSettings } from "@/lib/authz";
import { isShopCurrency, majorToMinor, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { FOUNDER_EMAIL } from "@/lib/platform-mail";
import {
  RENTABLE_ITEMS,
  type RentalPricing,
  SHOP_CATALOG_ITEMS,
  shopOffersNitrox,
  toRentableKinds,
} from "@/lib/rentals";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";

export const metadata: Metadata = { title: "Shop settings — DiveDay" };

/**
 * Built inside the request (not at module scope) because the notice text is
 * translated against the negotiated locale — a module-level constant would
 * freeze it to whichever locale first imported this file.
 */
function noticeMessages(
  t: StaffTranslator,
): Record<string, { tone: "success" | "danger" | "warning"; text: string }> {
  return {
    packing_saved: { tone: "success", text: t("settings.main.notice.packingSaved") },
    packing_invalid: { tone: "danger", text: t("settings.main.notice.packingInvalid") },
    dock_saved: { tone: "success", text: t("settings.main.notice.dockSaved") },
    dock_invalid: { tone: "danger", text: t("settings.main.notice.dockInvalid") },
    depth_unit_saved: { tone: "success", text: t("settings.main.notice.depthUnitSaved") },
    depth_unit_invalid: { tone: "danger", text: t("settings.main.notice.depthUnitInvalid") },
    currency_saved: { tone: "success", text: t("settings.main.notice.currencySaved") },
    currency_invalid: { tone: "danger", text: t("settings.main.notice.currencyInvalid") },
    rentals_saved: { tone: "success", text: t("settings.main.notice.rentalsSaved") },
    rental_prices_saved: { tone: "success", text: t("settings.main.notice.rentalPricesSaved") },
    rental_prices_invalid: {
      tone: "danger",
      text: t("settings.main.notice.rentalPricesInvalid"),
    },
    contact_saved: { tone: "success", text: t("settings.main.notice.contactSaved") },
    contact_invalid: { tone: "danger", text: t("settings.main.notice.contactInvalid") },
    address_saved: { tone: "success", text: t("settings.main.notice.addressSaved") },
    address_invalid: { tone: "danger", text: t("settings.main.notice.addressInvalid") },
    review_url_saved: { tone: "success", text: t("settings.main.notice.reviewUrlSaved") },
    review_url_invalid: { tone: "danger", text: t("settings.main.notice.reviewUrlInvalid") },
    connected: { tone: "success", text: t("settings.main.notice.connected") },
    connect_failed: { tone: "danger", text: t("settings.main.notice.connectFailed") },
    not_configured: { tone: "warning", text: t("settings.main.notice.notConfigured") },
    disconnected: { tone: "success", text: t("settings.main.notice.disconnected") },
    refreshed: { tone: "success", text: t("settings.main.notice.refreshed") },
    not_authorized: { tone: "danger", text: t("settings.main.notice.notAuthorized") },
    // Promos' own gate (`shop/[shopSlug]/promos/page.tsx`) bounces a
    // non-owner/manager here — a distinct code from `not_authorized` above
    // so it shows the promo-specific explanation rather than the rentals
    // one (task 82, UX persona 11 "Kai").
    promos_not_authorized: { tone: "danger", text: t("promos.notice.notAuthorized") },
    // Same shape and the same reason: the WhatsApp page's own gate bounces a
    // non-owner/manager here, and the payment-settings wording above would
    // explain the wrong surface.
    whatsapp_not_authorized: { tone: "danger", text: t("whatsapp.notice.not_authorized") },
  };
}

/**
 * Payment settings (Stripe Connect and the rental catalog/prices) are
 * owner/manager work (H-14, ADR 20260724-role-authorization), re-checked
 * against live roles. Returns the settings redirect target when the actor
 * lacks the gate, or null when they may proceed. The other sections here
 * (contact, packing, dock call) are ordinary shop settings any staff can edit.
 */
async function paymentSettingsBlock(session: {
  user: { shopId: string; personId: string; shopSlug: string };
}): Promise<string | null> {
  const allowed = await canPersonManagePaymentSettings(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  return allowed ? null : `/shop/${session.user.shopSlug}/settings?notice=not_authorized`;
}

const contactSchema = z.object({
  // Empty clears the field; anything else must be a real address, because this
  // one is printed on a public page for divers to write to.
  contactEmail: z.union([z.literal(""), z.email().max(200)]),
  contactPhone: z.string().trim().max(40),
});

const addressSchema = z.object({
  // Every field is optional and clears independently on empty — a shop can
  // publish just a country, or walk the whole address back to nothing.
  addressStreet: z.string().trim().max(200),
  addressLocality: z.string().trim().max(120),
  addressRegion: z.string().trim().max(120),
  addressPostalCode: z.string().trim().max(20),
  addressCountry: z.string().trim().max(2),
});

const reviewUrlSchema = z.object({
  // Empty clears it — the recap flow simply skips the review ask when unset,
  // rather than guessing a platform. z.url() alone accepts any scheme
  // (data:, mailto:, ftp:, even plain http:); this renders directly as a
  // public `target="_blank"` link on the recap page, so only https is safe.
  reviewUrl: z.union([
    z.literal(""),
    z
      .url()
      .max(500)
      .refine((value) => value.startsWith("https://"), {
        error: "Review link must start with https://",
      }),
  ]),
});

async function savePackingAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const packingList = String(formData.get("packingList") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    packingList.length < 1 ||
    packingList.length > 12 ||
    packingList.some((item) => item.length > 100)
  ) {
    redirect(`/shop/${session.user.shopSlug}/settings?notice=packing_invalid&saved=packing`);
  }
  await setShopPackingList(await getDb(), session.user.shopId, packingList);
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=packing_saved&saved=packing`,
  );
}

/**
 * Whether this shop reads depths in metres or feet. Display and entry only —
 * every stored depth stays metres, so switching back and forth is lossless and
 * no site's recorded depth moves.
 */
async function saveDepthUnitAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const parsed = z.enum(["meters", "feet"]).safeParse(formData.get("depthUnit"));
  if (!parsed.success) redirect(`${settings}?notice=depth_unit_invalid&saved=depthUnit`);
  await setShopDepthUnit(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=depth_unit_saved&saved=depthUnit`);
}

/**
 * The currency this shop displays and charges in.
 *
 * Unlike the depth unit above, this one is not lossless and the form says so:
 * stored amounts are integer minor units of whatever currency was set when
 * they were typed, and nothing is converted here. Already-settled rows keep
 * their own currency, so this only ever changes what a *future* charge and the
 * shop's own price list mean.
 *
 * Owner/manager only, re-checked here against live roles rather than trusted
 * from the section merely having rendered — this decides what a diver's card
 * is charged in.
 */
async function saveCurrencyAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(settings, blocked);
    return;
  }
  const submitted = formData.get("currency");
  // Not `toShopCurrency`: that coerces anything unknown to usd, which would
  // silently save dollars for a shop that submitted a typo. An unrecognized
  // value is a refusal.
  if (!isShopCurrency(submitted)) {
    redirect(`${settings}?notice=currency_invalid&saved=currency`);
  }
  await setShopCurrency(await getDb(), session.user.shopId, submitted);
  revalidateAndRedirect(settings, `${settings}?notice=currency_saved&saved=currency`);
}

/** How many minutes before departure divers are asked to be at the dock. */
async function saveDockCallAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const minutes = Number(formData.get("dockCallMinutes"));
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) {
    redirect(`${settings}?notice=dock_invalid&saved=dockCall`);
  }
  await setShopDockCallMinutes(await getDb(), session.user.shopId, minutes);
  revalidateAndRedirect(settings, `${settings}?notice=dock_saved&saved=dockCall`);
}

/** Which gear the shop rents. Unchecked kinds simply drop out of the catalog. */
async function saveRentalItemsAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, blocked);
    return;
  }
  const selected = SHOP_CATALOG_ITEMS.filter((item) => formData.get(item.name) === "on").map(
    (item) => item.kind,
  );
  await setShopRentalItems(await getDb(), session.user.shopId, toRentableKinds(selected));
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=rentals_saved&saved=rentals`,
  );
}

/**
 * A major-unit amount from a price box → stored minor units, or null for an
 * empty box (not priced online). Anything else — a negative, a non-number, an
 * absurd amount — is invalid so the whole save is rejected rather than
 * silently zeroed.
 *
 * The currency decides the multiplier: typing 5000 into a JPY shop's box means
 * ¥5,000 and stores 5000, not 500000 (`majorToMinor`).
 */
function parsePriceAmount(
  raw: FormDataEntryValue | null,
  currency: string,
): { ok: true; cents: number | null } | { ok: false } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, cents: null };
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > maxPriceMajor(currency)) {
    return { ok: false };
  }
  return { ok: true, cents: majorToMinor(amount, currency) };
}

/** What the shop charges for rental gear: a set price, per-piece prices, and per-dive nitrox. */
async function saveRentalPricingAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(settings, blocked);
    return;
  }
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(`${settings}?notice=rental_prices_invalid&saved=rentalPricing`);
  const currency = toShopCurrency(shop.currency);
  const set = parsePriceAmount(formData.get("setPrice"), currency);
  let invalid = !set.ok;
  const perItemCents: RentalPricing["perItemCents"] = {};
  for (const item of RENTABLE_ITEMS) {
    const parsed = parsePriceAmount(formData.get(`price_${item.name}`), currency);
    if (!parsed.ok) {
      invalid = true;
      continue;
    }
    if (parsed.cents !== null) perItemCents[item.kind] = parsed.cents;
  }
  // The nitrox price field only renders when the catalog currently offers
  // nitrox; when it doesn't, the field is absent from every submission, so
  // reading it as "clear the price" would erase a price set while nitrox was
  // still offered. Only interpret it when it could have been on the page.
  let nitroxCents = shop.rentalPricing.nitroxCents;
  if (shopOffersNitrox(shop.rentalItems)) {
    const nitrox = parsePriceAmount(formData.get("nitroxPrice"), currency);
    if (!nitrox.ok) invalid = true;
    else nitroxCents = nitrox.cents;
  }
  if (invalid || !set.ok) redirect(`${settings}?notice=rental_prices_invalid&saved=rentalPricing`);
  await setShopRentalPricing(db, session.user.shopId, {
    setCents: set.cents,
    perItemCents,
    nitroxCents,
  });
  revalidateAndRedirect(settings, `${settings}?notice=rental_prices_saved&saved=rentalPricing`);
}

/**
 * The address a diver who is not booking yet writes to. Published, so an empty
 * box is a real answer — it takes the "Get in touch" composer off the shop's
 * course pages rather than publishing a blank contact.
 */
async function saveContactAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=contact_invalid&saved=contact`);
  await setShopContact(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=contact_saved&saved=contact`);
}

/**
 * The shop's physical business address — where a diver actually meets the
 * boat or walks into the storefront. Published in structured data so search
 * engines can place the shop as a real venue; every field clears
 * independently on an empty box.
 */
async function saveAddressAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=address_invalid&saved=address`);
  await setShopAddress(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=address_saved&saved=address`);
}

/** Where the post-trip recap's "leave us a review" link sends a diver. */
async function saveReviewUrlAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const parsed = reviewUrlSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=review_url_invalid&saved=reviewLink`);
  await setShopReviewUrl(await getDb(), session.user.shopId, parsed.data.reviewUrl);
  revalidateAndRedirect(settings, `${settings}?notice=review_url_saved&saved=reviewLink`);
}

async function disconnectAction() {
  "use server";
  const session = await requireStaffSession();
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, blocked);
    return;
  }
  const db = await getDb();
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account && !account.disconnectedAt) {
    const provider = connectProviderFromEnvironment();
    await provider.deauthorize(account.stripeAccountId);
    await disconnectShopStripeAccount(db, account.stripeAccountId);
  }
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=disconnected&saved=stripe`,
  );
}

async function refreshAction() {
  "use server";
  const session = await requireStaffSession();
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, blocked);
    return;
  }
  const db = await getDb();
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account) {
    const provider = connectProviderFromEnvironment();
    const status = await provider.retrieveAccountStatus(account.stripeAccountId);
    await refreshShopStripeAccountStatus(db, account.stripeAccountId, status);
  }
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=refreshed&saved=stripe`,
  );
}

function StatusRow({
  label,
  ok,
  yesLabel,
  notYetLabel,
}: {
  label: string;
  ok: boolean;
  yesLabel: string;
  notYetLabel: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      <Badge tone={ok ? "success" : "warning"}>{ok ? yesLabel : notYetLabel}</Badge>
    </li>
  );
}

/**
 * A labelled group of settings cards with an anchor `#id` — "Your shop" /
 * "Money" / "Data & integrations" (task 154). Cards keep their own `<h3>`;
 * this is the page's real `<h2>` level, so the heading hierarchy stays
 * `<h1>` (ShopPageHeader) -> group `<h2>` -> card `<h3>`.
 */
function SettingsGroup({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-10 first:mt-0">
      <h2
        id={id}
        className="mb-4 scroll-mt-24 text-xs font-semibold tracking-[0.14em] text-muted uppercase"
      >
        {label}
      </h2>
      {children}
    </div>
  );
}

/**
 * The ten forms on this page each carry their own section id through
 * `?saved=<id>` (set by the action that redirects back here), so the notice
 * that comes back renders inside the section that changed instead of one
 * banner at the top of the page — after `PreserveFormScroll` restores the
 * scroll position to wherever that section was, a top banner is off-screen
 * and easy to miss entirely.
 */
const SECTION_IDS = [
  "contact",
  "address",
  "reviewLink",
  "packing",
  "dockCall",
  "depthUnit",
  "currency",
  "rentals",
  "rentalPricing",
  "stripe",
] as const;
type SectionId = (typeof SECTION_IDS)[number];

function SectionNotice({
  banner,
  section,
  active,
}: {
  banner: { tone: "success" | "danger" | "warning"; text: string } | undefined;
  section: SectionId;
  active: SectionId | null;
}) {
  if (!banner || active !== section) return null;
  return (
    <div className="mt-4">
      <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
        {banner.text}
      </ShopNotice>
    </div>
  );
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; saved?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, saved } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect("/");
  const offeredKinds = new Set(toRentableKinds(shop.rentalItems));
  const account = await getShopStripeAccount(db, session.user.shopId);
  const ready = canAcceptPayments(account);
  const canPayments = await canPersonManagePaymentSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  const connectConfigured = Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CONNECT_CLIENT_ID && process.env.APP_HOST,
  );
  const canImport = canImportShopData(session.user.roles);
  // Hiding the link is convenience; the page itself re-checks against live roles.
  const canManageMessaging = canManageMessagingSettings(session.user.roles);
  const canExport = canExportShopData(session.user.roles);
  const locale = await requestLocale(shop.defaultLocale);
  const shopCurrency = toShopCurrency(shop.currency);
  const currencyMismatch = stripeCurrencyMismatch(shopCurrency, account);
  const t = staffTranslator(locale);
  const banner = noticeFromParam(notice, noticeMessages(t));
  // A recognized section renders the notice inline; anything else (chiefly
  // `not_authorized`, which spans several sections rather than owning one)
  // keeps the old top-of-page banner.
  const activeSection = (SECTION_IDS as readonly string[]).includes(saved ?? "")
    ? (saved as SectionId)
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "saved"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        title={t("settings.main.title")}
        description={t("settings.main.description")}
      />

      {banner && !activeSection ? (
        <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner>
      ) : null}

      <SettingsGroup id="your-shop" label={t("settings.main.groups.yourShop")}>
        <section className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.contact.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.contact.description")}</p>
          <SectionNotice banner={banner} section="contact" active={activeSection} />
          <FieldGrid as="form" action={saveContactAction} columns={2} className="mt-4">
            <Field label={t("settings.main.contact.emailLabel")}>
              <input
                name="contactEmail"
                type="email"
                maxLength={200}
                autoComplete="email"
                defaultValue={shop.contactEmail ?? ""}
                placeholder="hello@yourshop.com"
                className={controlClass}
              />
            </Field>
            <Field
              label={t("settings.main.contact.phoneLabel")}
              hint={t("settings.main.contact.phoneHint")}
            >
              <input
                name="contactPhone"
                type="tel"
                maxLength={40}
                autoComplete="tel"
                defaultValue={shop.contactPhone ?? ""}
                placeholder="+1 305 555 0134"
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.contact.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.contact.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.address.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.address.description")}</p>
          <SectionNotice banner={banner} section="address" active={activeSection} />
          <FieldGrid as="form" action={saveAddressAction} columns={2} className="mt-4">
            <Field label={t("settings.main.address.streetLabel")} className="sm:col-span-2">
              <input
                name="addressStreet"
                type="text"
                maxLength={200}
                autoComplete="street-address"
                defaultValue={shop.addressStreet ?? ""}
                placeholder={t("settings.main.address.streetPlaceholder")}
                className={controlClass}
              />
            </Field>
            <Field label={t("settings.main.address.localityLabel")}>
              <input
                name="addressLocality"
                type="text"
                maxLength={120}
                autoComplete="address-level2"
                defaultValue={shop.addressLocality ?? ""}
                placeholder={t("settings.main.address.localityPlaceholder")}
                className={controlClass}
              />
            </Field>
            <Field label={t("settings.main.address.regionLabel")}>
              <input
                name="addressRegion"
                type="text"
                maxLength={120}
                autoComplete="address-level1"
                defaultValue={shop.addressRegion ?? ""}
                placeholder={t("settings.main.address.regionPlaceholder")}
                className={controlClass}
              />
            </Field>
            <Field label={t("settings.main.address.postalCodeLabel")}>
              <input
                name="addressPostalCode"
                type="text"
                maxLength={20}
                autoComplete="postal-code"
                defaultValue={shop.addressPostalCode ?? ""}
                placeholder={t("settings.main.address.postalCodePlaceholder")}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("settings.main.address.countryLabel")}
              hint={t("settings.main.address.countryHint")}
            >
              <input
                name="addressCountry"
                type="text"
                maxLength={2}
                autoComplete="country"
                defaultValue={shop.addressCountry ?? ""}
                placeholder={t("settings.main.address.countryPlaceholder")}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.address.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.address.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.reviewLink.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.reviewLink.description")}</p>
          <SectionNotice banner={banner} section="reviewLink" active={activeSection} />
          <FieldGrid as="form" action={saveReviewUrlAction} columns={1} className="mt-4">
            <Field
              label={t("settings.main.reviewLink.label")}
              hint={t("settings.main.reviewLink.hint")}
            >
              <input
                name="reviewUrl"
                type="url"
                maxLength={500}
                defaultValue={shop.reviewUrl ?? ""}
                placeholder="https://g.page/r/your-shop/review"
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.reviewLink.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.reviewLink.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.packing.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.packing.description")}</p>
          <SectionNotice banner={banner} section="packing" active={activeSection} />
          <form action={savePackingAction} className="mt-4">
            <textarea
              name="packingList"
              rows={6}
              maxLength={1212}
              defaultValue={shop.packingList.join("\n")}
              className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base"
            />
            <SubmitButton
              pendingLabel={t("settings.main.packing.submitting")}
              className={buttonClass({ className: "mt-3" })}
            >
              {t("settings.main.packing.submit")}
            </SubmitButton>
          </form>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.dockCall.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.dockCall.description")}</p>
          <SectionNotice banner={banner} section="dockCall" active={activeSection} />
          <FieldGrid as="form" action={saveDockCallAction} columns={2} className="mt-4">
            <Field label={t("settings.main.dockCall.label")}>
              <input
                name="dockCallMinutes"
                type="number"
                inputMode="numeric"
                min={5}
                max={180}
                step={5}
                defaultValue={shop.dockCallMinutes}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.dockCall.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.dockCall.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>

        {/* Depth is stored in metres whatever this says; the setting changes only
          how staff type it in and read it back (H-08). */}
        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.depthUnit.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.depthUnit.description")}</p>
          <SectionNotice banner={banner} section="depthUnit" active={activeSection} />
          <FieldGrid as="form" action={saveDepthUnitAction} columns={2} className="mt-4">
            <Field label={t("settings.main.depthUnit.label")}>
              <select name="depthUnit" defaultValue={shop.depthUnit} className={controlClass}>
                <option value="meters">{t("settings.main.depthUnit.meters")}</option>
                <option value="feet">{t("settings.main.depthUnit.feet")}</option>
              </select>
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.depthUnit.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.depthUnit.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>
      </SettingsGroup>

      <SettingsGroup id="money" label={t("settings.main.groups.money")}>
        <section className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.orders.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.orders.description")}</p>
          <div className="mt-4">
            <Link
              href={`/shop/${shopSlug}/orders`}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {t("settings.main.orders.cta")}
            </Link>
          </div>
        </section>

        {canPayments ? null : (
          <div className="mt-6">
            <ShopNotice tone="neutral" role="status">
              {t("settings.main.paymentsGate.notice")}
            </ShopNotice>
          </div>
        )}

        {canPayments ? (
          <>
            {/* Switching this reinterprets the shop's own price list rather than
              converting it — the description says so, because nothing else in
              this page has that property. */}
            <section className="mt-6 rounded-lg border border-border bg-surface p-6">
              <h3 className="font-medium">{t("settings.main.currency.heading")}</h3>
              <p className="mt-1 text-sm text-muted">{t("settings.main.currency.description")}</p>
              <SectionNotice banner={banner} section="currency" active={activeSection} />
              {/* What Stripe reports for the connected account is advisory, so a
                disagreement is surfaced rather than silently resolved either
                way (ADR 20260731-shop-currency). Stripe refuses a session in a
                currency the account can't settle, so this is the difference
                between a warning here and a failed checkout later. */}
              {currencyMismatch ? (
                <div className="mt-4">
                  <ShopNotice tone="warning" role="status">
                    {t("settings.main.currency.mismatch", {
                      shopCurrency: currencyMismatch.shopCurrency.toUpperCase(),
                      accountCurrency: currencyMismatch.accountCurrency.toUpperCase(),
                    })}
                  </ShopNotice>
                </div>
              ) : null}
              <FieldGrid as="form" action={saveCurrencyAction} columns={2} className="mt-4">
                <Field label={t("settings.main.currency.label")}>
                  <select
                    name="currency"
                    defaultValue={toShopCurrency(shop.currency)}
                    className={controlClass}
                  >
                    {currencyOptions(locale).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("settings.main.currency.submitting")}
                    className={buttonClass()}
                  >
                    {t("settings.main.currency.submit")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
            </section>

            <section className="mt-6 rounded-lg border border-border bg-surface p-6">
              <h3 className="font-medium">{t("settings.main.rentals.heading")}</h3>
              <p className="mt-1 text-sm text-muted">{t("settings.main.rentals.description")}</p>
              <SectionNotice banner={banner} section="rentals" active={activeSection} />
              <form action={saveRentalItemsAction} className="mt-4">
                <fieldset>
                  <legend className="sr-only">{t("settings.main.rentals.legend")}</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SHOP_CATALOG_ITEMS.map((item) => (
                      <label
                        key={item.kind}
                        className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                      >
                        <input
                          name={item.name}
                          type="checkbox"
                          defaultChecked={offeredKinds.has(item.kind)}
                          className="size-4 accent-primary"
                        />
                        {catalogItemLabel(t, item.kind)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <SubmitButton
                  pendingLabel={t("settings.main.rentals.submitting")}
                  className={buttonClass({ className: "mt-3" })}
                >
                  {t("settings.main.rentals.submit")}
                </SubmitButton>
              </form>
            </section>

            <section className="mt-6 rounded-lg border border-border bg-surface p-6">
              <h3 className="font-medium">{t("settings.main.rentalPricing.heading")}</h3>
              <p className="mt-1 text-sm text-muted">
                {t("settings.main.rentalPricing.description")}
              </p>
              <SectionNotice banner={banner} section="rentalPricing" active={activeSection} />
              <form action={saveRentalPricingAction} className="mt-4">
                <FieldGrid columns={2}>
                  <PriceField
                    name="setPrice"
                    label={t("settings.main.rentalPricing.fullSetLabel")}
                    hint={t("settings.main.rentalPricing.fullSetHint")}
                    cents={shop.rentalPricing.setCents}
                    currency={shopCurrency}
                    locale={locale}
                  />
                  {RENTABLE_ITEMS.filter((item) => offeredKinds.has(item.kind)).map((item) => (
                    <PriceField
                      key={item.kind}
                      name={`price_${item.name}`}
                      label={rentableItemLabel(t, item.kind)}
                      cents={shop.rentalPricing.perItemCents[item.kind] ?? null}
                      currency={shopCurrency}
                      locale={locale}
                    />
                  ))}
                  {offeredKinds.has("nitrox") ? (
                    <PriceField
                      name="nitroxPrice"
                      label={t("settings.main.rentalPricing.nitroxLabel")}
                      hint={t("settings.main.rentalPricing.nitroxHint")}
                      cents={shop.rentalPricing.nitroxCents}
                      currency={shopCurrency}
                      locale={locale}
                    />
                  ) : null}
                </FieldGrid>
                <SubmitButton
                  pendingLabel={t("settings.main.rentalPricing.submitting")}
                  className={buttonClass({ className: "mt-4" })}
                >
                  {t("settings.main.rentalPricing.submit")}
                </SubmitButton>
              </form>
            </section>

            <section className="mt-6 rounded-lg border border-border bg-surface p-6">
              <SectionNotice banner={banner} section="stripe" active={activeSection} />
              {!account ? (
                <div>
                  <h3 className="font-medium">{t("settings.main.stripe.notConnectedHeading")}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {t("settings.main.stripe.notConnectedDescription")}
                  </p>
                  {connectConfigured ? (
                    <Link
                      href={`/shop/${shopSlug}/settings/connect`}
                      className={buttonClass({ className: "mt-4" })}
                    >
                      {t("settings.main.stripe.connect")}
                    </Link>
                  ) : (
                    <p className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
                      {t("settings.main.stripe.notConfiguredWarning", { email: FOUNDER_EMAIL })}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-medium">
                      {account.disconnectedAt
                        ? t("settings.main.stripe.disconnectedHeading")
                        : t("settings.main.stripe.connectedHeading")}
                    </h3>
                    <Badge tone={ready ? "success" : "warning"}>
                      {ready
                        ? t("settings.main.stripe.readyBadge")
                        : t("settings.main.stripe.notReadyBadge")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {t("settings.main.stripe.accountEnding", {
                      last6: account.stripeAccountId.slice(-6),
                    })}
                  </p>
                  <ul className="mt-4 divide-y divide-border">
                    <StatusRow
                      label={t("settings.main.stripe.chargesEnabled")}
                      ok={account.chargesEnabled}
                      yesLabel={t("settings.main.stripe.statusYes")}
                      notYetLabel={t("settings.main.stripe.statusNotYet")}
                    />
                    <StatusRow
                      label={t("settings.main.stripe.payoutsEnabled")}
                      ok={account.payoutsEnabled}
                      yesLabel={t("settings.main.stripe.statusYes")}
                      notYetLabel={t("settings.main.stripe.statusNotYet")}
                    />
                    <StatusRow
                      label={t("settings.main.stripe.onboardingSubmitted")}
                      ok={account.detailsSubmitted}
                      yesLabel={t("settings.main.stripe.statusYes")}
                      notYetLabel={t("settings.main.stripe.statusNotYet")}
                    />
                  </ul>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    {account.disconnectedAt ? (
                      connectConfigured ? (
                        <Link href={`/shop/${shopSlug}/settings/connect`} className={buttonClass()}>
                          {t("settings.main.stripe.reconnect")}
                        </Link> // i18n-exempt: JSX ternary punctuation below, not copy — scanner false positive.
                      ) : null
                    ) : (
                      <>
                        <form action={refreshAction}>
                          <SubmitButton
                            pendingLabel={t("settings.main.stripe.refreshing")}
                            className={buttonClass({
                              variant: "secondary",
                              className: "text-foreground",
                            })}
                          >
                            {t("settings.main.stripe.refresh")}
                          </SubmitButton>
                        </form>
                        <form action={disconnectAction}>
                          <SubmitButton
                            pendingLabel={t("settings.main.stripe.disconnecting")}
                            className={buttonClass({ variant: "danger" })}
                          >
                            {t("settings.main.stripe.disconnect")}
                          </SubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        ) : null}
      </SettingsGroup>

      <SettingsGroup id="data-integrations" label={t("settings.main.groups.dataIntegrations")}>
        <section className="rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.embed.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.embed.description")}</p>
          <div className="mt-4">
            <Link
              href={`/shop/${shopSlug}/settings/embed`}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {t("settings.main.embed.cta")}
            </Link>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("settings.main.calendar.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("settings.main.calendar.description")}</p>
          <div className="mt-4">
            <Link
              href={`/shop/${shopSlug}/settings/calendar`}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {t("settings.main.calendar.cta")}
            </Link>
          </div>
        </section>

        {/* Owner/manager only, like the payment section above: the credential it
            stores can send messages as the business. */}
        {canManageMessaging ? (
          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <h3 className="font-medium">{t("settings.main.whatsapp.heading")}</h3>
            <p className="mt-1 text-sm text-muted">{t("settings.main.whatsapp.description")}</p>
            <div className="mt-4">
              <Link
                href={`/shop/${shopSlug}/settings/whatsapp`}
                className={buttonClass({ variant: "secondary", className: "text-foreground" })}
              >
                {t("settings.main.whatsapp.cta")}
              </Link>
            </div>
          </section>
        ) : null}

        {canImport || canExport ? (
          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <h3 className="font-medium">{t("settings.main.data.heading")}</h3>
            <p className="mt-1 text-sm text-muted">{t("settings.main.data.description")}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {canImport ? (
                <Link
                  href={`/shop/${shopSlug}/settings/import`}
                  className={buttonClass({ variant: "secondary", className: "text-foreground" })}
                >
                  {t("settings.main.data.importCta")}
                </Link>
              ) : null}
              {canExport ? (
                <Link
                  href={`/shop/${shopSlug}/settings/export`}
                  className={buttonClass({ variant: "secondary", className: "text-foreground" })}
                >
                  {t("settings.main.data.exportCta")}
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}
      </SettingsGroup>

      <footer className="mt-12 border-t border-border pt-6 text-sm text-muted">
        <p>{t("settings.main.founder.description")}</p>
        <a href={`mailto:${FOUNDER_EMAIL}`} className="font-medium text-primary hover:underline">
          {t("settings.main.founder.emailCta", { email: FOUNDER_EMAIL })}
        </a>
      </footer>
    </main>
  );
}
