import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { FlashParams } from "@/components/FlashParams";
import { JumpNav } from "@/components/JumpNav";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { TimezoneOptions, type TimezoneZoneLabels } from "@/components/TimezoneOptions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid, PriceField } from "@/components/ui/form";
import { InfoHint } from "@/components/ui/InfoHint";
import { canPersonManagePaymentSettings, canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  canAcceptPayments,
  getShopStripeAccount,
  stripeCurrencyMismatch,
} from "@/db/stripe-accounts";
import { currencyOptions } from "@/i18n/currency-labels";
import { catalogItemLabel, rentableItemLabel } from "@/i18n/rental-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { isAddressLookupConfigured } from "@/lib/address-lookup";
import {
  canExportShopData,
  canImportShopData,
  canManageMessagingSettings,
  canManageStaffAccounts,
  canViewShopReports,
} from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { SUPPORT_EMAIL, UPGRADE_EMAIL } from "@/lib/platform-mail";
import { RENTABLE_ITEMS, SHOP_CATALOG_ITEMS, toRentableKinds } from "@/lib/rentals";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  type CuratedTimeZone,
  type CuratedTimezoneGroupKey,
  DEFAULT_TIMEZONE,
} from "@/lib/timezones";
import { isTrialExpired, trialDaysRemaining, trialEndsAt } from "@/lib/trial";
import { AddressFields } from "./AddressFields";
import {
  disconnectAction,
  refreshAction,
  saveAddressAction,
  saveContactAction,
  saveDockCallAction,
  savePackingAction,
  saveRentalItemsAction,
  saveRentalPricingAction,
  saveReviewUrlAction,
  saveTimezoneAction,
  saveUnitsAction,
} from "./actions";

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
    timezone_saved: { tone: "success", text: t("settings.main.notice.timezoneSaved") },
    timezone_invalid: { tone: "danger", text: t("settings.main.notice.timezoneInvalid") },
    dock_saved: { tone: "success", text: t("settings.main.notice.dockSaved") },
    dock_invalid: { tone: "danger", text: t("settings.main.notice.dockInvalid") },
    units_saved: { tone: "success", text: t("settings.main.notice.unitsSaved") },
    units_invalid: { tone: "danger", text: t("settings.main.notice.unitsInvalid") },
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
    // Team and Import are the last two Settings sub-pages whose gate used to
    // teleport a refused staffer to Today saying nothing at all. Same rule as
    // the four above: bounce to the nearest parent surface with a code it
    // handles (task 82).
    team_not_authorized: { tone: "danger", text: t("settings.team.notice.notAuthorized") },
    import_not_authorized: { tone: "danger", text: t("settings.import.notice.notAuthorized") },
    // Backups hold the same bar as the export download — the destination
    // receives the whole shop, medical evidence included — and the same
    // bounce-with-an-explanation rule as every gate above.
    backup_not_authorized: { tone: "danger", text: t("backup.notice.not_authorized") },
  };
}

/**
 * The words for the timezone picker's structure. `src/lib/timezones.ts` hands
 * back zone ids and group keys — data with no language in it — and this is
 * where those become headings, the same division every other domain-layer code
 * in this file goes through. Sign-up has its own copy of this map against the
 * *diver* bundle (src/app/onboard/page.tsx): the two pages speak to different
 * audiences, and the structure they share lives in `TimezoneOptions`.
 */
const TIMEZONE_GROUP_KEYS: Record<CuratedTimezoneGroupKey | "allZones", StaffMessageKey> = {
  americas: "settings.main.timezone.groups.americas",
  caribbean: "settings.main.timezone.groups.caribbean",
  europeRedSea: "settings.main.timezone.groups.europeRedSea",
  asiaPacific: "settings.main.timezone.groups.asiaPacific",
  allZones: "settings.main.timezone.groups.allZones",
};

/**
 * A curated zone's label — how a shop owner names the place rather than how
 * IANA does ("Cancún / Cozumel", not "America/Cancun"). Only the pinned
 * shortcuts get one; every other zone reads as its own id, which needs no
 * translation and cannot drift from what gets stored.
 */
