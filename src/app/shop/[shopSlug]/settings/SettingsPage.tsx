import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { TimezoneOptions, type TimezoneZoneLabels } from "@/components/TimezoneOptions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid, PriceField } from "@/components/ui/form";
import {
  canPersonErasePersonalData,
  canPersonManagePaymentSettings,
  canPersonManageShopSettings,
} from "@/db/authz";
import { getDb } from "@/db/client";
import { listPendingMediaDeletions } from "@/db/media-deletions";
import { listOwedProcessorErasures } from "@/db/processor-erasure";
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
  canManageWaiverTemplates,
  canViewShopReports,
} from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
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
import { SettingsGroupAnchors } from "./_components/SettingsGroupAnchors";
import { SettingsDoorRow, SettingsRow, SettingsRowList } from "./_components/SettingsRows";
import { AddressSearch } from "./AddressSearch";
import {
  dischargeProcessorErasureAction,
  disconnectAction,
  refreshAction,
  retryMediaDeletionAction,
  retryProcessorErasureAction,
  saveContactAction,
  saveDockCallAction,
  savePackingAction,
  saveRentalItemsAction,
  saveRentalPricingAction,
  saveReviewUrlAction,
  saveTimezoneAction,
  saveUnitsAction,
} from "./actions";
import { SETTINGS_GROUPS } from "./settings-groups";

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
    address_removed: { tone: "success", text: t("settings.main.notice.addressRemoved") },
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
  // Badges mark the exceptional state (principle 9): the settled "Yes" reads
  // as quiet muted text, so a warning pill in this list means something the
  // moment it appears.
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      {ok ? (
        <span className="text-muted">{yesLabel}</span>
      ) : (
        <Badge tone="warning">{notYetLabel}</Badge>
      )}
    </li>
  );
}

// Re-exported (not just imported) so `SettingsPage.test.tsx`'s group-anchor
// assertions keep reading the same list `SettingsGroupAnchors` derives from —
// one registry, `settings-groups.ts`, not a copy per consumer.
export { SETTINGS_GROUPS };

type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];

const [YOUR_SHOP_GROUP, MONEY_GROUP, DATA_GROUP] = SETTINGS_GROUPS;

/**
 * Which stored file a deletion never finished on. Without an entry here the
 * lookup falls through to the raw enum value, so a stuck deletion would read
 * "certification_card" on the panel. `certification_card` and
 * `waiver_document` are queued by diver erasure (ADR 20260802-diver-data-erasure).
 */
const MEDIA_KIND_KEYS: Record<string, StaffMessageKey> = {
  course_photo: "settings.main.dataJobs.mediaKind.course_photo",
  recap_photo: "settings.main.dataJobs.mediaKind.recap_photo",
  certification_card: "settings.main.dataJobs.mediaKind.certification_card",
  waiver_document: "settings.main.dataJobs.mediaKind.waiver_document",
};

/**
 * Which record at the processor is still owed an erasure, present for the same
 * reason `MEDIA_KIND_KEYS` is: without it the lookup falls through to the raw
 * enum value and the panel reads "stripe_invoice_snapshot".
 */
const PROCESSOR_ERASURE_TARGET_KEYS: Record<string, StaffMessageKey> = {
  stripe_customer: "settings.main.dataJobs.erasureTarget.stripe_customer",
  stripe_invoice_snapshot: "settings.main.dataJobs.erasureTarget.stripe_invoice_snapshot",
};

