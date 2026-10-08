import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * Every place a staff member can go inside `/shop/<shopSlug>`, in one list.
 *
 * The header nav and the ⌘K command palette used to each keep their own
 * hand-written list, and the two had drifted: Orders and Walk-in existed only
 * in the palette, Team only in the nav. A destination that exists in one list
 * and not another is a surface a shop can only reach by luck, so both derive
 * from this table and cannot disagree by construction. (A third consumer, a
 * `g`-then-key shortcut sheet, has since been removed: ⌘K is the one keyboard
 * route to everything here.)
 *
 * Paths, permission gates, and grouping only — never a word anyone reads.
 * `id` is the join key: each consumer hands in its own
 * `Record<StaffDestinationId, string>` of labels resolved from the staff
 * bundle, so `src/lib` keeps returning codes and the UI keeps choosing words
 * (docs ADR 20260731-domain-layer-copy-leaks).
 */

/**
 * Owner/manager gates (H-14, ADR 20260724-role-authorization). A gated
 * destination is *absent* for anyone who fails the gate — never present and
 * disabled, never explained (ADR 20260724-role-gated-surfaces-hide-not-explain).
 */
export type StaffDestinationGate = "waivers" | "reports" | "team" | "settings";

/** Which gates the current viewer passes. */
export type StaffDestinationGates = Record<StaffDestinationGate, boolean>;

/**
 * Pending-work counts a destination can carry as a badge. Computed by whoever
 * renders the nav — a badge here never runs its own query.
 */
export type StaffDestinationBadge = "blockers";

/** Counts for the badge sources above. */
export type StaffDestinationCounts = Record<StaffDestinationBadge, number>;

/**
 * What each badge's number *means*, in tone. Beside the badge sources rather
 * than in the nav component so the two cannot disagree, and so a new badge
 * source has to answer the question.
 *
 * The blocked count is danger because every other surface that names a blocked diver
 * is (glossary: "blocked is always danger" — `readinessStatusTone`). A count of
 * people who cannot board, toned like Reviews' moderation queue, was the one
 * place the shop's readiness vocabulary changed colour on the way to the nav.
 */
export const STAFF_DESTINATION_BADGE_TONES: Record<StaffDestinationBadge, "primary" | "danger"> = {
  blockers: "danger",
};

/**
 * **The sections of the shop** — ADR 20261001-logbook, decision 1.
 *
 * The nav is plain nouns, always on screen: a labelled sidebar from `lg` up and
 * a bottom tab bar below it. Every destination belongs to exactly one section,
 * and the section is what lights when a staffer is anywhere inside it, so a
 * departure lights Schedule and the team page lights Settings.
 *
 * The time-based bar this replaces (Today · Week · Season, ADR
 * 20260919-one-idea) hid seventeen of twenty-one destinations behind the
 * search. Nothing here is search-only any more: the search is a shortcut to
 * places the nav already shows.
 */
export type StaffSection =
  | "today"
  | "schedule"
  | "divers"
  | "inbox"
  | "money"
  | "courses"
  | "gear"
  | "settings";

/**
 * The sections in nav order, each led by the destination its row opens.
 * Courses and Gear are offered only to a shop that uses them
 * (`StaffNavOffers`); Settings sits at the foot of the sidebar.
 */
export const STAFF_NAV_SECTIONS = [
  { section: "today", id: "today" },
  { section: "schedule", id: "board" },
  { section: "divers", id: "divers" },
  { section: "inbox", id: "inbox" },
  { section: "money", id: "orders" },
  { section: "courses", id: "courses" },
  { section: "gear", id: "gear" },
  { section: "settings", id: "settings" },
] as const satisfies readonly { section: StaffSection; id: StaffDestinationId }[];

/**
 * The phone's tab bar: four sections and a More sheet holding the rest. These
 * four are the ones a phone is in a hand for — the day, the board, a person,
 * a message.
 */
export const STAFF_PHONE_TABS = [
  "today",
  "schedule",
  "divers",
  "inbox",
] as const satisfies readonly StaffSection[];

/**
 * Sections a shop sees only once it uses them. A shop that teaches no course
 * or keeps no rental fleet would otherwise carry a nav row that opens onto an
 * empty page every day. Both stay in the search, so a shop can start.
 */
export type StaffNavOffers = {
  courses: boolean;
  gear: boolean;
  /**
   * Whether the shop keeps a crew schedule (`shops.crew_schedule_enabled`).
   * Unlike the two above it is a setting, not a presence: off, the Crew view
   * is gone from the palette as well, because the page redirects.
   */
  crew: boolean;
};