const CURATED_TIMEZONE_KEYS: Record<CuratedTimeZone, StaffMessageKey> = {
  "America/New_York": "settings.main.timezone.zones.eastern",
  "America/Chicago": "settings.main.timezone.zones.central",
  "America/Denver": "settings.main.timezone.zones.mountain",
  "America/Los_Angeles": "settings.main.timezone.zones.pacific",
  "Pacific/Honolulu": "settings.main.timezone.zones.hawaii",
  "America/Cancun": "settings.main.timezone.zones.cancun",
  "America/Belize": "settings.main.timezone.zones.belize",
  "America/Tegucigalpa": "settings.main.timezone.zones.roatan",
  "America/Cayman": "settings.main.timezone.zones.cayman",
  "America/Nassau": "settings.main.timezone.zones.nassau",
  "America/Puerto_Rico": "settings.main.timezone.zones.puertoRico",
  "America/Curacao": "settings.main.timezone.zones.bonaire",
  "Europe/London": "settings.main.timezone.zones.london",
  "Africa/Cairo": "settings.main.timezone.zones.cairo",
  "Indian/Maldives": "settings.main.timezone.zones.maldives",
  "Asia/Bangkok": "settings.main.timezone.zones.bangkok",
  "Asia/Jakarta": "settings.main.timezone.zones.jakarta",
  "Asia/Singapore": "settings.main.timezone.zones.singapore",
  "Asia/Makassar": "settings.main.timezone.zones.bali",
  "Asia/Manila": "settings.main.timezone.zones.manila",
  "Pacific/Palau": "settings.main.timezone.zones.palau",
  "Pacific/Fiji": "settings.main.timezone.zones.fiji",
  "Australia/Sydney": "settings.main.timezone.zones.sydney",
  "Pacific/Auckland": "settings.main.timezone.zones.auckland",
};

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
 * The page's three groups, in render order — "Your shop" / "Money" / "Data &
 * integrations" (task 154). One list rather than three literals so the
 * `JumpNav` this page feeds and the `<h2 id>` it targets cannot disagree: the
 * anchors existed for a release with nothing linking them, which is how a
 * 7,000px page ends up with no way down it but the scrollbar.
 */
export const SETTINGS_GROUPS = [
  { id: "your-shop", labelKey: "settings.main.groups.yourShop" },
  { id: "money", labelKey: "settings.main.groups.money" },
  { id: "data-integrations", labelKey: "settings.main.groups.dataIntegrations" },
] as const satisfies readonly { id: string; labelKey: StaffMessageKey }[];

type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];

const [YOUR_SHOP_GROUP, MONEY_GROUP, DATA_GROUP] = SETTINGS_GROUPS;

/**
 * A labelled group of settings cards with an anchor `#id`. Cards keep their own
 * `<h3>`; this is the page's real `<h2>` level, so the heading hierarchy stays
 * `<h1>` (ShopPageHeader) -> group `<h2>` -> card `<h3>`.
 */
export function SettingsGroup({
  group,
  label,
  children,
}: {
  group: SettingsGroupSpec;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-10 first:mt-0">
      <h2
        id={group.id}
        className="mb-4 scroll-mt-24 text-xs font-semibold tracking-[0.14em] text-muted uppercase"
      >
        {label}
      </h2>
      {children}
    </div>
  );
}

/**
 * A settings card's heading and its one-line description, with the long form of
 * the explanation tucked behind the marker next to the heading.
 *
 * Every card used to carry its full rationale on screen — which unit a value is
 * stored in, what a change does and does not convert, which other surfaces it
 * appears on. A shop that opened Settings to change one box read four
 * paragraphs of it first. The short line says what the card is for; `detail`
 * holds everything that is only interesting once (see `InfoHint`).
 */
