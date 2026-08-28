import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The settings hub's one list of groups, in render order. Both of the hub's
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
  { id: "your-shop", labelKey: "settings.main.groups.yourShop" },
  { id: "money", labelKey: "settings.main.groups.money" },
  { id: "data-integrations", labelKey: "settings.main.groups.dataIntegrations" },
] as const satisfies readonly { id: string; labelKey: StaffMessageKey }[];

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];
export type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];

/**
 * The twenty forms on the hub each carry their own section id through
 * `?saved=<id>` (set by the action that redirects back here), so the row that
 * changed comes back *open*, with the notice rendered inside it — a closed
 * disclosure hiding a refusal would be a form the staffer cannot see failed
 * (the same rule `EditDisclosure` states on the trip Overview).
 *
 * It lives here rather than in `SettingsPage.tsx` because the rail below needs
 * the same vocabulary, and two lists of section ids is exactly the drift ADR
 * 20260827-clearwater-surface-language's decision 6 would otherwise produce.
 */
export const SECTION_IDS = [
  "timezone",
  "contact",
  "profile",
  "address",
  "reviewLink",
  "searchListing",
  "conservation",
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
  sendWindow: "send-window",
  rentalPricing: "rental-pricing",
  divePackages: "dive-packages",
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
  | "promos"
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
 * the hub renders, including the three that leave the `/settings` namespace
 * (dive sites, waivers, promo codes). Both are pinned in
 * `_components/SettingsRail.test.tsx` against the hub's own render, so a row
 * added to one and missed on the other fails rather than quietly falling off
 * the map.
 *
 * The order is the pane's reading order, not an editorial one: the scroll-spy
 * walks these rows against the sections' positions, and a rail that disagreed
 * with the page would light the wrong row.
 */
export const SETTINGS_RAIL_ROWS: readonly SettingsRailRow[] = [
  // Your shop — the doors first, exactly as the hub lists them, then its
  // editable rows.
  {
    id: "team",
    labelKey: "settings.main.team.heading",
    group: "your-shop",
    target: { kind: "route", path: "/settings/team" },
    gate: "team",
  },
  {
    id: "diveSites",
    labelKey: "settings.main.diveSites.heading",
    group: "your-shop",
    target: { kind: "route", path: "/dive-sites" },
  },
  {
    id: "waivers",
    labelKey: "settings.main.waivers.heading",
    group: "your-shop",
    target: { kind: "route", path: "/waivers" },
    gate: "waivers",
  },
  {
    id: "safetyChecklist",
    labelKey: "settings.main.safetyChecklist.heading",
    group: "your-shop",
    target: { kind: "route", path: "/settings/safety-checklist" },
  },
  {
    id: "security",
    labelKey: "settings.main.security.heading",
    group: "your-shop",
    target: { kind: "route", path: "/settings/security" },
  },
  {
    id: "timezone",
    labelKey: "settings.main.timezone.heading",
    group: "your-shop",
    target: { kind: "section", id: "timezone" },
  },
  {
    id: "contact",
    labelKey: "settings.main.contact.heading",
    group: "your-shop",
    target: { kind: "section", id: "contact" },
  },
  {
    id: "profile",
    labelKey: "settings.main.profile.heading",
    group: "your-shop",
    target: { kind: "section", id: "profile" },
  },
  {
    id: "address",
    labelKey: "settings.main.address.heading",
    group: "your-shop",
    target: { kind: "section", id: "address" },
  },
  {
    id: "reviewLink",
    labelKey: "settings.main.reviewLink.heading",
    group: "your-shop",
    target: { kind: "section", id: "reviewLink" },
  },
  {
    id: "searchListing",
    labelKey: "settings.main.searchListing.heading",
    group: "your-shop",
    target: { kind: "section", id: "searchListing" },
  },
  {
    id: "conservation",
    labelKey: "settings.main.conservation.heading",
    group: "your-shop",
    target: { kind: "section", id: "conservation" },
  },
  {
    id: "packing",
    labelKey: "settings.main.packing.heading",
    group: "your-shop",
    target: { kind: "section", id: "packing" },
  },
  {
    id: "dockCall",
    labelKey: "settings.main.dockCall.heading",
    group: "your-shop",
    target: { kind: "section", id: "dockCall" },
  },
  {
    id: "sendWindow",
    labelKey: "settings.main.sendWindow.heading",
    group: "your-shop",
    target: { kind: "section", id: "sendWindow" },
  },
  {
    id: "units",
    labelKey: "settings.main.units.heading",
    group: "your-shop",
    target: { kind: "section", id: "units" },
  },
  {
    id: "divingOptions",
    labelKey: "boats.divingOptionsHeading",
    group: "your-shop",
    target: { kind: "section", id: "divingOptions" },
  },
  {
    id: "emergency",
    labelKey: "settings.main.emergency.heading",
    group: "your-shop",
    target: { kind: "section", id: "emergency" },
  },
  {
    id: "boats",
    labelKey: "boats.heading",
    group: "your-shop",
    target: { kind: "section", id: "boats" },
    gate: "boats",
  },
  // Money.
  {
    id: "promos",
    labelKey: "settings.main.promos.heading",
    group: "money",
    target: { kind: "route", path: "/promos" },
    gate: "promos",
  },
  {
    id: "rentals",
    labelKey: "settings.main.rentals.heading",
    group: "money",
    target: { kind: "section", id: "rentals" },
    gate: "payments",
  },
  {
    id: "rentalPricing",
    labelKey: "settings.main.rentalPricing.heading",
    group: "money",
    target: { kind: "section", id: "rentalPricing" },
    gate: "payments",
  },
  {
    id: "divePackages",
    labelKey: "settings.main.divePackages.heading",
    group: "money",
    target: { kind: "section", id: "divePackages" },
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
  // Data & integrations — all doors.
  {
    id: "embed",
    labelKey: "settings.main.embed.heading",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/embed" },
  },
  {
    id: "calendar",
    labelKey: "settings.main.calendar.heading",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/calendar" },
  },
  {
    id: "integrations",
    labelKey: "settings.main.integrations.heading",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/integrations" },
  },
  {
    id: "whatsapp",
    labelKey: "settings.main.whatsapp.heading",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/whatsapp" },
    gate: "messaging",
  },
  {
    id: "backup",
    labelKey: "settings.main.backup.heading",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/export#backups" },
    gate: "export",
  },
  {
    id: "dataImport",
    labelKey: "settings.import.title",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/import" },
    gate: "import",
  },
  {
    id: "gearImport",
    labelKey: "gear.import.title",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/gear-import" },
    gate: "import",
  },
  {
    id: "dataExport",
    labelKey: "settings.export.title",
    group: "data-integrations",
    target: { kind: "route", path: "/settings/export" },
    gate: "export",
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
