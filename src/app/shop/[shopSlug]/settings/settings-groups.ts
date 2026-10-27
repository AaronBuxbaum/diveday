import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import {
  canManageBilling,
  canManageMessagingSettings,
  canManagePaymentSettings,
  canManageShopSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
  type Role,
} from "@/lib/authz";
import { FEATURE_ROWS, type FeatureRowGate } from "./features/feature-rows";

/**
 * The settings hub's one list of groups, in render order: **eight**, split by
 * who the setting is about (issue #2813, Aaron 2026-10-17). It was twelve,
 * with rows filed by where they were built (a staffer's own email under
 * Notifications, a login's password beside the shop's subscription, "Rarely
 * changed" for how often a row is opened). What is about the reader (security,
 * calendar feed, email) is **My account** in the identity menu, not here; the
 * shop's registers (dive sites, boats, trip tags, the checklist) are doors in
 * Shop; Export, Import, Backups and Integrations are the tabs of one Your data.
 * `SettingsPage.tsx` renders its sections from this one list. It remains a
 * registry rather than local constants so a new section cannot drift from the
 * hub's section order or its test coverage.
 *
 * It used to carry a second list, `SETTINGS_DESTINATIONS`: the six full-page
 * settings surfaces, which a sub-nav card rendered as grouped pills above
 * every one of their `<h1>`s. That card is gone (a sub-page's way back is now
 * its own eyebrow, `ShopPageHeader`'s `eyebrowHref`); what stands in its place
 * is not that card returning but `SETTINGS_RAIL_ROWS` below — a left rail at
 * `lg` and up only, never above the phone's content (ADR
 * 20260827-clearwater-surface-language, decision 6).
 */
export const SETTINGS_GROUPS = [
  { id: "shop", labelKey: "settings.main.groups.shop" },
  { id: "team", labelKey: "settings.main.groups.team" },
  { id: "bookings", labelKey: "settings.main.groups.bookings" },
  { id: "money", labelKey: "settings.main.groups.money" },
  { id: "messages", labelKey: "settings.main.groups.messages" },
  { id: "website", labelKey: "settings.main.groups.website" },
  { id: "features", labelKey: "settings.main.groups.features" },
  { id: "data", labelKey: "settings.main.groups.data" },
] as const satisfies readonly { id: string; labelKey: StaffMessageKey }[];

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];
export type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];

/**
 * The forms that are still **rows on the hub** each carry their own section id
 * through `?saved=<id>` (set by the action that redirects back here), so the row
 * that changed comes back *open*, with the notice rendered inside it — a closed
 * disclosure hiding a refusal would be a form the staffer cannot see failed
 * (the same rule the trip About panel's rows state).
 *
 * **A row whose editor is a list, or more than about three fields, is not on
 * this list — it has a page.** Boats, trip tags and dive packages each opened
 * onto a run of forms with a Save and a Delete on every line; what the shop
 * rents, its rental prices, the emergency reference, the dock-day rhythm and
 * the shop profile were forms of six to a dozen fields (#1854). The
 * hub is a directory, and a directory row states an answer and opens the form
 * that changes it (ADR 20260827-clearwater-surface-language, decision 6). Those
 * are `route` rows below and `SettingsDoorRow`s on the hub (dive packages has
 * since moved under Money's Discounts tab); their actions
 * redirect to their own page with a plain `?notice=`.
 *
 * It lives here rather than in `SettingsPage.tsx` because the rail below needs
 * the same vocabulary, and two lists of section ids is exactly the drift ADR
 * 20260827-clearwater-surface-language's decision 6 would otherwise produce.
 */
