import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fragment } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { TimezoneOptions, type TimezoneZoneLabels } from "@/components/TimezoneOptions";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid, PriceField } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import {
  canPersonErasePersonalData,
  canPersonManagePaymentSettings,
  canPersonManageShopSettings,
} from "@/db/authz";
import { countBoatDepartures, listBoats } from "@/db/boats";
import { listDivePackages } from "@/db/dive-packages";
import { listSiteBottomTimeOverrides } from "@/db/dive-sites";
import { listPendingMediaDeletions } from "@/db/media-deletions";
import { listOwedProcessorErasures } from "@/db/processor-erasure";
import { shopHasPricedRecords } from "@/db/shops";
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
import { configuredValue } from "@/lib/configured";
import { MAX_PACKAGE_DIVE_COUNT, MAX_PACKAGE_VALIDITY_DAYS } from "@/lib/dive-packages";
import { MAX_DIVERS_PER_DIVEMASTER, MIN_DIVERS_PER_DIVEMASTER } from "@/lib/divemaster-ratio";
import {
  DOCK_DAY_FIELDS,
  DOCK_DAY_LIMITS,
  type DockDayStep,
  dockDayOffsets,
} from "@/lib/diver-planning";
import { EMERGENCY_LINE_SLOTS, hasEmergencyReference } from "@/lib/emergency-reference";
import { formatHourOfDay, formatMoneyScanned, formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { CONNECT_CLIENT_ID } from "@/lib/payments/connect";
import { SUPPORT_EMAIL, UPGRADE_EMAIL } from "@/lib/platform-mail";
import { RENTABLE_ITEMS, SHOP_CATALOG_ITEMS, toRentableKinds } from "@/lib/rentals";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  type CuratedTimeZone,
  type CuratedTimezoneGroupKey,
  DEFAULT_TIMEZONE,
} from "@/lib/timezones";
import { isTrialExpired, trialDaysRemaining, trialEndsAt } from "@/lib/trial";
import { SettingsDoorRow, SettingsRow, SettingsRowList } from "./_components/SettingsRows";
import { AddressSearch } from "./AddressSearch";
import {
  createBoatAction,
  createDivePackageAction,
  deleteBoatAction,
  deleteDivePackageAction,
  dischargeProcessorErasureAction,
  disconnectAction,
  refreshAction,
  retryMediaDeletionAction,
  retryProcessorErasureAction,
  saveContactAction,
  saveDivingOptionsAction,
  saveDockDayRhythmAction,
  saveEmergencyReferenceAction,
  savePackingAction,
  saveRentalItemsAction,
  saveRentalPricingAction,
  saveReviewUrlAction,
  saveSearchListingAction,
  saveSendWindowAction,
  saveTimezoneAction,
  saveUnitsAction,
  updateBoatAction,
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
    "packing-saved": { tone: "success", text: t("settings.main.notice.packingSaved") },
    "packing-invalid": { tone: "danger", text: t("settings.main.notice.packingInvalid") },
    "timezone-saved": { tone: "success", text: t("settings.main.notice.timezoneSaved") },
    "timezone-invalid": { tone: "danger", text: t("settings.main.notice.timezoneInvalid") },
    "dock-saved": { tone: "success", text: t("settings.main.notice.dockSaved") },
    "emergency-saved": { tone: "success", text: t("settings.main.notice.emergencySaved") },
    "dock-invalid": { tone: "danger", text: t("settings.main.notice.dockInvalid") },
    "send-window-saved": { tone: "success", text: t("settings.main.notice.sendWindowSaved") },
    "send-window-invalid": { tone: "danger", text: t("settings.main.notice.sendWindowInvalid") },
    "package-saved": { tone: "success", text: t("settings.main.notice.packageSaved") },
    "package-deleted": { tone: "success", text: t("settings.main.notice.packageDeleted") },
    "package-invalid": { tone: "danger", text: t("settings.main.notice.packageInvalid") },
    "units-saved": { tone: "success", text: t("settings.main.notice.unitsSaved") },
    "units-invalid": { tone: "danger", text: t("settings.main.notice.unitsInvalid") },
    "rentals-saved": { tone: "success", text: t("settings.main.notice.rentalsSaved") },
    "rental-prices-saved": { tone: "success", text: t("settings.main.notice.rentalPricesSaved") },
    "rental-prices-invalid": {
      tone: "danger",
      text: t("settings.main.notice.rentalPricesInvalid"),
    },
    "contact-saved": { tone: "success", text: t("settings.main.notice.contactSaved") },
    "contact-invalid": { tone: "danger", text: t("settings.main.notice.contactInvalid") },
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
    "diving-options-ratio-invalid": {
      tone: "danger",
      text: t("boats.divingOptionsRatioInvalid"),
    },
    "boat-created": { tone: "success", text: t("boats.boatCreated") },
    "boat-updated": { tone: "success", text: t("boats.boatUpdated") },
    "boat-deleted": { tone: "success", text: t("boats.boatDeleted") },
    "boat-invalid": { tone: "danger", text: t("boats.boatInvalid") },
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

// Re-exported so the page test reads the same section registry the page uses,
// rather than carrying a second list of settings groups.
export { SETTINGS_GROUPS };

type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];

