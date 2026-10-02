import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The settings hub's one list of groups, in render order: the ten of ADR
 * 20261001-logbook, each named for what a shop is setting up rather than for
 * where the row happened to be built. Both of the hub's
 * `SettingsPage.tsx` renders its sections from this one list. It remains a
 * registry rather than three local constants so a new section cannot drift
 * from the hub's section order or its test coverage.
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
  { id: "boats-sites", labelKey: "settings.main.groups.boatsSites" },
  { id: "bookings-waivers", labelKey: "settings.main.groups.bookingsWaivers" },
  { id: "rental-gear", labelKey: "settings.main.groups.rentals" },
  { id: "money", labelKey: "settings.main.groups.money" },
  { id: "messages", labelKey: "settings.main.groups.messages" },
  { id: "website", labelKey: "settings.main.groups.website" },
  { id: "data", labelKey: "settings.main.groups.data" },
  { id: "account", labelKey: "settings.main.groups.account" },
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
 * onto a run of forms with a Save and a Delete on every line. The
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
  "profile",
  "address",
  "reviewLink",
  "searchListing",
  "packing",
  "dockCall",
  "units",
  "divingOptions",
  "emergency",
  "rentals",
  "rentalPricing",
  "tax",
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
  searchListing: "search-listing",
  divingOptions: "diving-options",
  dockCall: "dock-call",
  rentalPricing: "rental-pricing",
  passThrough: "pass-through",
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
  | "import"
  | "export"
  | "boats";

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
  target: { kind: "section"; id: SectionId } | { kind: "route"; path: string };
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
    id: "timezone",
    labelKey: "settings.main.timezone.heading",
    group: "shop",
    target: { kind: "section", id: "timezone" },
  },
  {
    id: "season",
    labelKey: "settings.main.season.heading",
    group: "shop",
    target: { kind: "section", id: "season" },
  },
  {
    id: "units",
    labelKey: "settings.main.units.heading",
    group: "shop",
    target: { kind: "section", id: "units" },
  },
  {
    id: "contact",
    labelKey: "settings.main.contact.heading",
    group: "shop",
    target: { kind: "section", id: "contact" },
  },
  {
    id: "address",
    labelKey: "settings.main.address.heading",
    group: "shop",
    target: { kind: "section", id: "address" },
  },
  {
    id: "team",
    labelKey: "settings.main.team.heading",
    group: "team",
    target: { kind: "route", path: "/settings/team" },
    gate: "team",
  },
  {
    id: "boats",
    labelKey: "boats.heading",
    group: "boats-sites",
    target: { kind: "route", path: "/settings/boats" },
    gate: "boats",
  },
  {
    id: "diveSites",
    labelKey: "settings.main.diveSites.heading",
    group: "boats-sites",
    target: { kind: "route", path: "/dive-sites" },
  },
  {
    id: "divingOptions",
    labelKey: "boats.divingOptionsHeading",
    group: "boats-sites",
    target: { kind: "section", id: "divingOptions" },
  },
  {
    id: "safetyChecklist",
    labelKey: "settings.main.safetyChecklist.heading",
    group: "boats-sites",
    target: { kind: "route", path: "/settings/safety-checklist" },
  },
  {
    id: "emergency",
    labelKey: "settings.main.emergency.heading",
    group: "boats-sites",
    target: { kind: "section", id: "emergency" },
  },
  {
    id: "dockCall",
    labelKey: "settings.main.dockCall.heading",
    group: "boats-sites",
    target: { kind: "section", id: "dockCall" },
  },
  {
    id: "tripTags",
    labelKey: "lenses.heading",
    group: "boats-sites",
    target: { kind: "route", path: "/settings/trip-tags" },
  },
  {
    id: "waivers",
    labelKey: "settings.main.waivers.heading",
    group: "bookings-waivers",
    target: { kind: "route", path: "/waivers" },
    gate: "waivers",
  },
  {
    id: "packing",
    labelKey: "settings.main.packing.heading",
    group: "bookings-waivers",
    target: { kind: "section", id: "packing" },
  },
  {
    id: "rentals",
    labelKey: "settings.main.rentals.heading",
    group: "rental-gear",
    target: { kind: "section", id: "rentals" },
    gate: "payments",
  },
  {
    id: "rentalPricing",
    labelKey: "settings.main.rentalPricing.heading",
    group: "rental-gear",
    target: { kind: "section", id: "rentalPricing" },
    gate: "payments",
  },
  {
    id: "tax",
    labelKey: "settings.main.tax.heading",
    group: "money",
    target: { kind: "section", id: "tax" },
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
    target: { kind: "section", id: "profile" },
  },
  {
    id: "searchListing",
    labelKey: "settings.main.searchListing.heading",
    group: "website",
    target: { kind: "section", id: "searchListing" },
  },
  {
    id: "embed",
    labelKey: "settings.main.embed.heading",
    group: "website",
    target: { kind: "route", path: "/settings/embed" },
  },
  {
    id: "integrations",
    labelKey: "settings.main.integrations.heading",
    group: "data",
    target: { kind: "route", path: "/settings/integrations" },
  },
  {
    id: "backup",
    labelKey: "settings.main.backup.heading",
    group: "data",
    target: { kind: "route", path: "/settings/export#backups" },
    gate: "export",
  },
  {
    id: "dataImport",
    labelKey: "settings.import.title",
    group: "data",
    target: { kind: "route", path: "/settings/import" },
    gate: "import",
  },
  {
    id: "gearImport",
    labelKey: "gear.import.title",
    group: "data",
    target: { kind: "route", path: "/settings/gear-import" },
    gate: "import",
  },
  {
    id: "diveSiteImport",
    labelKey: "diveSites.import.title",
    group: "data",
    target: { kind: "route", path: "/settings/dive-site-import" },
    gate: "import",
  },
  {
    id: "dataExport",
    labelKey: "settings.export.title",
    group: "data",
    target: { kind: "route", path: "/settings/export" },
    gate: "export",
  },
  {
    id: "security",
    labelKey: "settings.main.security.heading",
    group: "account",
    target: { kind: "route", path: "/settings/security" },
  },
  {
    id: "calendar",
    labelKey: "settings.main.calendar.heading",
    group: "account",
    target: { kind: "route", path: "/settings/calendar" },
  },
];

/** The rows this reader may actually walk through, in rail order. */
export function settingsRailRowsFor(
  gates: ReadonlySet<SettingsRailGate>,
): readonly SettingsRailRow[] {
  return SETTINGS_RAIL_ROWS.filter((row) => !row.gate || gates.has(row.gate));
}

/** A row's destination path with any `#fragment` stripped. */
function railRoutePath(row: SettingsRailRow): string | null {
  return row.target.kind === "route" ? (row.target.path.split("#")[0] ?? "") : null;
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
  const onRoute = rows.filter(
    (row) =>
      railRoutePath(row) !== null && `${where.basePath}${railRoutePath(row)}` === where.pathname,
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