export const SECTION_IDS = [
  "timezone",
  "season",
  "contact",
  "shopPhotos",
  "address",
  "reviewLink",
  "deskHours",
  "searchListing",
  "packing",
  "counterCard",
  "certCheck",
  "units",
  "juniorBuddy",
  "crewSchedule",
  "passThrough",
  "stripe",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/**
 * The fragment a section answers to, which is **not** always its id: several
 * rows carried a kebab anchor before the rail existed and other surfaces link
 * to them by name (`/settings#review-link`, `/settings#search-listing`). ADR
 * 20260827-clearwater-surface-language's 6g pins that neither the ids nor the
 * fragments move — the pane scrolls, the targets stay put — so the two
 * spellings are reconciled here once instead of at each call site.
 */
const SECTION_FRAGMENTS: Partial<Record<SectionId, string>> = {
  reviewLink: "review-link",
  deskHours: "desk-hours",
  searchListing: "search-listing",
  crewSchedule: "crew-schedule",
  passThrough: "pass-through",
  counterCard: "counter-card",
  certCheck: "cert-check",
};

/** The `#fragment` that opens and scrolls to a hub section. */
export function settingsSectionFragment(id: SectionId): string {
  return SECTION_FRAGMENTS[id] ?? id;
}

/**
 * A permission (or shop-shape) condition a rail row shares with the hub row it
 * points at. The rail may **hide** a row its reader cannot reach; it never
 * grants one — every destination re-checks server-side, which is what keeps
 * this a convenience rather than a gate.
 */
export type SettingsRailGate =
  | "payments"
  | "team"
  | "waivers"
  | "messaging"
  | "boats"
  | "billing"
  | "selfRegistration";

/**
 * The one warning a rail row may carry, named as a code rather than a
 * sentence: the panel resolves it from the same summary reader the hub row
 * already uses (`canAcceptPayments`), never from a query of the rail's own.
 */
export type SettingsRailBadgeSource = "payments";

/**
 * One row of the rail. `target` is the whole selection model: a `section` row
 * is a `#fragment` link into the pane and selects by scroll position; a
 * `route` row is a sub-route (or an out-of-namespace door) and selects by
 * pathname. Nothing else selects, and the two never blur —
 * `currentSettingsRailRowId` below is the single place that decides.
 */
export type SettingsRailRow = {
  id: string;
  labelKey: StaffMessageKey;
  group: SettingsGroupId;
  target:
    | { kind: "section"; id: SectionId }
    // `also`: the other paths of the same place (the tabs of Your data), so
    // standing on any of them lights this one row.
    | { kind: "route"; path: string; also?: readonly string[] };
  gate?: SettingsRailGate;
  badgeSource?: SettingsRailBadgeSource;
};

/**
 * **The whole settings map, in the pane's own order** — ADR
 * 20260827-clearwater-surface-language, decision 6.
 *
 * Two rules hold it to the hub. It covers every `SECTION_IDS` entry, so no
 * section of the pane is unreachable from the rail; and it covers every door
 * the hub renders, including the two that leave the `/settings` namespace
 * (dive sites, waivers). Both are pinned in
 * `_components/SettingsRail.test.tsx` against the hub's own render, so a row
 * added to one and missed on the other fails rather than quietly falling off
 * the map.
 *
 * The order is the pane's reading order, not an editorial one: the scroll-spy
 * walks these rows against the sections' positions, and a rail that disagreed
 * with the page would light the wrong row.
 */
export const SETTINGS_RAIL_ROWS: readonly SettingsRailRow[] = [
  {
    id: "bookkeeper",
    labelKey: "reports.bookkeeper.label",
    group: "money",
    target: { kind: "route", path: "/settings/bookkeeper" },
  },
  {
    id: "timezone",
    labelKey: "settings.main.timezone.heading",
    group: "shop",
    target: { kind: "section", id: "timezone" },
  },
  {
    id: "units",
    labelKey: "settings.main.units.heading",
    group: "shop",
    target: { kind: "section", id: "units" },
  },
  {
    id: "juniorBuddy",
    labelKey: "settings.main.juniorBuddy.heading",
    group: "shop",
    target: { kind: "section", id: "juniorBuddy" },
  },
  {
    id: "address",
    labelKey: "settings.main.address.heading",
    group: "shop",
    target: { kind: "section", id: "address" },
  },
  {
    id: "season",
    labelKey: "settings.main.season.heading",
    group: "shop",
    target: { kind: "section", id: "season" },
  },
  {
    id: "searchListing",
    labelKey: "settings.main.searchListing.heading",
    group: "shop",
    target: { kind: "section", id: "searchListing" },
  },
  {
    id: "emergency",
    labelKey: "settings.main.emergency.heading",
    group: "shop",
    target: { kind: "route", path: "/settings/emergency-reference" },
  },
  {
    id: "diveSites",
    labelKey: "settings.main.diveSites.heading",
    group: "shop",
    target: { kind: "route", path: "/dive-sites" },
  },
  {
    id: "boats",
    labelKey: "boats.heading",
    group: "shop",
    target: { kind: "route", path: "/boats" },
    gate: "boats",
  },
  {
    id: "tripTags",
    labelKey: "lenses.heading",
    group: "shop",
    target: { kind: "route", path: "/trip-tags" },
  },
  {
    id: "safetyChecklist",
    labelKey: "settings.main.safetyChecklist.heading",
    group: "shop",
    target: { kind: "route", path: "/safety-checklist" },
  },
  {
    id: "team",
    labelKey: "settings.main.team.heading",
    group: "team",
    target: { kind: "route", path: "/settings/team" },
    gate: "team",
  },
  {
    id: "crewSchedule",
    labelKey: "settings.main.crewSchedule.heading",
    group: "team",
    target: { kind: "section", id: "crewSchedule" },
    gate: "team",
  },
  {
    id: "activity",
    labelKey: "activity.log.title",
    group: "team",
    target: { kind: "route", path: "/settings/activity" },
  },
  {
    id: "waivers",
    labelKey: "settings.main.waivers.heading",
    group: "bookings",
    target: { kind: "route", path: "/waivers" },
    gate: "waivers",
  },
  {
    id: "counterCard",
    labelKey: "settings.main.counterQr.heading",
    group: "bookings",
    target: { kind: "section", id: "counterCard" },
    // Counter sign-up switched off on Features: no card to find.
    gate: "selfRegistration",
  },
  {
    id: "certCheck",
    labelKey: "settings.main.certCheck.heading",
    group: "bookings",
    target: { kind: "section", id: "certCheck" },
  },
  {
    id: "packing",
    labelKey: "settings.main.packing.heading",
    group: "bookings",
    target: { kind: "section", id: "packing" },
  },
  {
    id: "dockCall",
    labelKey: "settings.main.dockCall.heading",
    group: "bookings",
    target: { kind: "route", path: "/settings/dock-day" },
  },
  {
    id: "rentals",
    labelKey: "settings.main.rentals.heading",
    group: "bookings",
    target: { kind: "route", path: "/settings/rentals" },
    gate: "payments",
  },
  {
    id: "passThrough",
    labelKey: "settings.main.passThrough.heading",
    group: "money",
    target: { kind: "section", id: "passThrough" },
    gate: "payments",
  },
  {
    id: "stripe",
    labelKey: "settings.main.stripe.rowHeading",
    group: "money",
    target: { kind: "section", id: "stripe" },
    gate: "payments",
    badgeSource: "payments",
  },
  {
    id: "billing",
    labelKey: "billing.title",
    group: "money",
    target: { kind: "route", path: "/settings/billing" },
    gate: "billing",
  },
  {
    id: "contact",
    labelKey: "settings.main.contact.heading",
    group: "messages",
    target: { kind: "section", id: "contact" },
  },
  {
    id: "deskHours",
    labelKey: "settings.main.deskHours.heading",
    group: "messages",
    target: { kind: "section", id: "deskHours" },
  },
  {
    id: "reviewLink",
    labelKey: "settings.main.reviewLink.heading",
    group: "messages",
    target: { kind: "section", id: "reviewLink" },
  },
  {
    id: "whatsapp",
    labelKey: "settings.main.whatsapp.heading",
    group: "messages",
    target: { kind: "route", path: "/settings/whatsapp" },
    gate: "messaging",
  },
  {
    id: "profile",
    labelKey: "settings.main.profile.heading",
    group: "website",
    target: { kind: "route", path: "/settings/profile" },
  },
  {
    id: "shopPhotos",
    labelKey: "settings.main.shopPhotos.heading",
    group: "website",
    target: { kind: "section", id: "shopPhotos" },
  },
  {
    id: "embed",
    labelKey: "settings.main.embed.heading",
    group: "website",
    target: { kind: "route", path: "/settings/embed" },
  },
  {
    id: "features",
    labelKey: "settings.main.features.door",
    group: "features",
    target: { kind: "route", path: "/settings/features" },
  },
  {
    id: "yourData",
    labelKey: "settings.main.yourData.heading",
    group: "data",
    target: {
      kind: "route",
      path: "/settings/export",
      also: ["/settings/export/backups", "/settings/import", "/settings/integrations"],
    },
  },
];

/** The rows this reader may actually walk through, in rail order. */
export function settingsRailRowsFor(
  gates: ReadonlySet<SettingsRailGate>,
): readonly SettingsRailRow[] {
  return SETTINGS_RAIL_ROWS.filter((row) => !row.gate || gates.has(row.gate));
}

/**
 * **The rail's gates, from what a reader is.** One reading for the rail
 * (`layout.tsx`, which passes the live payment check) and the ⌘K settings
 * shortcuts (`ShopChrome.tsx`, which passes the session's). Either way it only
 * hides: every destination re-checks server-side.
 */
export function settingsRailGatesFor(reader: {
  canPayments: boolean;
  canManageTeam: boolean;
  canManageWaivers: boolean;
  canManageMessaging: boolean;
  canBilling: boolean;
  hasBoatDiving: boolean;
  isDemo: boolean;
  selfRegistrationEnabled: boolean;
}): Set<SettingsRailGate> {
  const gates = new Set<SettingsRailGate>();
  if (reader.canPayments) gates.add("payments");
  if (reader.canManageTeam) gates.add("team");
  if (reader.canManageWaivers) gates.add("waivers");
  if (reader.canManageMessaging) gates.add("messaging");
  if (reader.hasBoatDiving) gates.add("boats");
  if (reader.selfRegistrationEnabled) gates.add("selfRegistration");
  // The hub's own condition for its Billing door (`SettingsPage.tsx`).
  if (!reader.isDemo && reader.canBilling) gates.add("billing");
  return gates;
}

/** Where a rail row leads, from anywhere: a section row is the hub plus its fragment. */
export function settingsRailRowHref(shopBasePath: string, row: SettingsRailRow): string {
  return row.target.kind === "route"
    ? `${shopBasePath}${row.target.path}`
    : `${shopBasePath}/settings#${settingsSectionFragment(row.target.id)}`;
}

/**
 * **⌘K reaches a setting** (the Settings rail's rows, by label or group). Only
 * for a reader inside the settings gate, and through the rail's own gates read
 * from the session's roles: hiding is convenience, and every row's page
 * re-checks its own permission server-side.
 */
export function settingsShortcutsFor(
  shop: { hasBoatDiving: boolean; isDemo: boolean; selfRegistrationEnabled: boolean },
  roles: readonly Role[],
  shopSlug: string,
  t: StaffTranslator,
): { id: string; label: string; group: string; href: string }[] {
  if (!canManageShopSettings(roles)) return [];
  const rows = settingsRailRowsFor(
    settingsRailGatesFor({
      canPayments: canManagePaymentSettings(roles),
      canManageTeam: canManageStaffAccounts(roles),
      canManageWaivers: canManageWaiverTemplates(roles),
      canManageMessaging: canManageMessagingSettings(roles),
      canBilling: canManageBilling(roles),
      hasBoatDiving: shop.hasBoatDiving,
      isDemo: shop.isDemo,
      selfRegistrationEnabled: shop.selfRegistrationEnabled,
    }),
  );
  const groupLabels = new Map(SETTINGS_GROUPS.map((group) => [group.id, t(group.labelKey)]));
  const featureGates = new Set<FeatureRowGate>(["settings"]);
  if (canManagePaymentSettings(roles)) featureGates.add("payments");
  if (canManageStaffAccounts(roles)) featureGates.add("team");
  return [
    ...rows.map((row) => ({
      id: row.id,
      label: t(row.labelKey),
      group: groupLabels.get(row.group) ?? "",
      href: settingsRailRowHref(`/shop/${shopSlug}`, row),
    })),
    // The switches are rows of the Features page, not of the rail, and ⌘K is
    // where "where do I turn off tips?" is typed: each is found by name.
    ...FEATURE_ROWS.filter((row) => featureGates.has(row.gate)).map((row) => ({
      id: row.id,
      label: t(row.headingKey),
      group: groupLabels.get("features") ?? "",
      href: `/shop/${shopSlug}/settings/features#${row.id}`,
    })),
  ];
}

/** Every path a route row answers to, any `#fragment` stripped. */
function railRoutePaths(row: SettingsRailRow): readonly string[] {
  if (row.target.kind !== "route") return [];
  return [row.target.path, ...(row.target.also ?? [])].map((path) => path.split("#")[0] ?? "");
}

/**
 * **The selection model, decided in one place.** A route row wins whenever the
 * reader is standing on its path — that is a fact the browser already has, and
 * it beats any guess about scroll. Only on the hub itself, where no route row
 * matches, does the scroll-spy's section id decide.
 *
 * A row's `path` is shop-relative, so `basePath` (`/shop/<slug>`) is what makes
 * it comparable with the browser's own pathname. The comparison drops any
 * fragment (two rows point at `/settings/export`), and a row carrying one loses
 * the tie deliberately: the bare route is the destination the reader is
 * actually standing on.
 */
export function currentSettingsRailRowId(
  rows: readonly SettingsRailRow[],
  where: { pathname: string; basePath: string; sectionId?: string | null },
): string | null {
  const onRoute = rows.filter((row) =>
    railRoutePaths(row).some((path) => `${where.basePath}${path}` === where.pathname),
  );
  const standing =
    onRoute.find((row) => row.target.kind === "route" && !row.target.path.includes("#")) ??
    onRoute[0];
  if (standing) return standing.id;
  if (!where.sectionId) return null;
  const section = rows.find(
    (row) => row.target.kind === "section" && row.target.id === where.sectionId,
  );
  return section?.id ?? null;
}