/**
 * A labelled group of settings rows with an anchor `#id`. Rows keep their own
 * `<h3>`; this is the page's real `<h2>` level, so the heading hierarchy stays
 * `<h1>` (ShopPageHeader) -> group `<h2>` -> row `<h3>`.
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
        className="mb-3 scroll-mt-24 text-xs font-semibold tracking-[0.14em] text-muted uppercase"
      >
        {label}
      </h2>
      {children}
    </div>
  );
}

/**
 * The ten forms on this page each carry their own section id through
 * `?saved=<id>` (set by the action that redirects back here), so the row that
 * changed comes back *open*, with the notice rendered inside it — a closed
 * disclosure hiding a refusal would be a form the staffer cannot see failed
 * (the same rule `EditDisclosure` states on the trip Overview).
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
  // Every row on this page changes the shop rather than the day, so the page
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
  // The two data-compliance queues that used to hang off the bottom of the
  // monthly report (see `actions.ts`). Read behind this page's own gate, which
  // is the same owner/manager role set the reports gate was, so the same people
  // see the same work. Both render nothing when empty — a shop that owes
  // nothing sees no panel, not an empty table.
  const [pendingMediaDeletions, owedProcessorErasures] = await Promise.all([
    listPendingMediaDeletions(db, session.user.shopId),
    listOwedProcessorErasures(db, session.user.shopId),
  ]);
  // Owner-only, and tighter than the gate this panel is *read* behind: a retry
  // fires a destructive call at the shop's Stripe account and a discharge signs
  // an attestation that a diver's data is gone from the processor. The actions
  // enforce it themselves and return silently on refusal — this only keeps a
  // manager from being shown a button they would be bounced from
  // (ADR 20260724-role-gated-surfaces-hide-not-explain).
  const canErase = await canPersonErasePersonalData(db, session.user.shopId, session.user.personId);
  // The same two gates the nav registry hangs Team and Promo codes off
  // (src/lib/staff-destinations.ts), so a divemaster who has neither is never
  // shown a door that would bounce them (ADR
  // 20260724-role-gated-surfaces-hide-not-explain). Both pages re-check.
  const canManageTeam = canManageStaffAccounts(session.user.roles);
  const canManageWaivers = canManageWaiverTemplates(session.user.roles);
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
  // A recognized section opens its own row and renders the notice inside it;
  // anything else (chiefly `not_authorized`, which spans several sections
  // rather than owning one) keeps the old top-of-page banner.
  const activeSection = (SECTION_IDS as readonly string[]).includes(saved ?? "")
    ? (saved as SectionId)
    : null;

  // Every row states its current answer at rest — the page reads as answers,
  // not as a wall of the inputs that would change them (the surface is the
  // interface). "Not set" is a value here, not a status: on a settings row the
  // absence of an answer is exactly the fact the reader came to check.
  const notSet = t("settings.main.summary.notSet");
  const zoneId = shop.timezone || DEFAULT_TIMEZONE;
  const timezoneValue =
    zoneId in CURATED_TIMEZONE_KEYS ? t(CURATED_TIMEZONE_KEYS[zoneId as CuratedTimeZone]) : zoneId;
  const contactValue = [shop.contactEmail, shop.contactPhone].filter(Boolean).join(" · ") || notSet;
  const addressValue =
    [shop.addressStreet, shop.addressLocality].filter(Boolean).join(", ") || notSet;
  const reviewLinkValue = (() => {
    if (!shop.reviewUrl) return notSet;
    try {
      return new URL(shop.reviewUrl).hostname;
    } catch {
      return shop.reviewUrl;
    }
  })();
  const packingValue =
    shop.packingList.length > 0
      ? t("settings.main.packing.value", { count: shop.packingList.length })
      : notSet;
  const dockCallValue = t("settings.main.dockCall.value", { count: shop.dockCallMinutes });
  const unitsValue = [
    t(shop.depthUnit === "feet" ? "settings.main.units.feet" : "settings.main.units.meters"),
    t(
      shop.temperatureUnit === "fahrenheit"
        ? "settings.main.units.fahrenheit"
        : "settings.main.units.celsius",
    ),
    shopCurrency.toUpperCase(),
  ].join(" · ");
  const rentalsValue = t("settings.main.rentals.value", { count: offeredKinds.size });
  const rentalPricingValue =
    shop.rentalPricing.setCents !== null
      ? t("settings.main.rentalPricing.value", {
          price: formatMoneyCents(shop.rentalPricing.setCents, shopCurrency, locale),
        })
      : notSet;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "saved"]} />
      {/* The jump row stands above the `<h1>` because it is about the page as
          a whole, and it renders only here — the sub-pages it used to sit on
          get their way back from their own eyebrow instead. */}
      <SettingsGroupAnchors
        ariaLabel={t("settings.main.subNav.ariaLabel")}
        groupLabels={
          Object.fromEntries(
            SETTINGS_GROUPS.map((group) => [group.id, t(group.labelKey)]),
          ) as Record<SettingsGroupSpec["id"], string>
        }
        className="mb-4"
      />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        title={t("settings.main.title")}
        description={t("settings.main.description")}
      />

      {banner && !activeSection ? (
        <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner>
      ) : null}

      <SettingsGroup group={YOUR_SHOP_GROUP} label={t(YOUR_SHOP_GROUP.labelKey)}>
        <SettingsRowList>
          {/* Who works here comes first: an owner opening Settings to add a
              colleague used to find no door to Team anywhere on this page — only
              the nav's "Set up" menu and ⌘K knew it existed. */}
          {canManageTeam ? (
            <SettingsDoorRow
              href={`/shop/${shopSlug}/settings/team`}
              heading={t("settings.main.team.heading")}
              description={t("settings.main.team.description")}
            />
          ) : null}

          {/* The two reference libraries the daily surfaces consume — the
              board's add panel reads the dive-site list, and every waiver a
              diver signs renders the template. Both left the header nav with
              the cut to five tabs; an owner's path to them is this page (and
              the palette), so each gets a door beside the other configure-once
              work. */}
          <SettingsDoorRow
            href={`/shop/${shopSlug}/dive-sites`}
            heading={t("settings.main.diveSites.heading")}
            description={t("settings.main.diveSites.description")}
          />
          {canManageWaivers ? (
            <SettingsDoorRow
              href={`/shop/${shopSlug}/waivers`}
              heading={t("settings.main.waivers.heading")}
              description={t("settings.main.waivers.description")}
            />
          ) : null}

          {/* First editable row, because it is the setting every other date
              and time on every surface is read through — the board's day
              headers, "sailing today", a departure's 08:30. Sign-up asked once
              and nothing could change it afterwards, so a shop that clicked
              past the picker read its own schedule in US Eastern forever.

              Every "Save" submit on this page renders `secondary`, not the
              default primary — this is a settings hub (docs/design/forms-and-
              controls.md, "Settings hubs are the one place..."), so only the
              Stripe "Connect"/"Reconnect" CTA below keeps primary weight. */}
          <SettingsRow
            heading={t("settings.main.timezone.heading")}
            value={timezoneValue}
            description={t("settings.main.timezone.description")}
            detail={t("settings.main.timezone.detail")}
            open={activeSection === "timezone"}
          >
            <SectionNotice banner={banner} section="timezone" active={activeSection} />
            <FieldGrid as="form" action={saveTimezoneAction} columns={1} className="mt-4">
              <Field label={t("settings.main.timezone.label")}>
                {/* No device detection here, unlike sign-up: a stored zone is
                    an answer somebody already gave, and the whole point of this
                    row is to change it deliberately. */}
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
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.main.timezone.submit")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </SettingsRow>

          <SettingsRow
            heading={t("settings.main.contact.heading")}
            value={contactValue}
            description={t("settings.main.contact.description")}
            detail={t("settings.main.contact.detail")}
            open={activeSection === "contact"}
            // The first-run checklist's "Add contact details" lands here — a
            // link that promises a form must arrive with the row open.
            openOnHash="contact"
            anchorId="contact"
          >
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
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.main.contact.submit")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </SettingsRow>

          {/* One search box, no Save: picking a place *is* the save (ADR
              20260811-address-is-one-search-box). The five free-text boxes that
              used to sit under the lookup are gone — they were the source of
              every mangled address the lookup was introduced to prevent. */}
          <SettingsRow
            heading={t("settings.main.address.heading")}
            value={addressValue}
            detail={t("settings.main.address.detail")}
            open={activeSection === "address"}
          >
            <SectionNotice banner={banner} section="address" active={activeSection} />
            <AddressSearch
              initial={{
                addressStreet: shop.addressStreet ?? "",
                addressLocality: shop.addressLocality ?? "",
                addressRegion: shop.addressRegion ?? "",
                addressPostalCode: shop.addressPostalCode ?? "",
                addressCountry: shop.addressCountry ?? "",
              }}
              // No geocoder credentials is the ordinary local and self-hosted
              // case: the card says so in a sentence rather than offering a box
              // that answers nothing (src/lib/address-lookup.ts).
              enabled={addressLookupEnabled}
              copy={{
                searchLabel: t("settings.main.address.searchLabel"),
                searchPlaceholder: t("settings.main.address.searchPlaceholder"),
                searching: t("settings.main.address.searching"),
                saving: t("settings.main.address.saving"),
                noMatches: t("settings.main.address.noMatches"),
                lookupFailed: t("settings.main.address.lookupFailed"),
                lookupResting: t("settings.main.address.lookupResting"),
                notConfigured: t("settings.main.address.notConfigured"),
                suggestionsLabel: t("settings.main.address.suggestionsLabel"),
                currentLabel: t("settings.main.address.currentLabel"),
                noneSet: t("settings.main.address.noneSet"),
                removeLabel: t("settings.main.address.remove"),
                removing: t("settings.main.address.removing"),
              }}
            />
          </SettingsRow>

          {/* One of the few rows another surface links straight to: the Reviews
              page's empty state names this box, so it opens itself on the
              `#review-link` fragment rather than dropping a shop at a closed
              row. */}
          <SettingsRow
            heading={t("settings.main.reviewLink.heading")}
            value={reviewLinkValue}
            description={t("settings.main.reviewLink.description")}
            detail={t("settings.main.reviewLink.detail")}
            open={activeSection === "reviewLink"}
            openOnHash="review-link"
            anchorId="review-link"
          >
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
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.main.reviewLink.submit")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </SettingsRow>

          <SettingsRow
            heading={t("settings.main.packing.heading")}
            value={packingValue}
            description={t("settings.main.packing.description")}
            open={activeSection === "packing"}
          >
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
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.main.packing.submit")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </SettingsRow>

          <SettingsRow
            heading={t("settings.main.dockCall.heading")}
            value={dockCallValue}
            description={t("settings.main.dockCall.description")}
            detail={t("settings.main.dockCall.detail")}
            open={activeSection === "dockCall"}
          >
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
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.main.dockCall.submit")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </SettingsRow>

          {/* One row for the three units a shop reads its own numbers in.
              Depth stays stored in metres and water temperature in Celsius
              whatever these say (H-08); currency is the one that reinterprets
              rather than converts, which is what its own marker explains. The
              three are genuinely independent — a Caribbean operator serving
              American divers publishes feet and Celsius — so they are three
              fields, not one. */}
          <SettingsRow
            heading={t("settings.main.units.heading")}
            value={unitsValue}
            description={t("settings.main.units.description")}
            open={activeSection === "units"}
          >
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
              {/* The explanations render as plain helper text, not InfoHint
                  buttons — inside an open disclosure the reader has already
                  asked for detail, and three ⓘ controls hiding three facts
                  fail remove-until-it-breaks. */}
              <Field
                label={t("settings.main.units.depthLabel")}
                description={t("settings.main.units.depthDetail")}
              >
                <select name="depthUnit" defaultValue={shop.depthUnit} className={controlClass}>
                  <option value="meters">{t("settings.main.units.meters")}</option>
                  <option value="feet">{t("settings.main.units.feet")}</option>
                </select>
              </Field>
              <Field
                label={t("settings.main.units.temperatureLabel")}
                description={t("settings.main.units.temperatureDetail")}
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
                  description={t("settings.main.units.currencyDetail")}
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
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("settings.main.units.submit")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </SettingsRow>
        </SettingsRowList>
      </SettingsGroup>

      <SettingsGroup group={MONEY_GROUP} label={t(MONEY_GROUP.labelKey)}>
        <SettingsRowList>
          {/* First row in "Money" — what DiveDay itself costs, before what the
              shop charges divers. Soft expiry by product decision: a trial past
              its window keeps working exactly as before, so this is purely
              informational, never a lockout. */}
          {canViewTrialStatus ? (
            <SettingsRow
              heading={t("settings.main.trial.heading")}
              value={
                trialExpired
                  ? t("settings.main.trial.expiredValue", { endDate: trialEndLabel })
                  : t("settings.main.trial.value", { count: trialDaysLeft })
              }
              description={
                trialExpired
                  ? t("settings.main.trial.expiredDescription", { endDate: trialEndLabel })
                  : t("settings.main.trial.activeDescription", {
                      count: trialDaysLeft,
                      endDate: trialEndLabel,
                    })
              }
            >
              <p className="mt-3 text-sm text-muted">{t("settings.main.trial.upgradeBody")}</p>
              <div className="mt-4">
                <a
                  href={`mailto:${UPGRADE_EMAIL}`}
                  className={buttonClass({ variant: "secondary", className: "text-foreground" })}
                >
                  {t("settings.main.trial.emailCta", { email: UPGRADE_EMAIL })}
                </a>
              </div>
            </SettingsRow>
          ) : null}

          {/* Orders is not here. It is money a shop *reads* every day, so it
              keeps its header row under "Run the shop" and this page stops
              offering a second door to it — one destination, one place to find
              it. Promo codes go the other way: they are configured rarely, so
              they left the header and this row is now the way in. */}
          {canManagePromos ? (
            <SettingsDoorRow
              href={`/shop/${shopSlug}/promos`}
              heading={t("settings.main.promos.heading")}
              description={t("settings.main.promos.description")}
            />
          ) : null}

          {canPayments ? (
            <>
              {/* Currency is not here. It lives in the "Units" row with depth
                and water temperature — a shop looking for "what do we measure
                things in" should find all three answers in one place, and this
                group keeps what a shop *charges* and gets paid through. */}
              <SettingsRow
                heading={t("settings.main.rentals.heading")}
                value={rentalsValue}
                description={t("settings.main.rentals.description")}
                detail={t("settings.main.rentals.detail")}
                open={activeSection === "rentals"}
              >
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
                    className={buttonClass({ variant: "secondary", className: "mt-3" })}
                  >
                    {t("settings.main.rentals.submit")}
                  </SubmitButton>
                </form>
              </SettingsRow>

              <SettingsRow
                heading={t("settings.main.rentalPricing.heading")}
                value={rentalPricingValue}
                description={t("settings.main.rentalPricing.description")}
                detail={t("settings.main.rentalPricing.detail")}
                open={activeSection === "rentalPricing"}
              >
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
                    className={buttonClass({ variant: "secondary", className: "mt-4" })}
                  >
                    {t("settings.main.rentalPricing.submit")}
                  </SubmitButton>
                </form>
              </SettingsRow>

              {/* The one row that opens itself: an unconnected or half-onboarded
                  Stripe account is the difference between taking bookings online
                  and not, so the moment it needs a person it surfaces — and once
                  it is quietly working it folds away like everything else. */}
              <SettingsRow
                heading={t("settings.main.stripe.rowHeading")}
                value={
                  !account ? (
                    <Badge tone="warning">{t("settings.main.stripe.summaryNotConnected")}</Badge>
                  ) : account.disconnectedAt ? (
                    <Badge tone="warning">{t("settings.main.stripe.summaryDisconnected")}</Badge>
                  ) : ready ? (
                    t("settings.main.stripe.accountEnding", {
                      last6: account.stripeAccountId.slice(-6),
                    })
                  ) : (
                    <Badge tone="warning">{t("settings.main.stripe.notReadyBadge")}</Badge>
                  )
                }
                description={
                  !account ? t("settings.main.stripe.notConnectedDescription") : undefined
                }
                detail={!account ? t("settings.main.stripe.notConnectedDetail") : undefined}
                open={activeSection === "stripe" || !account || !ready}
              >
                <SectionNotice banner={banner} section="stripe" active={activeSection} />
                {!account ? (
                  connectConfigured ? (
                    // A plain <a>, not <Link>: this route 302s to Stripe's
                    // OAuth authorize URL, and Next's client-side navigation
                    // would follow that redirect via fetch — a cross-origin
                    // request Stripe's CORS policy rejects. A full
                    // navigation handles the redirect natively.
                    <a
                      href={`/shop/${shopSlug}/settings/connect`}
                      className={buttonClass({ className: "mt-4" })}
                    >
                      {t("settings.main.stripe.connect")}
                    </a>
                  ) : (
                    <div className="mt-4">
                      <ShopNotice tone="warning" role="status">
                        {t("settings.main.stripe.notConfiguredWarning", { email: SUPPORT_EMAIL })}
                      </ShopNotice>
                    </div>
                  )
                ) : (
                  <div className="mt-3">
                    <p className="text-sm text-muted">
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
                          // A plain <a>, not <Link>: this route 302s to
                          // Stripe's OAuth authorize URL, and Next's
                          // client-side navigation would follow that
                          // redirect via fetch — a cross-origin request
                          // Stripe's CORS policy rejects. A full navigation
                          // handles the redirect natively.
                          <a href={`/shop/${shopSlug}/settings/connect`} className={buttonClass()}>
                            {t("settings.main.stripe.reconnect")}
                          </a> // i18n-exempt: JSX ternary punctuation below, not copy — scanner false positive.
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
              </SettingsRow>
            </>
          ) : null}
        </SettingsRowList>

        {canPayments ? null : (
          <div className="mt-6">
            <ShopNotice tone="neutral" role="status">
              {t("settings.main.paymentsGate.notice")}
            </ShopNotice>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup group={DATA_GROUP} label={t(DATA_GROUP.labelKey)}>
        {/*
          Data this shop said it would delete and hasn't finished deleting —
          the group's own question, asked first because it is the only thing in
          it that is *owed* rather than merely configurable, and danger-toned
          rather than folded away: an unfinished erasure is a legal obligation,
          not a notification to dismiss. Both blocks vanish entirely when the
          queue is empty, which is nearly always, so the calm state of this
          group is the row list below.
        */}
        {pendingMediaDeletions.length > 0 ? (
          <section
            aria-label={t("settings.main.dataJobs.mediaDeletions.sectionLabel")}
            className="mb-6"
          >
            <ShopNotice tone="danger" role="status">
              <p className="font-medium">
                {t("settings.main.dataJobs.mediaDeletions.heading", {
                  count: pendingMediaDeletions.length,
                })}
              </p>
              <p className="mt-1 text-sm">{t("settings.main.dataJobs.mediaDeletions.detail")}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {pendingMediaDeletions.map((attempt) => (
                  <li key={attempt.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{t(MEDIA_KIND_KEYS[attempt.kind])}</span>
                    <span className="text-muted">
                      ·{" "}
                      {t("settings.main.dataJobs.mediaDeletions.queued", {
                        date: formatShortDate(attempt.createdAt, locale, shop.timezone),
                      })}
                      {attempt.lastError ? ` · ${attempt.lastError}` : ""}
                    </span>
                    <form action={retryMediaDeletionAction}>
                      <input type="hidden" name="attemptId" value={attempt.id} />
                      <SubmitButton
                        pendingLabel={t("settings.main.dataJobs.mediaDeletions.retrying")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("settings.main.dataJobs.mediaDeletions.retry")}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </ShopNotice>
          </section>
        ) : null}

        {/*
          Erasures that are done here but not yet done at Stripe
          (ADR 20260803-processor-erasure-obligations). Two kinds, and the row
          offers what can actually act on each: a customer delete DiveDay makes
          itself gets "Retry" (the nightly tick also retries it), while an
          invoice snapshot has no API behind it at all and can only be closed by
          an owner attesting they filed Stripe's data-deletion request. The panel
          shows the `cus_…`/`in_…` handle and nothing else — the diver's identity
          is exactly what erasure already removed here.
        */}
        {owedProcessorErasures.length > 0 ? (
          <section
            aria-label={t("settings.main.dataJobs.processorErasures.sectionLabel")}
            className="mb-6"
          >
            <ShopNotice tone="danger" role="status">
              <p className="font-medium">
                {t("settings.main.dataJobs.processorErasures.heading", {
                  count: owedProcessorErasures.length,
                })}
              </p>
              <p className="mt-1 text-sm">{t("settings.main.dataJobs.processorErasures.detail")}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {owedProcessorErasures.map((obligation) => (
                  <li key={obligation.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">
                      {t(PROCESSOR_ERASURE_TARGET_KEYS[obligation.target])}
                    </span>
                    <span className="font-mono">{obligation.externalId}</span>
                    <span className="text-muted">
                      ·{" "}
                      {t("settings.main.dataJobs.processorErasures.raised", {
                        date: formatShortDate(obligation.createdAt, locale, shop.timezone),
                      })}
                      {obligation.lastError ? ` · ${obligation.lastError}` : ""}
                    </span>
                    {canErase && obligation.target === "stripe_customer" ? (
                      <form action={retryProcessorErasureAction}>
                        <input type="hidden" name="obligationId" value={obligation.id} />
                        <SubmitButton
                          pendingLabel={t("settings.main.dataJobs.processorErasures.retrying")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {t("settings.main.dataJobs.processorErasures.retry")}
                        </SubmitButton>
                      </form>
                    ) : null}
                    {canErase ? (
                      <form action={dischargeProcessorErasureAction}>
                        <input type="hidden" name="obligationId" value={obligation.id} />
                        <SubmitButton
                          pendingLabel={t("settings.main.dataJobs.processorErasures.discharging")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {t("settings.main.dataJobs.processorErasures.discharge")}
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ShopNotice>
          </section>
        ) : null}

        <SettingsRowList>
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/embed`}
            heading={t("settings.main.embed.heading")}
            description={t("settings.main.embed.description")}
          />
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/calendar`}
            heading={t("settings.main.calendar.heading")}
            description={t("settings.main.calendar.description")}
          />
          {/* Owner/manager only, like the payment rows above: the credential it
              stores can send messages as the business. */}
          {canManageMessaging ? (
            <SettingsDoorRow
              href={`/shop/${shopSlug}/settings/whatsapp`}
              heading={t("settings.main.whatsapp.heading")}
              description={t("settings.main.whatsapp.description")}
            />
          ) : null}
          {/* Owner/manager only, like the export row below it feeds: the
              destination it configures receives the whole shop every week.

              Two rows, one surface. Backups and the download are the same
              bundle behind the same gate and share a route now (ADR
              20260806-one-data-out-surface), but a shop arrives at Settings
              asking one of two different questions — "let me take a copy" and
              "make sure a copy keeps happening" — so both doors stay, and this
              one deep-links to the half it names. */}
          {canExport ? (
            <SettingsDoorRow
              href={`/shop/${shopSlug}/settings/export#backups`}
              heading={t("settings.main.backup.heading")}
              description={t("settings.main.backup.description")}
            />
          ) : null}
          {canImport ? (
            <SettingsDoorRow
              href={`/shop/${shopSlug}/settings/import`}
              heading={t("settings.import.title")}
              description={t("settings.main.dataImport.description")}
            />
          ) : null}
          {canExport ? (
            <SettingsDoorRow
              href={`/shop/${shopSlug}/settings/export`}
              heading={t("settings.export.title")}
              description={t("settings.main.dataExport.description")}
            />
          ) : null}
        </SettingsRowList>
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