export type StaffDestinationId =
  | "today"
  | "divers"
  | "board"
  | "addBooking"
  | "staffing"
  | "diveSites"
  | "gear"
  | "workOrders"
  | "newWorkOrder"
  | "rentOut"
  | "courses"
  | "reviews"
  | "requests"
  | "inbox"
  | "orders"
  | "waivers"
  | "reports"
  | "promoCodes"
  | "settings"
  | "team"
  | "calendarFeed"
  | "emailSettings";

/**
 * The word each destination goes by, resolved from the staff bundle by
 * whoever renders. `src/lib` never picks the words — it only insists that
 * every destination has exactly one, shared by all three consumers.
 */
export type StaffDestinationLabels = Record<StaffDestinationId, string>;

/**
 * What a destination calls itself once you are on it, where that differs from
 * its label — resolved the same way, by whoever renders. Partial by design:
 * most pages agree with their tab, and one that does not is the exception
 * worth naming (see `STAFF_DESTINATION_TITLE_KEYS`).
 */
export type StaffDestinationTitles = Partial<Record<StaffDestinationId, string>>;

/**
 * **Where each destination's one word lives in the staff bundle.**
 *
 * Keys, never words — `src/lib` picks neither (ADR
 * 20260731-domain-layer-copy-leaks), the same key-registry shape
 * `src/lib/marketing.ts` uses. What it buys is that a page's *own* eyebrow can
 * read the identical key the nav tab reads, so the two cannot come to call one
 * place two things.
 *
 * They had. Eight staff surfaces greeted a staffer with a name other than the
 * one they tapped (issue #824), and four of the eight were doing the right
 * thing through a *second copy* of the word — `reviews.eyebrow` "Reviews"
 * beside `shared.shopNavLinks.reviews` "Reviews", two strings one edit apart
 * from disagreeing. Those duplicates are gone; this is the join.
 *
 * The `<h1>` is deliberately not in here. In a tabbed section (Inbox, Money)
 * every page's `<h1>` is the section's name and this word is its tab (ADR
 * 20261001-logbook); elsewhere a page may still name itself in the product's
 * voice (`STAFF_DESTINATION_TITLE_KEYS`).
 */
export const STAFF_DESTINATION_LABEL_KEYS: Record<StaffDestinationId, StaffMessageKey> = {
  today: "shared.shopNavLinks.today",
  divers: "shared.shopNavLinks.divers",
  board: "shared.shopNavLinks.board",
  addBooking: "shared.shopNavLinks.addBooking",
  staffing: "shared.shopNavLinks.staffing",
  diveSites: "shared.shopNavLinks.diveSites",
  gear: "shared.shopNavLinks.gear",
  workOrders: "shared.shopNavLinks.workOrders",
  newWorkOrder: "shared.shopNavLinks.newWorkOrder",
  rentOut: "shared.shopNavLinks.rentOut",
  courses: "shared.shopNavLinks.courses",
  reviews: "shared.shopNavLinks.reviews",
  requests: "shared.shopNavLinks.requests",
  inbox: "shared.shopNavLinks.inbox",
  orders: "shared.shopNavLinks.orders",
  waivers: "shared.shopNavLinks.waivers",
  reports: "shared.shopNavLinks.reports",
  promoCodes: "shared.shopNavLinks.promoCodes",
  settings: "shared.shopNavLinks.settings",
  team: "shared.shopNavLinks.team",
  calendarFeed: "shared.shopNavLinks.calendarFeed",
  emailSettings: "shared.shopNavLinks.emailSettings",
};

/**
 * The headline a destination renders once you are on it, where that differs
 * from its label — so the palette can find a page by the name its own reader
 * calls it. A staffer who thinks of Reports as "How's your month" and types
 * that used to get nothing back.
 *
 * Only the ones that differ, and only the *stable* ones: Today's headline is a
 * greeting with the reader's name in it and Close-out's changes with the state
 * of the day, so neither is a name anybody could search for.
 */
export const STAFF_DESTINATION_TITLE_KEYS: Partial<Record<StaffDestinationId, StaffMessageKey>> = {
  // A tabbed section's pages wear the section's name (`STAFF_SECTION_TABS`):
  // its lead tab answers to it, so typing "Money" still finds Orders.
  inbox: "shared.shopSections.inbox",
  orders: "shared.shopSections.money",
  // The register's tab answers to "Register"; the section it leads is Gear,
  // which is what a staffer types when they want the fleet.
  gear: "shared.shopSections.gear",
  diveSites: "diveSites.list.title",
};