const [YOUR_SHOP_GROUP, MONEY_GROUP, DATA_GROUP] = SETTINGS_GROUPS;

/**
 * Staff words for the beats of the dock day these fields produce. The
 * diver-facing page names the same steps from `diver.json`; these are the staff
 * bundle's own, because a shop owner configuring the rhythm and a diver reading
 * it are two different readers. Typed against `DockDayStep`, so a new beat is a
 * compile error here until it has a word — `return` included, even though the
 * preview stops before it, because a trip's return time is the trip's to state.
 */
const DOCK_DAY_STEP_KEYS: Record<DockDayStep, StaffMessageKey> = {
  arrive: "settings.main.dockCall.stepArrive",
  gearSetup: "settings.main.dockCall.stepGearSetup",
  briefing: "settings.main.dockCall.stepBriefing",
  departure: "settings.main.dockCall.stepDeparture",
  boatRide: "settings.main.dockCall.stepBoatRide",
  dive: "settings.main.dockCall.stepDive",
  surfaceInterval: "settings.main.dockCall.stepSurfaceInterval",
  return: "settings.main.dockCall.stepReturn",
};

/**
 * The rhythm's six fields, in the order they are read and edited: what a shop
 * does at the dock, then what the day looks like once the lines are off. One
 * row per field rather than six hand-written `<Field>`s, so the bounds always
 * come from `DOCK_DAY_LIMITS` — the same table the server action refuses
 * against and the same the table's CHECK constraints enforce.
 */
const DOCK_DAY_FIELD_KEYS: Record<
  (typeof DOCK_DAY_FIELDS)[number],
  { label: StaffMessageKey; description: StaffMessageKey }
