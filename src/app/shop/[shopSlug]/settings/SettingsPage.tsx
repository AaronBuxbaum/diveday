import type { Metadata } from "next";
import { Suspense } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { tapTargetLinkClass } from "@/components/ui/button";
import { canPersonManagePaymentSettings, canPersonManageShopSettings } from "@/db/authz";
import { shopHasPricedRecords } from "@/db/shops";
import { getShopStripeAccount, stripeCurrencyMismatch } from "@/db/stripe-accounts";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { isAddressLookupConfigured } from "@/lib/address-lookup";
import {
  canExportShopData,
  canImportShopData,
  canManageBilling,
  canManageMessagingSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
} from "@/lib/authz";
import { configuredValue } from "@/lib/configured";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { CONNECT_CLIENT_ID } from "@/lib/payments/connect";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { MAX_IMAGE_MB, MAX_SHOPFRONT_PHOTOS } from "@/lib/storage/limits";
import { AccountGroup } from "./_components/groups/AccountGroup";
import { BoatsSitesGroup } from "./_components/groups/BoatsSitesGroup";
import { BookingsGroup } from "./_components/groups/BookingsGroup";
import { DataGroup } from "./_components/groups/DataGroup";
import {
  BOATS_SITES_GROUP,
  DATA_GROUP,
  SettingsGroup,
  type SettingsView,
} from "./_components/groups/kit";
import { MessagesGroup } from "./_components/groups/MessagesGroup";
import { MoneyGroup } from "./_components/groups/MoneyGroup";
import { RentalsGroup } from "./_components/groups/RentalsGroup";
import { ShopGroup } from "./_components/groups/ShopGroup";
import { TeamGroup } from "./_components/groups/TeamGroup";
import { WebsiteGroup } from "./_components/groups/WebsiteGroup";
import { settingsPaneClass } from "./_components/settings-pane";
import { SECTION_IDS, SETTINGS_GROUPS, type SectionId } from "./settings-groups";

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
    "packing-saved": { tone: "success", text: t("settings.main.notice.packingSaved") },
    "packing-invalid": { tone: "danger", text: t("settings.main.notice.packingInvalid") },
    "timezone-saved": { tone: "success", text: t("settings.main.notice.timezoneSaved") },
    "season-saved": { tone: "success", text: t("settings.main.notice.seasonSaved") },
    "season-invalid": { tone: "danger", text: t("settings.main.notice.seasonInvalid") },
    "timezone-invalid": { tone: "danger", text: t("settings.main.notice.timezoneInvalid") },
    "dock-saved": { tone: "success", text: t("settings.main.notice.dockSaved") },
    "emergency-saved": { tone: "success", text: t("settings.main.notice.emergencySaved") },
    "dock-invalid": { tone: "danger", text: t("settings.main.notice.dockInvalid") },
    "package-saved": { tone: "success", text: t("settings.main.notice.packageSaved") },
    "package-deleted": { tone: "success", text: t("settings.main.notice.packageDeleted") },
    "package-invalid": { tone: "danger", text: t("settings.main.notice.packageInvalid") },
    "units-saved": { tone: "success", text: t("settings.main.notice.unitsSaved") },
    "units-invalid": { tone: "danger", text: t("settings.main.notice.unitsInvalid") },
    "tax-saved": { tone: "success", text: t("settings.main.notice.taxSaved") },
    "tax-invalid": { tone: "danger", text: t("settings.main.notice.taxInvalid") },
    "pass-through-saved": { tone: "success", text: t("settings.main.notice.passThroughSaved") },
    "pass-through-invalid": { tone: "danger", text: t("settings.main.notice.passThroughInvalid") },
    "rentals-saved": { tone: "success", text: t("settings.main.notice.rentalsSaved") },
    "rental-prices-saved": { tone: "success", text: t("settings.main.notice.rentalPricesSaved") },
    "rental-prices-invalid": {
      tone: "danger",
      text: t("settings.main.notice.rentalPricesInvalid"),
    },
    "rental-terms-saved": { tone: "success", text: t("settings.main.notice.rentalTermsSaved") },
    "rental-terms-invalid": {
      tone: "danger",
      text: t("settings.main.notice.rentalTermsInvalid"),
    },
    "contact-saved": { tone: "success", text: t("settings.main.notice.contactSaved") },
    "contact-confirmation-sent": {
      tone: "success",
      text: t("settings.main.notice.contactConfirmationSent"),
    },
    "contact-invalid": { tone: "danger", text: t("settings.main.notice.contactInvalid") },
    "profile-saved": { tone: "success", text: t("settings.main.notice.profileSaved") },
    "profile-invalid": { tone: "danger", text: t("settings.main.notice.profileInvalid") },
    "shop-photos-saved": { tone: "success", text: t("settings.main.notice.shopPhotosSaved") },
    "shop-photos-invalid": {
      tone: "danger",
      text: t("settings.main.notice.shopPhotosInvalid", {
        maxMb: MAX_IMAGE_MB,
        max: MAX_SHOPFRONT_PHOTOS,
      }),
    },
    "address-saved": { tone: "success", text: t("settings.main.notice.addressSaved") },
    "address-removed": { tone: "success", text: t("settings.main.notice.addressRemoved") },
    "address-invalid": { tone: "danger", text: t("settings.main.notice.addressInvalid") },
    "review-url-saved": { tone: "success", text: t("settings.main.notice.reviewUrlSaved") },
    "review-url-invalid": { tone: "danger", text: t("settings.main.notice.reviewUrlInvalid") },
    "search-listing-on": { tone: "success", text: t("settings.main.notice.searchListingOn") },
    "search-listing-off": { tone: "success", text: t("settings.main.notice.searchListingOff") },
    connected: { tone: "success", text: t("settings.main.notice.connected") },
    "connect-failed": { tone: "danger", text: t("settings.main.notice.connectFailed") },
    "not-configured": { tone: "warning", text: t("settings.main.notice.notConfigured") },
    disconnected: { tone: "success", text: t("settings.main.notice.disconnected") },
    refreshed: { tone: "success", text: t("settings.main.notice.refreshed") },
    "not-authorized": { tone: "danger", text: t("settings.main.notice.notAuthorized") },
    // Promos' own gate (`shop/[shopSlug]/promos/page.tsx`) bounces a
    // non-owner/manager here — a distinct code from `not-authorized` above
    // so it shows the promo-specific explanation rather than the rentals
    // one (task 82, UX persona 11 "Kai").
    "promos-not-authorized": { tone: "danger", text: t("promos.notice.notAuthorized") },
    // Same shape and the same reason: the WhatsApp page's own gate bounces a
    // non-owner/manager here, and the payment-settings wording above would
    // explain the wrong surface.
    "whatsapp-not-authorized": { tone: "danger", text: t("whatsapp.notice.not-authorized") },
    // Team and Import are the last two Settings sub-pages whose gate used to
    // teleport a refused staffer to Today saying nothing at all. Same rule as
    // the four above: bounce to the nearest parent surface with a code it
    // handles (task 82).
    "team-not-authorized": { tone: "danger", text: t("settings.team.notice.notAuthorized") },
    "import-not-authorized": { tone: "danger", text: t("settings.import.notice.notAuthorized") },
    // Backups hold the same bar as the export download — the destination
    // receives the whole shop, medical evidence included — and the same
    // bounce-with-an-explanation rule as every gate above.
    "backup-not-authorized": { tone: "danger", text: t("backup.notice.not-authorized") },
    "diving-options-saved": { tone: "success", text: t("boats.divingOptionsSaved") },
    "diving-options-invalid": { tone: "danger", text: t("boats.divingOptionsInvalid") },
    "diving-options-none": { tone: "danger", text: t("boats.divingOptionsNone") },
    "crew-schedule-saved": { tone: "success", text: t("settings.main.crewSchedule.saved") },
    "feature-saved": { tone: "success", text: t("settings.main.features.saved") },
    "crew-schedule-ratio-invalid": {
      tone: "danger",
      text: t("boats.divingOptionsRatioInvalid"),
    },
    "boat-created": { tone: "success", text: t("boats.boatCreated") },
    "boat-updated": { tone: "success", text: t("boats.boatUpdated") },
    "boat-deleted": { tone: "success", text: t("boats.boatDeleted") },
    "boat-invalid": { tone: "danger", text: t("boats.boatInvalid") },
    "lens-created": { tone: "success", text: t("lenses.created") },
    "lens-updated": { tone: "success", text: t("lenses.updated") },
    "lens-deleted": { tone: "success", text: t("lenses.deleted") },
    "lens-invalid": { tone: "danger", text: t("lenses.invalid") },
  };
}