export type StaffDestination = {
  readonly id: StaffDestinationId;
  /** Path below `/shop/<shopSlug>`; `""` is the shop home (Today). */
  readonly suffix: string;
  /** The nav section this destination lights. */
  readonly section: StaffSection;
  /** Whether the command palette offers it under "Go to". */
  readonly inPalette: boolean;
  /** Permission required to see it anywhere; absent means everyone. */
  readonly gate?: StaffDestinationGate;
  /** Pending-work count rendered beside the label. */
  readonly badge?: StaffDestinationBadge;
  /**
   * Further path prefixes that should also read as "you are here" — detail
   * views living outside this one's own subtree (the board claims `/trips`).
   * Only for pages with no destination of their own: a page that *has* a nav
   * row lights that row, and `currentStaffNavDestinationId` guarantees the
   * two never light together.
   */
  readonly alsoMatch?: readonly string[];
};

/**
 * Order matters: it is the order the palette lists "Go to", and within a
 * section the first visible destination is the one a section row opens when
 * its lead is gated away.
 */
export const STAFF_DESTINATIONS: readonly StaffDestination[] = [
  // Carries the blocked-diver badge: Today is where blocked divers are read,
  // and where the day is closed. There is no Close-out destination — the
  // evening is a state Today settles into (ADR
  // 20260827-clearwater-surface-language, decision 4).
  { id: "today", suffix: "", section: "today", inPalette: true, badge: "blockers" },
  { id: "divers", suffix: "/divers", section: "divers", inPalette: true },
  // A departure is the board's detail view, so `/trips/**` lights Schedule.
  {
    id: "board",
    suffix: "/schedule/board",
    section: "schedule",
    inPalette: true,
    alsoMatch: ["/trips"],
  },
  // The global "seat a diver" door: an act, declared here because the
  // registry is the only place a destination may be declared.
  { id: "addBooking", suffix: "/bookings/new", section: "schedule", inPalette: true },
  { id: "staffing", suffix: "/staffing", section: "schedule", inPalette: true },
  // Everything a diver says to the shop is one section: messages, days asked
  // for, and reviews. Each is ungated — the
  // person best placed to answer is whoever is at the counter (issues #1505,
  // #1679). Reviews' private "asked us to fix" panel keeps its own gate inside
  // the page (issue #1410).
  { id: "inbox", suffix: "/inbox", section: "inbox", inPalette: true },
  { id: "requests", suffix: "/requests", section: "inbox", inPalette: true },
  { id: "reviews", suffix: "/reviews", section: "inbox", inPalette: true },
  // Money: the orders a shop takes every day, then the month's reading of
  // them and the discounts that shaped them.
  { id: "orders", suffix: "/orders", section: "money", inPalette: true },
  { id: "reports", suffix: "/reports", section: "money", inPalette: true, gate: "reports" },
  { id: "promoCodes", suffix: "/promos", section: "money", inPalette: true, gate: "reports" },
  { id: "courses", suffix: "/courses", section: "courses", inPalette: true },
  // The rental fleet (ADR 20260815-minimal-gear-register) and the bench beside
  // it (ADR 20261008-gear-work-orders). Ungated: gear is any-staff work
  // (H-06), and a technician is staff.
  { id: "gear", suffix: "/gear", section: "gear", inPalette: true },
  { id: "workOrders", suffix: "/gear/work-orders", section: "gear", inPalette: true },
  // The act, declared here because the registry is the only place a
  // destination may be declared — the same call `addBooking` makes.
  { id: "newWorkOrder", suffix: "/gear/work-orders/new", section: "gear", inPalette: true },
  // The counter-rental door: an act, like "Add a booking" (ADR
  // 20260815-minimal-gear-register, amended 2026-10-08). Any staff, as gear is.
  { id: "rentOut", suffix: "/gear/rentals/new", section: "gear", inPalette: true },
  // What a shop sets up rather than works.
  { id: "diveSites", suffix: "/dive-sites", section: "settings", inPalette: true },
  { id: "waivers", suffix: "/waivers", section: "settings", inPalette: true, gate: "waivers" },
  { id: "team", suffix: "/settings/team", section: "settings", inPalette: true, gate: "team" },
  // A staffer's own calendar subscription, filed under `/settings` by URL
  // only. Ungated, so the roles that most want it keep a door when Settings
  // itself is gated away.
  { id: "calendarFeed", suffix: "/settings/calendar", section: "settings", inPalette: true },
  // The staffer's own email (the Monday email, `src/lib/weekly-digest.ts`).
  // Ungated for the calendar feed's reason: any staffer may ask for it.
  { id: "emailSettings", suffix: "/settings/email", section: "settings", inPalette: true },
  // Last: Settings is where a shop goes when nothing else was the answer.
  // `/settings/*` sub-pages light it by prefix; Team and the calendar feed win
  // their own paths by being the longer match.
  { id: "settings", suffix: "/settings", section: "settings", inPalette: true, gate: "settings" },
];