> = {
  dockCallMinutes: {
    label: "settings.main.dockCall.dockCallLabel",
    description: "settings.main.dockCall.dockCallDescription",
  },
  gearSetupMinutes: {
    label: "settings.main.dockCall.gearSetupLabel",
    description: "settings.main.dockCall.gearSetupDescription",
  },
  briefingMinutes: {
    label: "settings.main.dockCall.briefingLabel",
    description: "settings.main.dockCall.briefingDescription",
  },
  boatRideMinutes: {
    label: "settings.main.dockCall.boatRideLabel",
    description: "settings.main.dockCall.boatRideDescription",
  },
  bottomTimeMinutes: {
    label: "settings.main.dockCall.bottomTimeLabel",
    description: "settings.main.dockCall.bottomTimeDescription",
  },
  surfaceIntervalMinutes: {
    label: "settings.main.dockCall.surfaceIntervalLabel",
    description: "settings.main.dockCall.surfaceIntervalDescription",
  },
};

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
  dive_site_photo: "settings.main.dataJobs.mediaKind.dive_site_photo",
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
 *
 * No outer margin: the page stacks its groups in one `space-y-10`, the same
 * rhythm `SectionCard` assumes (docs/design/forms-and-controls.md).
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
    <div>
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
 * The eleven forms on this page each carry their own section id through
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
  "searchListing",
  "packing",
  "dockCall",
  "sendWindow",
  "units",
  "divingOptions",
  "emergency",
  "boats",
  "rentals",
  "rentalPricing",
  "divePackages",
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
  const offeredKinds = new Set(toRentableKinds(shop.rentalItems));
  const account = await getShopStripeAccount(db, session.user.shopId);
  const ready = canAcceptPayments(account);
  const canPayments = await canPersonManagePaymentSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  // Only asked when the select that needs it will render — the warning below is
  // about what changing the currency would do, and most staff never see it.
  // Only for shops that sell them — an empty list plus the add form is what a
  // shop that has never used packages sees, and nothing else in the app changes
  // until the first one exists.
  const shopPackages = canPayments ? await listDivePackages(db, session.user.shopId) : [];
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
  // The two data-compliance queues that used to hang off the bottom of the
  // monthly report (see `actions.ts`). Read behind this page's own gate, which
  // is the same owner/manager role set the reports gate was, so the same people
  // see the same work. Both render nothing when empty — a shop that owes
  // nothing sees no panel, not an empty table.
  // Read alongside them because it answers a question the dock-day preview
  // below otherwise gets wrong: a site carrying its own
  // `expectedBottomTimeMinutes` overrides the shop-wide figure for any dive
  // that visits it, and the preview is drawn from the shop-wide figure alone.
  // Empty for a shop that has overridden nothing, and then the preview says
  // nothing extra.
  const [pendingMediaDeletions, owedProcessorErasures, siteBottomTimeOverrides, shopBoats] =
    await Promise.all([
      listPendingMediaDeletions(db, session.user.shopId),
      listOwedProcessorErasures(db, session.user.shopId),
      listSiteBottomTimeOverrides(db, session.user.shopId),
      listBoats(db, session.user.shopId),
    ]);
  // **How much history each hull carries**, so the confirm can say so before a
  // shop taps Delete. Sequential rather than a fan-out: this reads through the
  // same executor and a shop's fleet is a handful of rows
  // (`scripts/check-db-concurrency.mjs` is about transactions, but the shape is
  // the same argument — there is nothing to win here).
  const boatDepartures = new Map<string, number>();
  for (const boat of shopBoats) {
    boatDepartures.set(boat.id, await countBoatDepartures(db, session.user.shopId, boat.id));
  }
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
  const divePackagesValue = t("settings.main.divePackages.value", { count: shopPackages.length });
  const trialDaysLeft = trialDaysRemaining(shop.createdAt, nowDate());
  const trialExpired = isTrialExpired(shop.createdAt, nowDate());
  const trialEndLabel = formatShortDate(trialEndsAt(shop.createdAt), locale, shop.timezone);
  const banner = noticeFromParam(notice, noticeMessages(t));
  // A recognized section opens its own row and renders the notice inside it;
  // anything else (chiefly `not-authorized`, which spans several sections
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
  const sendWindowValue = t("settings.main.sendWindow.value", {
    start: formatHourOfDay(shop.sendWindowStartHour, locale),
    end: formatHourOfDay(shop.sendWindowEndHour, locale),
  });
  const unitsValue = [
    t(shop.depthUnit === "feet" ? "settings.main.units.feet" : "settings.main.units.meters"),
    t(
      shop.temperatureUnit === "fahrenheit"
        ? "settings.main.units.fahrenheit"
        : "settings.main.units.celsius",
    ),
    shopCurrency.toUpperCase(),
  ].join(" · ");
  const divingOptionsValue = [
    shop.hasBoatDiving ? t("boats.boatEnabled") : t("boats.boatDisabled"),
    shop.hasShoreDiving ? t("boats.shoreEnabled") : t("boats.shoreDisabled"),
    shop.hasPoolDiving ? t("boats.poolEnabled") : t("boats.poolDisabled"),
    // The row's other setting, in the notation the rest of the product shows it
    // in. A hub row states what it holds, and a target nobody can see without
    // opening the row is a target nobody remembers they set.
    t("boats.diversPerDivemasterValue", { ratio: shop.diversPerDivemaster }),
  ].join(" · ");
  const boatsValue =
    shopBoats.length > 0 ? t("boats.value", { count: shopBoats.length }) : t("boats.noBoats");
  // A count, not the numbers themselves: this row is read on the hub and the
  // numbers belong on the boat, not on a settings list somebody is scrolling.
  const emergencyValue = hasEmergencyReference(shop.emergencyReference)
    ? t("settings.main.emergency.value", { count: shop.emergencyReference.lines.length })
    : t("settings.main.emergency.empty");
  const rentalsValue = t("settings.main.rentals.value", { count: offeredKinds.size });
  const rentalPricingValue =
    shop.rentalPricing.setCents !== null
      ? t("settings.main.rentalPricing.value", {
          price: formatMoneyScanned(shop.rentalPricing.setCents, shopCurrency, locale),
        })
      : notSet;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "saved"]} />
      <ShopPageHeader eyebrow={t("settings.main.eyebrow")} title={t("settings.main.title")} />

      {banner && !activeSection ? (
        <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner>
      ) : null}

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any group or card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
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
                          Object.entries(CURATED_TIMEZONE_KEYS).map(([zone, key]) => [
                            zone,
                            t(key),
                          ]),
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

            {/* Beside the review link, because both rows are about the shop's
              public face rather than its operations. A shop is listed by
              default and the box says so; unticking it drops the shop out of
              sitemap.xml *and* makes its public pages emit robots: noindex
              (ADR 20260813-search-listing-is-a-choice). */}
            <SettingsRow
              heading={t("settings.main.searchListing.heading")}
              value={
                shop.searchListingOptOutAt
                  ? t("settings.main.searchListing.valueHidden")
                  : t("settings.main.searchListing.valueListed")
              }
              detail={t("settings.main.searchListing.detail")}
              open={activeSection === "searchListing"}
              openOnHash="search-listing"
              anchorId="search-listing"
            >
              <SectionNotice banner={banner} section="searchListing" active={activeSection} />
              <FieldGrid as="form" action={saveSearchListingAction} columns={1} className="mt-4">
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    name="searchListed"
                    type="checkbox"
                    defaultChecked={!shop.searchListingOptOutAt}
                    className="size-4 accent-primary"
                  />
                  {t("settings.main.searchListing.label")}
                </label>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("settings.main.searchListing.submitting")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("settings.main.searchListing.submit")}
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
              {/* Six numbers, one save. The day used to come out of the single
                arrival-call box below: the briefing was half of it capped at
                15, and the two beats on the water were the trip window's own
                thirds — so a shop that briefs on the boat, kits up on board,
                walks in off a beach, or runs one tank had no way to say so and
                read DiveDay telling their divers a day they don't run. Each
                field states what zero means where zero is meaningful, because
                "0" is how a shop says "we don't do that one". */}
              <FieldGrid
                as="form"
                action={saveDockDayRhythmAction}
                columns={2}
                className="mt-4 gap-x-5 gap-y-5"
              >
                {DOCK_DAY_FIELDS.map((field) => (
                  <Field
                    key={field}
                    label={t(DOCK_DAY_FIELD_KEYS[field].label)}
                    description={t(DOCK_DAY_FIELD_KEYS[field].description)}
                  >
                    <input
                      name={field}
                      type="number"
                      inputMode="numeric"
                      required
                      min={DOCK_DAY_LIMITS[field].min}
                      max={DOCK_DAY_LIMITS[field].max}
                      step={5}
                      defaultValue={shop[field]}
                      className={`${controlClass} tabular-nums`}
                    />
                  </Field>
                ))}
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("settings.main.dockCall.submitting")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("settings.main.dockCall.submit")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
              {/* The answer to "where do I set the dock-day rhythm?" — which used
                to be nowhere a reader could see. Showing the beats the fields
                produce, as offsets from departure, is what makes the form and
                the diver-facing timeline visibly the same thing. Offsets, not
                clock times: this row is about every departure, not one — which
                is also why it stops at the last dive rather than inventing a
                return, since each trip publishes its own. Two dives, because
                that is what most of this catalogue is; a departure's own
                planned count is what the diver's page lays out. */}
              <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
                {dockDayOffsets(shop).map(({ step, number, minutesFromDeparture }) => (
                  <div key={`${step}-${number ?? 0}`} className="flex items-baseline gap-2">
                    <dt>{t(DOCK_DAY_STEP_KEYS[step], { number: number ?? 1 })}</dt>
                    <dd className="font-medium text-foreground tabular-nums">
                      {minutesFromDeparture === 0
                        ? t("settings.main.dockCall.atDeparture")
                        : minutesFromDeparture < 0
                          ? t("settings.main.dockCall.minutesBefore", {
                              count: -minutesFromDeparture,
                            })
                          : t("settings.main.dockCall.minutesAfter", {
                              count: minutesFromDeparture,
                            })}
                    </dd>
                  </div>
                ))}
              </dl>
              {/* The preview above describes every departure except the ones it
                doesn't. A site with its own `expected_bottom_time_minutes`
                overrides "Time in the water per dive" for any dive that visits
                it, and until this line the number could be read nowhere but the
                box that wrote it — a shop that overrode five of its eight sites
                read a preview silently wrong for five of them
                (FU-20260812-site-bottom-time-is-write-only). Each site is a
                link, because the answer to "why does that one differ?" is the
                site's own page. A shop that has overridden nothing sees
                nothing. */}
              {siteBottomTimeOverrides.length > 0 ? (
                <div className="mt-3">
                  <p className="text-sm text-muted">
                    {t("settings.main.dockCall.siteOverrides", {
                      count: siteBottomTimeOverrides.length,
                    })}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {siteBottomTimeOverrides.map((site) => (
                      <li key={site.id}>
                        <a
                          href={`/shop/${shopSlug}/dive-sites/${site.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {t("settings.main.dockCall.siteOverride", {
                            name: site.name,
                            count: site.minutes,
                          })}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </SettingsRow>

            {/* One row for the three units a shop reads its own numbers in.
              Depth stays stored in metres and water temperature in Celsius
              whatever these say (H-08); currency is the one that reinterprets
              rather than converts, which is what its own marker explains. The
              three are genuinely independent — a Caribbean operator serving
              American divers publishes feet and Celsius — so they are three
              fields, not one. */}
            {/* **When the shop's own messages may reach a diver.** Beside the
              dock-day rhythm because both are about the shape of a shop's day,
              and directly after it because a shop reading "we brief at 7:15"
              is already thinking in its own clock. */}
            <SettingsRow
              heading={t("settings.main.sendWindow.heading")}
              value={sendWindowValue}
              description={t("settings.main.sendWindow.description")}
              open={activeSection === "sendWindow"}
            >
              <SectionNotice banner={banner} section="sendWindow" active={activeSection} />
              <FieldGrid
                as="form"
                action={saveSendWindowAction}
                columns={2}
                className="mt-4 gap-x-5 gap-y-5"
              >
                <Field label={t("settings.main.sendWindow.startLabel")}>
                  <input
                    name="sendWindowStartHour"
                    type="number"
                    inputMode="numeric"
                    required
                    min={0}
                    max={23}
                    defaultValue={shop.sendWindowStartHour}
                    className={`${controlClass} tabular-nums`}
                  />
                </Field>
                <Field label={t("settings.main.sendWindow.endLabel")}>
                  <input
                    name="sendWindowEndHour"
                    type="number"
                    inputMode="numeric"
                    required
                    min={1}
                    max={24}
                    defaultValue={shop.sendWindowEndHour}
                    className={`${controlClass} tabular-nums`}
                  />
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("settings.main.sendWindow.submitting")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("settings.main.sendWindow.submit")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
            </SettingsRow>

            <SettingsRow
              heading={t("settings.main.units.heading")}
              value={unitsValue}
              open={activeSection === "units"}
              // The setup checklist's currency-and-depth step links to
              // `settings#units`, and for as long as this row carried neither
              // of these that link did **nothing**: the page loaded at the top
              // with the row still shut, leaving a brand-new shop to hunt for
              // the one setting it had just been sent to answer. The row is a
              // `<details>`, so a fragment only reveals it when the target is
              // *inside* it (`anchorId`) or `AutoOpenDetails` opens it on a
              // client navigation (`openOnHash`) — which is why the three rows
              // that already had deep links have both.
              openOnHash="units"
              anchorId="units"
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
                {/* **What changing it will do**, and only once there is
                    something for it to do it to. `price_cents` counts the
                    *current* currency's minor unit and nothing converts on a
                    switch, so a shop that priced a $95 trip and moves to pesos
                    is left with a ninety-five peso trip (ADR
                    20260731-shop-currency). Before any money exists the change
                    is free, and saying this to a shop on its first afternoon
                    would be noise (issue #712). Informs, never refuses: the
                    shop that genuinely set the wrong currency needs that select
                    to work.

                    Outside the `<Field>`, not inside it: `Field`'s contract is
                    a single control, and a second child makes it fall back to
                    wrapping everything in the `<label>` — which folded this
                    sentence into the select's accessible *name* and broke every
                    `getByLabel("Charge and display in")` in the suite. */}
                {canPayments && hasPricedRecords ? (
                  <p className="text-sm text-warning-strong sm:col-span-2">
                    {t("settings.main.units.currencyRepricingWarning")}
                  </p>
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

            <SettingsRow
              heading={t("boats.divingOptionsHeading")}
              value={divingOptionsValue}
              open={activeSection === "divingOptions"}
            >
              <SectionNotice banner={banner} section="divingOptions" active={activeSection} />
              <FieldGrid as="form" action={saveDivingOptionsAction} columns={1} className="mt-4">
                {/* Boat first, and on by default: it is what the product assumed
                    before this row existed, and what `trips.dive_mode` still
                    defaults to. Turning it off is what hides the Boats row
                    below and takes the hull out of the Requests planner. */}
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    name="hasBoatDiving"
                    type="checkbox"
                    defaultChecked={shop.hasBoatDiving}
                    className="size-4 accent-primary"
                  />
                  <div>
                    <p className="font-medium">{t("boats.boatDivingLabel")}</p>
                    <p className="text-xs text-muted">{t("boats.boatDivingDescription")}</p>
                  </div>
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm mt-2">
                  <input
                    name="hasShoreDiving"
                    type="checkbox"
                    defaultChecked={shop.hasShoreDiving}
                    className="size-4 accent-primary"
                  />
                  <div>
                    <p className="font-medium">{t("boats.shoreDivingLabel")}</p>
                    <p className="text-xs text-muted">{t("boats.shoreDivingDescription")}</p>
                  </div>
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm mt-2">
                  <input
                    name="hasPoolDiving"
                    type="checkbox"
                    defaultChecked={shop.hasPoolDiving}
                    className="size-4 accent-primary"
                  />
                  <div>
                    <p className="font-medium">{t("boats.poolDivingLabel")}</p>
                    <p className="text-xs text-muted">{t("boats.poolDivingDescription")}</p>
                  </div>
                </label>
                {/* Asked of every shop, unlike the "divers per departure" it
                    replaced: a hull's seat count is a fact about the boat, and
                    this is a statement about who is in the water — which a
                    beach, a pool and a boat all need an answer to. */}
                <Field
                  label={t("boats.diversPerDivemasterLabel")}
                  hint={t("boats.diversPerDivemasterHint")}
                  className="mt-2"
                >
                  <input
                    name="diversPerDivemaster"
                    type="number"
                    inputMode="numeric"
                    min={MIN_DIVERS_PER_DIVEMASTER}
                    max={MAX_DIVERS_PER_DIVEMASTER}
                    defaultValue={shop.diversPerDivemaster}
                    className={controlClass}
                  />
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("boats.divingOptionsSubmitting")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("boats.divingOptionsSubmit")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
            </SettingsRow>

            {/* A shore-and-pool shop has no hulls to name, so the row is gone
                rather than empty — an empty control for a thing you do not own
                is a question you have to answer twice. Existing boat rows are
                left alone: turning the option back on brings the fleet back
                exactly as it was. */}
            {/* **Above the fleet, and not gated on boat diving.** A shore
                operation's crew needs a chamber number exactly as much as a
                boat's does. Its own row rather than a line inside another
                because it is the one thing on this page a crew reads when
                something has gone wrong (issue #688). */}
            <SettingsRow
              heading={t("settings.main.emergency.heading")}
              value={emergencyValue}
              open={activeSection === "emergency"}
            >
              <SectionNotice banner={banner} section="emergency" active={activeSection} />
              <form action={saveEmergencyReferenceAction} className="mt-4 flex flex-col gap-4">
                <p className="text-sm text-muted">{t("settings.main.emergency.intro")}</p>
                <FieldGrid columns={2}>
                  {EMERGENCY_LINE_SLOTS.map((slot, index) => (
                    <Fragment key={slot}>
                      <Field label={t("settings.main.emergency.lineLabel", { n: index + 1 })}>
                        <input
                          name={`emergencyLabel-${index}`}
                          type="text"
                          maxLength={80}
                          defaultValue={shop.emergencyReference.lines[index]?.label ?? ""}
                          placeholder={t("settings.main.emergency.linePlaceholder")}
                          className={controlClass}
                        />
                      </Field>
                      <Field label={t("settings.main.emergency.phoneLabel", { n: index + 1 })}>
                        <input
                          name={`emergencyPhone-${index}`}
                          type="tel"
                          maxLength={40}
                          defaultValue={shop.emergencyReference.lines[index]?.phone ?? ""}
                          className={controlClass}
                        />
                      </Field>
                    </Fragment>
                  ))}
                  <Field label={t("settings.main.emergency.vesselLabel")}>
                    <input
                      name="emergencyVessel"
                      type="text"
                      maxLength={120}
                      defaultValue={shop.emergencyReference.vessel}
                      className={controlClass}
                    />
                  </Field>
                  <Field label={t("settings.main.emergency.shoreContactLabel")}>
                    <input
                      name="emergencyShoreContact"
                      type="text"
                      maxLength={160}
                      defaultValue={shop.emergencyReference.shoreContact}
                      className={controlClass}
                    />
                  </Field>
                </FieldGrid>
                <Field label={t("settings.main.emergency.planLabel")}>
                  <textarea
                    name="emergencyPlan"
                    rows={4}
                    maxLength={2000}
                    defaultValue={shop.emergencyReference.plan}
                    className={controlClass}
                  />
                </Field>
                <div>
                  <SubmitButton
                    pendingLabel={t("settings.main.emergency.saving")}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {t("settings.main.emergency.submit")}
                  </SubmitButton>
                </div>
              </form>
            </SettingsRow>
            {shop.hasBoatDiving ? (
              <SettingsRow
                heading={t("boats.heading")}
                value={boatsValue}
                open={activeSection === "boats"}
              >
                <SectionNotice banner={banner} section="boats" active={activeSection} />
                <div className="space-y-4 mt-4">
                  {shopBoats.length === 0 ? (
                    <p className="text-sm text-muted italic">{t("boats.noBoats")}</p>
                  ) : (
                    <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                      {shopBoats.map((boat) => (
                        <div
                          key={boat.id}
                          className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-surface"
                        >
                          <form
                            action={updateBoatAction}
                            className="flex flex-1 flex-col sm:flex-row items-start sm:items-center gap-3 w-full"
                          >
                            <input type="hidden" name="boatId" value={boat.id} />
                            <div className="flex-1 w-full">
                              <input
                                name="name"
                                type="text"
                                required
                                defaultValue={boat.name}
                                placeholder={t("boats.nameLabel")}
                                className={controlClass}
                              />
                            </div>
                            <div className="w-full sm:w-32 flex items-center gap-2">
                              <input
                                name="capacity"
                                type="number"
                                required
                                min={1}
                                defaultValue={boat.capacity}
                                placeholder={t("boats.capacityLabel")}
                                className={`${controlClass} tabular-nums`}
                              />
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                              <SubmitButton
                                pendingLabel={t("boats.submitting")}
                                className={buttonClass({ variant: "secondary", size: "sm" })}
                              >
                                {t("boats.submit")}
                              </SubmitButton>
                            </div>
                          </form>
                          {/* Its own form, beside the update rather than inside
                            it: `InlineConfirm` submits the form it sits in, and
                            forms cannot nest. */}
                          <form action={deleteBoatAction} className="shrink-0">
                            <input type="hidden" name="boatId" value={boat.id} />
                            {/* **The confirm says what the delete touches.** A
                              hull that has carried departures is history an
                              insurer asks about — the count is the fact a shop
                              cannot get from this row, and it is why this is a
                              blocking confirm rather than a bare button. A boat
                              that never sailed goes quietly, with no message to
                              read. Nothing is destroyed either way; the word is
                              still "Delete" and the shop is never told about a
                              column (ADR 20260820-every-delete-is-soft). */}
                            {boatDepartures.get(boat.id) ? (
                              <InlineConfirm
                                triggerLabel={t("boats.deleteBoat")}
                                message={t("boats.deleteBoatDepartures", {
                                  count: boatDepartures.get(boat.id) ?? 0,
                                })}
                                cancelLabel={t("boats.deleteBoatCancel")}
                                confirmLabel={t("boats.deleteBoatConfirm")}
                                pendingLabel={t("boats.deleteBoatPending")}
                                triggerClassName={buttonClass({ variant: "danger", size: "sm" })}
                              />
                            ) : (
                              <InlineConfirm
                                triggerLabel={t("boats.deleteBoat")}
                                confirmLabel={t("boats.deleteBoatConfirm")}
                                pendingLabel={t("boats.deleteBoatPending")}
                                triggerClassName={buttonClass({ variant: "danger", size: "sm" })}
                              />
                            )}
                          </form>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border border-dashed border-border rounded-lg p-4 bg-surface-sunken">
                    <h4 className="text-sm font-medium mb-3">{t("boats.createTitle")}</h4>
                    <form
                      action={createBoatAction}
                      className="flex flex-col sm:flex-row items-start sm:items-center gap-3"
                    >
                      <div className="flex-1 w-full">
                        <input
                          name="name"
                          type="text"
                          required
                          placeholder={t("boats.nameLabel")}
                          className={controlClass}
                        />
                      </div>
                      <div className="w-full sm:w-32">
                        <input
                          name="capacity"
                          type="number"
                          required
                          min={1}
                          placeholder={t("boats.capacityLabel")}
                          className={`${controlClass} tabular-nums`}
                        />
                      </div>
                      <SubmitButton
                        pendingLabel={t("boats.submitting")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("boats.addBoat")}
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </SettingsRow>
            ) : null}
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
                    className={buttonClass({ variant: "secondary" })}
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

                {/* **The shop's prepaid packages.** Beside the rental prices
                    because both are the shop's own price list, and behind the
                    same payment gate as everything else in this group. Opt-in
                    by presence: a shop that has never defined one sees an empty
                    list and an add form, and nothing anywhere else in the app
                    changes until the first one exists (ADR
                    20260822-a-package-is-entitlements-not-money). */}
                <SettingsRow
                  heading={t("settings.main.divePackages.heading")}
                  value={divePackagesValue}
                  description={t("settings.main.divePackages.description")}
                  open={activeSection === "divePackages"}
                >
                  <SectionNotice banner={banner} section="divePackages" active={activeSection} />
                  {shopPackages.length > 0 ? (
                    <ul className="mt-4 flex flex-col gap-2">
                      {shopPackages.map((pkg) => (
                        <li
                          key={pkg.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
                        >
                          <span className="min-w-0">
                            <span className="font-medium">{pkg.name}</span>{" "}
                            <span className="text-sm text-muted">
                              {t("settings.main.divePackages.summary", {
                                dives: pkg.diveCount,
                                price: formatMoneyScanned(pkg.priceCents, shop.currency, locale),
                                scope: t(
                                  pkg.scope === "fun_dives"
                                    ? "settings.main.divePackages.scopeFunDives"
                                    : "settings.main.divePackages.scopeAll",
                                ),
                              })}
                            </span>
                          </span>
                          {/* Says "Delete", and is soft underneath (ADR
                              20260820-every-delete-is-soft). No sentence
                              explains that the dives somebody already bought
                              survive: reversibility is a promise we keep, not a
                              concept the reader holds — and here the softness
                              is load-bearing rather than conventional, because
                              the entitlements reference this row. */}
                          <form action={deleteDivePackageAction}>
                            <input type="hidden" name="packageId" value={pkg.id} />
                            <SubmitButton
                              pendingLabel={t("settings.main.divePackages.deleting")}
                              className={buttonClass({ variant: "secondary", size: "sm" })}
                            >
                              {t("settings.main.divePackages.delete")}
                            </SubmitButton>
                          </form>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <FieldGrid
                    as="form"
                    action={createDivePackageAction}
                    columns={2}
                    className="mt-4 gap-x-5 gap-y-5"
                  >
                    <Field label={t("settings.main.divePackages.nameLabel")}>
                      <input name="name" required maxLength={80} className={controlClass} />
                    </Field>
                    <Field label={t("settings.main.divePackages.diveCountLabel")}>
                      <input
                        name="diveCount"
                        type="number"
                        inputMode="numeric"
                        required
                        min={1}
                        max={MAX_PACKAGE_DIVE_COUNT}
                        className={`${controlClass} tabular-nums`}
                      />
                    </Field>
                    <Field label={t("settings.main.divePackages.priceLabel")}>
                      <input
                        name="priceDollars"
                        type="number"
                        inputMode="decimal"
                        required
                        min={1}
                        step="0.01"
                        className={`${controlClass} tabular-nums`}
                      />
                    </Field>
                    <Field
                      label={t("settings.main.divePackages.validityLabel")}
                      description={t("settings.main.divePackages.validityDescription")}
                    >
                      <input
                        name="validityDays"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_PACKAGE_VALIDITY_DAYS}
                        className={`${controlClass} tabular-nums`}
                      />
                    </Field>
                    <Field label={t("settings.main.divePackages.scopeLabel")}>
                      <select name="scope" defaultValue="all" className={controlClass}>
                        <option value="all">{t("settings.main.divePackages.scopeAll")}</option>
                        <option value="fun_dives">
                          {t("settings.main.divePackages.scopeFunDives")}
                        </option>
                      </select>
                    </Field>
                    <FieldActions>
                      <SubmitButton
                        pendingLabel={t("settings.main.divePackages.submitting")}
                        className={buttonClass({ variant: "secondary" })}
                      >
                        {t("settings.main.divePackages.submit")}
                      </SubmitButton>
                    </FieldActions>
                  </FieldGrid>
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
                            <a
                              href={`/shop/${shopSlug}/settings/connect`}
                              className={buttonClass()}
                            >
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
                <p className="mt-1 text-sm">
                  {t("settings.main.dataJobs.processorErasures.detail")}
                </p>
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
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-sm text-muted">
        <p>{t("settings.main.support.description")}</p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">
          {t("settings.main.support.emailCta", { email: SUPPORT_EMAIL })}
        </a>
      </footer>
    </main>
  );
}