function CardHeading({
  t,
  heading,
  description,
  detail,
}: {
  t: StaffTranslator;
  heading: string;
  description: string;
  /** Omit on a card whose description is already one short line. */
  detail?: string;
}) {
  return (
    <>
      <h3 className="flex items-start gap-2 font-medium">
        {heading}
        {detail ? (
          <InfoHint
            label={t("settings.main.detailLabel", { heading })}
            detail={detail}
            className="mt-0.5"
          />
        ) : null}
      </h3>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </>
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
  "timezone",
  "contact",
  "address",
  "reviewLink",
  "packing",
  "dockCall",
  "units",
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
      <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)}>
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
  // Every card on this page changes the shop rather than the day, so the page
  // itself is owner/manager work (src/lib/authz.ts — canManageShopSettings),
  // checked against live roles. Bounced to Today with an explanatory notice
  // rather than teleporting silently, exactly like the export and import pages
  // below it. `/settings/calendar` is deliberately outside this gate: a staff
  // calendar subscription is a personal feed, not shop policy.
  if (!(await canPersonManageShopSettings(db, session.user.shopId, session.user.personId))) {
    redirect(`/shop/${session.user.shopSlug}?notice=settings_not_authorized`);
  }
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
  // The same two gates the nav registry hangs Team and Promo codes off
  // (src/lib/staff-destinations.ts), so a divemaster who has neither is never
  // shown a door that would bounce them (ADR
  // 20260724-role-gated-surfaces-hide-not-explain). Both pages re-check.
  const canManageTeam = canManageStaffAccounts(session.user.roles);
  const canManagePromos = canViewShopReports(session.user.roles);
  // Trial timing is owner-grade information the same way the monthly report
  // is — the daily crew has no reason to see it, and a demo shop isn't a
  // trial at all (ADR 20260720-trial-shops-are-not-demo).
  const canViewTrialStatus = !shop.isDemo && canViewShopReports(session.user.roles);
  const locale = await requestLocale(shop.defaultLocale);
  const shopCurrency = toShopCurrency(shop.currency);
  const addressLookupEnabled = isAddressLookupConfigured();
  const currencyMismatch = stripeCurrencyMismatch(shopCurrency, account);
  const t = staffTranslator(locale);
  const trialDaysLeft = trialDaysRemaining(shop.createdAt, nowDate());
  const trialExpired = isTrialExpired(shop.createdAt, nowDate());
  const trialEndLabel = formatShortDate(trialEndsAt(shop.createdAt), locale, shop.timezone);
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

      <JumpNav
        ariaLabel={t("settings.main.jump.label")}
        items={SETTINGS_GROUPS.map((group) => ({ id: group.id, label: t(group.labelKey) }))}
        className="-mt-2"
      />

      {banner && !activeSection ? (
        <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner>
      ) : null}

      <SettingsGroup group={YOUR_SHOP_GROUP} label={t(YOUR_SHOP_GROUP.labelKey)}>
        {/* Who works here comes first: an owner opening Settings to add a
            colleague used to find no door to Team anywhere on this page — only
            the nav's "Set up" menu and ⌘K knew it existed. */}
        {canManageTeam ? (
          <section className="mb-6 rounded-lg border border-border bg-surface p-6">
            <CardHeading
              t={t}
              heading={t("settings.main.team.heading")}
              description={t("settings.main.team.description")}
            />
            <div className="mt-4">
              <Link
                href={`/shop/${shopSlug}/settings/team`}
                className={buttonClass({ variant: "secondary", className: "text-foreground" })}
              >
                {t("settings.main.team.cta")}
              </Link>
            </div>
          </section>
        ) : null}

        {/* First card in "Your shop", because it is the setting every other
            date and time on every surface is read through — the board's day
            headers, "sailing today", a departure's 08:30. Sign-up asked once
            and nothing could change it afterwards, so a shop that clicked past
            the picker read its own schedule in US Eastern forever. */}
        <section className="mb-6 rounded-lg border border-border bg-surface p-6">
          <CardHeading
            t={t}
            heading={t("settings.main.timezone.heading")}
            description={t("settings.main.timezone.description")}
            detail={t("settings.main.timezone.detail")}
          />
          <SectionNotice banner={banner} section="timezone" active={activeSection} />
          <FieldGrid as="form" action={saveTimezoneAction} columns={1} className="mt-4">
            <Field label={t("settings.main.timezone.label")}>
              {/* No device detection here, unlike sign-up: a stored zone is
                  an answer somebody already gave, and the whole point of this
                  card is to change it deliberately. */}
              <select
                name="timezone"
                required
                defaultValue={shop.timezone || DEFAULT_TIMEZONE}
                className={controlClass}
              >
                <TimezoneOptions
                  selected={shop.timezone || DEFAULT_TIMEZONE}
                  groupLabels={{
                    americas: t(TIMEZONE_GROUP_KEYS.americas),
                    caribbean: t(TIMEZONE_GROUP_KEYS.caribbean),
                    europeRedSea: t(TIMEZONE_GROUP_KEYS.europeRedSea),
                    asiaPacific: t(TIMEZONE_GROUP_KEYS.asiaPacific),
                    allZones: t(TIMEZONE_GROUP_KEYS.allZones),
                  }}
                  zoneLabels={
                    Object.fromEntries(
                      Object.entries(CURATED_TIMEZONE_KEYS).map(([zone, key]) => [zone, t(key)]),
                    ) as TimezoneZoneLabels
                  }
                />
              </select>
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.timezone.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.timezone.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>

        <section className="rounded-lg border border-border bg-surface p-6">
          <CardHeading
            t={t}
            heading={t("settings.main.contact.heading")}
            description={t("settings.main.contact.description")}
            detail={t("settings.main.contact.detail")}
          />
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
          <CardHeading
            t={t}
            heading={t("settings.main.address.heading")}
            description={t("settings.main.address.description")}
            detail={t("settings.main.address.detail")}
          />
          <SectionNotice banner={banner} section="address" active={activeSection} />
          <FieldGrid as="form" action={saveAddressAction} columns={2} className="mt-4">
            <AddressFields
              initial={{
                addressStreet: shop.addressStreet ?? "",
                addressLocality: shop.addressLocality ?? "",
                addressRegion: shop.addressRegion ?? "",
                addressPostalCode: shop.addressPostalCode ?? "",
                addressCountry: shop.addressCountry ?? "",
              }}
              // No geocoder credentials is the ordinary local and self-hosted
              // case: the search box is simply absent and the card is the five
              // boxes it has always been (src/lib/address-lookup.ts).
              enabled={addressLookupEnabled}
              copy={{
                searchLabel: t("settings.main.address.searchLabel"),
                searchHint: t("settings.main.address.searchHint"),
                searchPlaceholder: t("settings.main.address.searchPlaceholder"),
                searching: t("settings.main.address.searching"),
                noMatches: t("settings.main.address.noMatches"),
                lookupFailed: t("settings.main.address.lookupFailed"),
                suggestionsLabel: t("settings.main.address.suggestionsLabel"),
                streetLabel: t("settings.main.address.streetLabel"),
                streetPlaceholder: t("settings.main.address.streetPlaceholder"),
                localityLabel: t("settings.main.address.localityLabel"),
                localityPlaceholder: t("settings.main.address.localityPlaceholder"),
                regionLabel: t("settings.main.address.regionLabel"),
                regionPlaceholder: t("settings.main.address.regionPlaceholder"),
                postalCodeLabel: t("settings.main.address.postalCodeLabel"),
                postalCodePlaceholder: t("settings.main.address.postalCodePlaceholder"),
                countryLabel: t("settings.main.address.countryLabel"),
                countryHint: t("settings.main.address.countryHint"),
                countryPlaceholder: t("settings.main.address.countryPlaceholder"),
              }}
            />
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

        {/* One of the few cards another surface links straight to: the Reviews
            page's empty state names this box, so it needs a target of its own
            rather than dropping a shop at the top of the "Your shop" group. */}
        <section
          id="review-link"
          className="mt-6 scroll-mt-24 rounded-lg border border-border bg-surface p-6"
        >
          <CardHeading
            t={t}
            heading={t("settings.main.reviewLink.heading")}
            description={t("settings.main.reviewLink.description")}
            detail={t("settings.main.reviewLink.detail")}
          />
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
          <CardHeading
            t={t}
            heading={t("settings.main.packing.heading")}
            description={t("settings.main.packing.description")}
          />
          <SectionNotice banner={banner} section="packing" active={activeSection} />
          <FieldGrid as="form" action={savePackingAction} columns={1} className="mt-4">
            <Field label={t("settings.main.packing.label")}>
              <textarea
                name="packingList"
                rows={6}
                maxLength={1212}
                defaultValue={shop.packingList.join("\n")}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.packing.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.packing.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <CardHeading
            t={t}
            heading={t("settings.main.dockCall.heading")}
            description={t("settings.main.dockCall.description")}
            detail={t("settings.main.dockCall.detail")}
          />
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

        {/* One card for the three units a shop reads its own numbers in, rather
          than three cards a shop had to hunt for in two different groups.
          Depth stays stored in metres and water temperature in Celsius whatever
          these say (H-08); currency is the one that reinterprets rather than
          converts, which is what its own marker explains. The three are
          genuinely independent — a Caribbean operator serving American divers
          publishes feet and Celsius — so they are three fields, not one. */}
        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <CardHeading
            t={t}
            heading={t("settings.main.units.heading")}
            description={t("settings.main.units.description")}
          />
          <SectionNotice banner={banner} section="units" active={activeSection} />
          {/* What Stripe reports for the connected account is advisory, so a
            disagreement is surfaced rather than silently resolved either way
            (ADR 20260731-shop-currency). Stripe refuses a session in a currency
            the account can't settle, so this is the difference between a
            warning here and a failed checkout later. */}
          {currencyMismatch ? (
            <div className="mt-4">
              <ShopNotice tone="warning" role="status">
                {t("settings.main.units.currencyMismatch", {
                  shopCurrency: currencyMismatch.shopCurrency.toUpperCase(),
                  accountCurrency: currencyMismatch.accountCurrency.toUpperCase(),
                })}
              </ShopNotice>
            </div>
          ) : null}
          <FieldGrid as="form" action={saveUnitsAction} columns={2} className="mt-4">
            <Field
              label={t("settings.main.units.depthLabel")}
              aside={
                <InfoHint
                  label={t("settings.main.detailLabel", {
                    heading: t("settings.main.units.depthLabel"),
                  })}
                  detail={t("settings.main.units.depthDetail")}
                />
              }
            >
              <select name="depthUnit" defaultValue={shop.depthUnit} className={controlClass}>
                <option value="meters">{t("settings.main.units.meters")}</option>
                <option value="feet">{t("settings.main.units.feet")}</option>
              </select>
            </Field>
            <Field
              label={t("settings.main.units.temperatureLabel")}
              aside={
                <InfoHint
                  label={t("settings.main.detailLabel", {
                    heading: t("settings.main.units.temperatureLabel"),
                  })}
                  detail={t("settings.main.units.temperatureDetail")}
                />
              }
            >
              <select
                name="temperatureUnit"
                defaultValue={shop.temperatureUnit}
                className={controlClass}
              >
                <option value="celsius">{t("settings.main.units.celsius")}</option>
                <option value="fahrenheit">{t("settings.main.units.fahrenheit")}</option>
              </select>
            </Field>
            {/* Owner/manager only (H-14): this decides what a diver's card is
              charged in. Hiding it is convenience — `saveUnitsAction` re-checks
              the gate against live roles for any submission that carries the
              field anyway. */}
            {canPayments ? (
              <Field
                label={t("settings.main.units.currencyLabel")}
                aside={
                  <InfoHint
                    label={t("settings.main.detailLabel", {
                      heading: t("settings.main.units.currencyLabel"),
                    })}
                    detail={t("settings.main.units.currencyDetail")}
                  />
                }
              >
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
            ) : null}
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.units.submitting")}
                className={buttonClass()}
              >
                {t("settings.main.units.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </section>
      </SettingsGroup>

      <SettingsGroup group={MONEY_GROUP} label={t(MONEY_GROUP.labelKey)}>
        {/* First card in "Money" — what DiveDay itself costs, before what the
            shop charges divers. Soft expiry by product decision: a trial past
            its window keeps working exactly as before, so this is purely
            informational, never a lockout. */}
        {canViewTrialStatus ? (
          <section className="mb-6 rounded-lg border border-border bg-surface p-6">
            <CardHeading
              t={t}
              heading={t("settings.main.trial.heading")}
              description={
                trialExpired
                  ? t("settings.main.trial.expiredDescription", { endDate: trialEndLabel })
                  : t("settings.main.trial.activeDescription", {
                      count: trialDaysLeft,
                      endDate: trialEndLabel,
                    })
              }
            />
            <p className="mt-3 text-sm text-muted">{t("settings.main.trial.upgradeBody")}</p>
            <div className="mt-4">
              <a
                href={`mailto:${UPGRADE_EMAIL}`}
                className={buttonClass({ variant: "secondary", className: "text-foreground" })}
              >
                {t("settings.main.trial.emailCta", { email: UPGRADE_EMAIL })}
              </a>
            </div>
          </section>
        ) : null}

        {/* Orders is not here. It is money a shop *reads* every day, so it
            keeps its header row under "Run the shop" and this page stops
            offering a second door to it — one destination, one place to find
            it. Promo codes go the other way: they are configured rarely, so
            they left the header and this card is now the way in. */}
        {canManagePromos ? (
          <section className="rounded-lg border border-border bg-surface p-6">
            <CardHeading
              t={t}
              heading={t("settings.main.promos.heading")}
              description={t("settings.main.promos.description")}
            />
            <div className="mt-4">
              <Link
                href={`/shop/${shopSlug}/promos`}
                className={buttonClass({ variant: "secondary", className: "text-foreground" })}
              >
                {t("settings.main.promos.cta")}
              </Link>
            </div>
          </section>
        ) : null}

        {canPayments ? null : (
          <div className="mt-6">
            <ShopNotice tone="neutral" role="status">
              {t("settings.main.paymentsGate.notice")}
            </ShopNotice>
          </div>
        )}

        {canPayments ? (
          <>
            {/* Currency is not here. It moved up to the "Units" card with depth
              and water temperature — a shop looking for "what do we measure
              things in" should find all three answers in one place, and this
              group keeps what a shop *charges* and gets paid through. */}
            <section className="mt-6 rounded-lg border border-border bg-surface p-6">
              <CardHeading
                t={t}
                heading={t("settings.main.rentals.heading")}
                description={t("settings.main.rentals.description")}
                detail={t("settings.main.rentals.detail")}
              />
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
              <CardHeading
                t={t}
                heading={t("settings.main.rentalPricing.heading")}
                description={t("settings.main.rentalPricing.description")}
                detail={t("settings.main.rentalPricing.detail")}
              />
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
                  <CardHeading
                    t={t}
                    heading={t("settings.main.stripe.notConnectedHeading")}
                    description={t("settings.main.stripe.notConnectedDescription")}
                    detail={t("settings.main.stripe.notConnectedDetail")}
                  />
                  {connectConfigured ? (
                    <Link
                      href={`/shop/${shopSlug}/settings/connect`}
                      className={buttonClass({ className: "mt-4" })}
                    >
                      {t("settings.main.stripe.connect")}
                    </Link>
                  ) : (
                    <p className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
                      {t("settings.main.stripe.notConfiguredWarning", { email: SUPPORT_EMAIL })}
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

      <SettingsGroup group={DATA_GROUP} label={t(DATA_GROUP.labelKey)}>
        <section className="rounded-lg border border-border bg-surface p-6">
          <CardHeading
            t={t}
            heading={t("settings.main.embed.heading")}
            description={t("settings.main.embed.description")}
          />
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
          <CardHeading
            t={t}
            heading={t("settings.main.calendar.heading")}
            description={t("settings.main.calendar.description")}
          />
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
            <CardHeading
              t={t}
              heading={t("settings.main.whatsapp.heading")}
              description={t("settings.main.whatsapp.description")}
            />
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

        {/* Owner/manager only, like the export button below it feeds: the
            destination it configures receives the whole shop every week. */}
        {canExport ? (
          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <CardHeading
              t={t}
              heading={t("settings.main.backup.heading")}
              description={t("settings.main.backup.description")}
            />
            <div className="mt-4">
              <Link
                href={`/shop/${shopSlug}/settings/backup`}
                className={buttonClass({ variant: "secondary", className: "text-foreground" })}
              >
                {t("settings.main.backup.cta")}
              </Link>
            </div>
          </section>
        ) : null}

        {canImport || canExport ? (
          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <CardHeading
              t={t}
              heading={t("settings.main.data.heading")}
              description={t("settings.main.data.description")}
              detail={t("settings.main.data.detail")}
            />
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
        <p>{t("settings.main.support.description")}</p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">
          {t("settings.main.support.emailCta", { email: SUPPORT_EMAIL })}
        </a>
      </footer>
    </main>
  );
}