/**
 * **The tabs a section shows under its title** — ADR 20261001-logbook, the one
 * page shape: a title, then optional tabs. Inbox and Money are each one place
 * whose pages were separate rooms with their own headlines; now every page in
 * the section wears the section's name as its `<h1>` and these tabs say which
 * part of it you are on.
 *
 * Schedule's Week and Crew views are the same shape, kept with the board
 * because both read the week on screen.
 */
export const STAFF_SECTION_TABS = {
  gear: ["gear", "workOrders"],
  inbox: ["inbox", "requests", "reviews"],
  money: ["orders", "promoCodes", "reports"],
} as const satisfies Partial<Record<StaffSection, readonly StaffDestinationId[]>>;

export type TabbedStaffSection = keyof typeof STAFF_SECTION_TABS;

/**
 * The tabs this viewer sees for a section, in order. A tab gated away is
 * absent like any other destination (ADR
 * 20260724-role-gated-surfaces-hide-not-explain); fewer than two left is no
 * tab strip at all, which the renderer decides.
 */
export function staffSectionTabs(
  section: TabbedStaffSection,
  gates: StaffDestinationGates,
): readonly StaffDestination[] {
  return STAFF_SECTION_TABS[section]
    .map((id) => staffDestination(id))
    .filter((destination) => passesGate(destination, gates));
}

/** The `/shop/<shopSlug>` prefix every destination hangs off. */
export function staffShopRoot(shopSlug: string): string {
  return `/shop/${shopSlug}`;
}

/**
 * Whether a pathname is the live manifest surface for this shop.
 *
 * The staff phone dock is deliberately absent on that surface: Boat Mode owns
 * the full mobile viewport. Keep this as a segment check rather than a loose
 * prefix match so another shop, another trip sub-route, and `/offline-manifest`
 * can never borrow the exception.
 */
export function isLiveManifestPath(pathname: string, root: string): boolean {
  const normalizedPath = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  const normalizedRoot = root.replace(/\/+$/, "");
  const tripsPrefix = `${normalizedRoot}/trips/`;
  if (!normalizedPath.startsWith(tripsPrefix)) return false;

  const segments = normalizedPath.slice(tripsPrefix.length).split("/");
  return segments.length === 2 && segments[0].length > 0 && segments[1] === "manifest";
}

/**
 * Everything below `/shop/<shopSlug>` for one destination.
 *
 * It used to append a view query for the one destination that was a *view* of
 * another page rather than a page of its own; no destination is any more, so
 * this is the suffix and nothing else. Consumers still build URLs through it,
 * which is what keeps a path from being hand-written at a call site.
 */
export function staffDestinationSuffix(destination: StaffDestination): string {
  return destination.suffix;
}

/** A destination's full path for one shop. */
export function staffDestinationHref(root: string, destination: StaffDestination): string {
  return `${root}${staffDestinationSuffix(destination)}`;
}

/**
 * One destination by id, for the callers that link to a *particular* place
 * rather than rendering a list of them (Today's orientation card). Without
 * this they hand-write the path, which is how the divemaster's orientation
 * prompt ended up pointing at `/blockers` — a 308 — long after the registry
 * learned the one-hop URL.
 *
 * Total by construction: every `StaffDestinationId` has an entry, and the
 * throw is the guard that keeps it that way if one is ever removed.
 */
export function staffDestination(id: StaffDestinationId): StaffDestination {
  const destination = STAFF_DESTINATIONS.find((candidate) => candidate.id === id);
  if (!destination) throw new Error(`unregistered staff destination: ${id}`);
  return destination;
}

function passesGate(destination: StaffDestination, gates: StaffDestinationGates): boolean {
  return destination.gate === undefined || gates[destination.gate];
}

/** Every destination this viewer may see, in registry order. */
export function visibleStaffDestinations(
  gates: StaffDestinationGates,
): readonly StaffDestination[] {
  return STAFF_DESTINATIONS.filter((destination) => passesGate(destination, gates));
}

/** One row of the staff nav: the section and the destination its row opens. */
export type StaffNavItem = { section: StaffSection; destination: StaffDestination };