/**
 * What an async group shows while its own read streams in: its heading, so the
 * hub's `#anchor` targets exist from the first paint and the rail's links land.
 */
function GroupFallback({ group, label }: Omit<Parameters<typeof SettingsGroup>[0], "children">) {
  return (
    <SettingsGroup group={group} label={label}>
      {null}
    </SettingsGroup>
  );
}

// Re-exported so the page test reads the same section registry the page uses,
// rather than carrying a second list of settings groups.
export { SECTION_IDS, SETTINGS_GROUPS, SettingsGroup };

/**
 * **The settings hub** — one component per group in `settings-groups.ts`
 * (`_components/groups/`), composed here. The hub reads what more than one group
 * needs once (the shop, the gates, the Stripe account); a group that needs a read
 * of its own (Boats & sites, Data) makes it itself under its own `<Suspense>`.
 */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; saved?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, saved } = await searchParams;
  // Every row on this page changes the shop rather than the day, so the page
  // itself is owner/manager work (src/lib/authz.ts — canManageShopSettings),
  // checked against live roles. Bounced to Today with an explanatory notice
  // rather than teleporting silently, exactly like the export and import pages
  // below it. `/settings/calendar` is deliberately outside this gate: a staff
  // calendar subscription is a personal feed, not shop policy.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const account = await getShopStripeAccount(db, session.user.shopId);
  const canPayments = await canPersonManagePaymentSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  // Only asked when the select that needs it will render — the warning below is
  // about what changing the currency would do, and most staff never see it.
  const hasPricedRecords = canPayments
    ? await shopHasPricedRecords(db, session.user.shopId)
    : false;
  // Asks the same resolvers the Connect flow itself asks, never the raw
  // variables: two of these three are compiled in now (src/lib/configured.ts),
  // so reading `process.env` directly would report "not configured" on a
  // deployment where the flow works perfectly. Only the secret key is a real
  // environment secret with nothing to fall back to.
  const connectConfigured = Boolean(
    process.env.STRIPE_SECRET_KEY &&
      configuredValue(process.env.STRIPE_CONNECT_CLIENT_ID, CONNECT_CLIENT_ID) &&
      publicAppUrl(),
  );
  const canImport = canImportShopData(session.user.roles);
  // Hiding the link is convenience; the page itself re-checks against live roles.
  const canManageMessaging = canManageMessagingSettings(session.user.roles);
  const canExport = canExportShopData(session.user.roles);
  // The same gates the nav registry hangs Team and the waiver template off
  // (src/lib/staff-destinations.ts), so a divemaster who has neither is never
  // shown a door that would bounce them (ADR
  // 20260724-role-gated-surfaces-hide-not-explain). Both pages re-check.
  const canManageTeam = canManageStaffAccounts(session.user.roles);
  const canManageWaivers = canManageWaiverTemplates(session.user.roles);
  // What the shop pays DiveDay — the trial, a free term, the card — is the
  // owner's alone, and a demo shop is never billed (ADR
  // 20261007-subscription-billing). The page re-checks against live roles.
  const canViewBilling = !shop.isDemo && canManageBilling(session.user.roles);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const banner = noticeFromParam(notice, noticeMessages(t));
  // A recognized section opens its own row and renders the notice inside it;
  // anything else (chiefly `not-authorized`, which spans several sections
  // rather than owning one) keeps the old top-of-page banner.
  const activeSection = (SECTION_IDS as readonly string[]).includes(saved ?? "")
    ? (saved as SectionId)
    : null;
  const view: SettingsView = {
    shop,
    shopSlug,
    t,
    locale,
    banner,
    activeSection,
    notSet: t("settings.main.summary.notSet"),
  };

  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice", "saved"]} />
      <ShopPageHeader title={t("shared.shopSections.settings")} />

      {banner && !activeSection ? (
        <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner>
      ) : null}

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any group or card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        <ShopGroup
          view={view}
          canPayments={canPayments}
          hasPricedRecords={hasPricedRecords}
          currencyMismatch={stripeCurrencyMismatch(toShopCurrency(shop.currency), account)}
          addressLookupEnabled={isAddressLookupConfigured()}
        />

        {canManageTeam ? <TeamGroup view={view} canManageTeam={canManageTeam} /> : null}

        <Suspense
          fallback={
            <GroupFallback group={BOATS_SITES_GROUP} label={t(BOATS_SITES_GROUP.labelKey)} />
          }
        >
          <BoatsSitesGroup view={view} db={db} />
        </Suspense>

        <BookingsGroup view={view} canManageWaivers={canManageWaivers} />

        {canPayments ? <RentalsGroup view={view} /> : null}

        <MoneyGroup
          view={view}
          canPayments={canPayments}
          account={account}
          connectConfigured={connectConfigured}
        />

        <MessagesGroup view={view} canManageMessaging={canManageMessaging} />

        <WebsiteGroup view={view} />

        <Suspense fallback={<GroupFallback group={DATA_GROUP} label={t(DATA_GROUP.labelKey)} />}>
          <DataGroup
            view={view}
            db={db}
            personId={session.user.personId}
            canExport={canExport}
            canImport={canImport}
          />
        </Suspense>

        <AccountGroup view={view} canViewBilling={canViewBilling} />

        {/* The stack's last child, so it sits a section's 40px under the last
            card like every section above it; on its own `mt-12` it sat 48px
            under (K-488). */}
        <footer className="border-t border-border pt-6 text-sm text-muted">
          <p>{t("settings.main.support.description")}</p>
          {/* A link under a paragraph, not inside a sentence, so it takes the
            44px floor: it was a 159×17 target at 390 (K-153). */}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
          >
            {t("settings.main.support.emailCta", { email: SUPPORT_EMAIL })}
          </a>
        </footer>
      </div>
    </main>
  );
}