/**
 * The sections this viewer's nav shows, in order.
 *
 * A row opens its lead destination; when that one is gated away it opens the
 * section's first visible destination instead, and a section with nothing
 * visible is absent rather than refusing (ADR
 * 20260724-role-gated-surfaces-hide-not-explain). Settings is the exception:
 * a crew member's only door under it is their own calendar feed, and a row
 * called "Settings" opening that would be a lie, so the section goes and the
 * feed stays in the search and the shop's own menu.
 */
export function staffNavSections(
  gates: StaffDestinationGates,
  offers: StaffNavOffers,
): readonly StaffNavItem[] {
  const visible = visibleStaffDestinations(gates);
  const items: StaffNavItem[] = [];
  for (const { section, id } of STAFF_NAV_SECTIONS) {
    if ((section === "courses" || section === "gear") && !offers[section]) continue;
    const lead = visible.find((destination) => destination.id === id);
    const destination =
      lead ??
      (section === "settings"
        ? undefined
        : visible.find((candidate) => candidate.section === section));
    if (destination) items.push({ section, destination });
  }
  return items;
}

/** The "Go to" rows the command palette offers this viewer. */
export function staffPaletteDestinations(
  gates: StaffDestinationGates,
  offers: Pick<StaffNavOffers, "crew"> = { crew: true },
): readonly StaffDestination[] {
  return visibleStaffDestinations(gates).filter(
    (destination) => destination.inPalette && (destination.id !== "staffing" || offers.crew),
  );
}

/**
 * How many characters of `pathname` the prefix `href` claims — 0 when it
 * doesn't. The shop root (Today's own href) claims only an exact match; any
 * other prefix claims its whole subtree, so a detail page lights the
 * destination that owns it.
 */
function claimedLength(pathname: string, href: string, root: string): number {
  if (href === root) return pathname === root ? href.length : 0;
  return pathname === href || pathname.startsWith(`${href}/`) ? href.length : 0;
}

/**
 * The longest claim this destination has on `pathname` — its own path or an
 * `alsoMatch` prefix — or 0 when the page isn't its.
 */
function destinationClaim(pathname: string, root: string, destination: StaffDestination): number {
  let longest = claimedLength(pathname, `${root}${destination.suffix}`, root);
  for (const prefix of destination.alsoMatch ?? []) {
    longest = Math.max(longest, claimedLength(pathname, `${root}${prefix}`, root));
  }
  return longest;
}

/**
 * The destination this page belongs to — exactly one, or none. Most specific
 * claim wins, so `/settings/team` resolves to Team rather than the Settings
 * entry above it; ties fall to registry order (the shop root is Today).
 * Only the *section* is ever drawn, so whichever of two same-section
 * destinations claims a path (Team under Settings), the light
 * is the same.
 */
export function currentStaffDestination(
  pathname: string,
  root: string,
  gates: StaffDestinationGates,
): StaffDestination | null {
  let current: StaffDestination | null = null;
  let longest = 0;
  for (const destination of visibleStaffDestinations(gates)) {
    const claim = destinationClaim(pathname, root, destination);
    if (claim > longest) {
      current = destination;
      longest = claim;
    }
  }
  return current;
}

/**
 * **Which section is lit**, or none: the section of whichever destination
 * claims this path. A departure lights Schedule (the board claims `/trips`),
 * the team page lights Settings.
 */
export function currentStaffSection(
  pathname: string,
  root: string,
  gates: StaffDestinationGates,
): StaffSection | null {
  return currentStaffDestination(pathname, root, gates)?.section ?? null;
}

/**
 * **Whether this destination's own link is the page being read**, which is the
 * difference between ARIA's two `aria-current` values.
 *
 * A lit section is not always the page its row opens: a staffer on a
 * departure lights Schedule, whose link opens the board. Marking that
 * `aria-current="page"` tells a screen-reader user they are already where the
 * link goes (#1938). `"page"` is the current page within a set of links to
 * pages; `"true"` is ARIA's value for the current item in a set, not otherwise
 * specified — which is what a section is.
 *
 * **It compares the href, not the destination id**, and that is the whole
 * subtlety. `currentStaffDestination` resolves a *subtree*, because
 * `claimedLength` above claims one: `board` carries `alsoMatch: ["/trips"]`, so
 * a departure resolves to the board destination while sitting at a path the
 * board's own link does not open. An id comparison would call that page
 * "current" and re-open this bug on the busiest staff surface there is.
 *
 * Search and hash are not part of the question — `usePathname()` hands over
 * neither, and `/shop/<slug>?notice=saved` is the same page as `/shop/<slug>`.
 */
export function isStaffDestinationPage(
  pathname: string,
  root: string,
  destination: StaffDestination,
): boolean {
  return pathname === staffDestinationHref(root, destination);
}
