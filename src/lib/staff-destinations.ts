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
 * Where a destination sits in the header.
 *
 * - `primary` — the tabs always on screen (Today, Check-in, Divers, Board,
 *   Close-out). Every one is a place a shop lives in *during a dive day*.
 * - `daily`/`setup` — inside "More": the header menu from `lg` up
 *   (ShopNavLinks) and the bottom sheet rising from the phone dock's sixth
 *   slot below it (StaffTabBar). `daily` ("Run the shop") is the operational
 *   cadence a shop returns to on its own rhythm — the week's staffing, the
 *   course roster, the site library, the waiver log, reviews, Orders, and the
 *   monthly report. `setup` ("Set up") is what a shop configures
 *   rather than works — team, promo codes, a staffer's own calendar feed, and
 *   Settings itself, always last. The groups were empty for a while (the old
 *   "More" menu was the IA admitting it hadn't decided, and it was removed
 *   over nothing); they came back *decided* (ADR
 *   20260813-more-is-the-shops-other-door): fourteen destinations reachable
 *   only by ⌘K was a desktop-keyboard answer to a phone-thumb question.
 *
 * `null` means the destination is real and reachable, but not in the header —
 * it earns its place in the palette instead of one more row (design
 * principle 8, fewer controls). What stays `null` now is only what is not a
 * *place*: an action (`addBooking`) and a way into a page (`walkIn`).
 *
 * **The dock holds five destination tabs; the sixth slot is More, and that is
 * the ceiling.** The phone dock renders every `primary` destination at ~65px
 * per tab at 390px; the sixth slot is spent — permanently — on the "More"
 * sheet that carries the `daily`/`setup` groups, so a seventh place never
 * means a growing bar. Promoting a destination to `primary` means demoting
 * another into one of these groups, never squeezing.
 */
export type StaffNavGroup = "primary" | "daily" | "setup";

export type StaffDestinationId =
  | "today"
  | "checkIn"
  | "closeOut"
  | "walkIn"
  | "divers"
  | "board"
  | "addBooking"
  | "staffing"
  | "diveSites"
  | "gear"
  | "courses"
  | "reviews"
  | "requests"
  | "orders"
  | "waivers"
  | "reports"
  | "promoCodes"
  | "settings"
  | "team"
  | "calendarFeed";

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
 * The `<h1>` is deliberately not in here. "How's your month" is the product's
 * voice and better writing than "Reports" (docs/design/brand.md); the eyebrow
 * is what confirms you arrived where you meant to, and a page gets to say both.
 */
export const STAFF_DESTINATION_LABEL_KEYS: Record<StaffDestinationId, StaffMessageKey> = {
  today: "shared.shopNavLinks.today",
  checkIn: "shared.shopNavLinks.checkIn",
  closeOut: "shared.shopNavLinks.closeOut",
  walkIn: "shared.shopNavLinks.walkIn",
  divers: "shared.shopNavLinks.divers",
  board: "shared.shopNavLinks.board",
  addBooking: "shared.shopNavLinks.addBooking",
  staffing: "shared.shopNavLinks.staffing",
  diveSites: "shared.shopNavLinks.diveSites",
  gear: "shared.shopNavLinks.gear",
  courses: "shared.shopNavLinks.courses",
  reviews: "shared.shopNavLinks.reviews",
  requests: "shared.shopNavLinks.requests",
  orders: "shared.shopNavLinks.orders",
  waivers: "shared.shopNavLinks.waivers",
  reports: "shared.shopNavLinks.reports",
  promoCodes: "shared.shopNavLinks.promoCodes",
  settings: "shared.shopNavLinks.settings",
  team: "shared.shopNavLinks.team",
  calendarFeed: "shared.shopNavLinks.calendarFeed",
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
  checkIn: "checkIn.title",
  reports: "reports.title",
  reviews: "reviews.title",
  requests: "requests.title",
  diveSites: "diveSites.list.title",
  promoCodes: "promos.title",
};

export type StaffDestination = {
  readonly id: StaffDestinationId;
  /** Path below `/shop/<shopSlug>`; `""` is the shop home (Today). */
  readonly suffix: string;
  /** Header placement, or `null` for palette-only. */
  readonly navGroup: StaffNavGroup | null;
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
 * Order matters: it is the order the nav renders each group and the order the
 * palette lists "Go to".
 */
export const STAFF_DESTINATIONS: readonly StaffDestination[] = [
  // Carries the blocked-diver badge because Today is now where blocked divers
  // are read — both ways of reading them (ADR 20260803-not-ready-is-a-view).
  // Close-out has its own primary row, so its page is never borrowed by Today
  // or represented only by the More menu.
  {
    id: "today",
    suffix: "",
    navGroup: "primary",
    inPalette: true,
    badge: "blockers",
  },
  { id: "checkIn", suffix: "/check-in", navGroup: "primary", inPalette: true },
  // **There is no "Not ready" destination.** It was a page, then Today's
  // by-departure view behind `?view=departures`, and it is now neither: the
  // shop home is one chronological spine and a blocked diver is a row on the
  // station of the boat waiting for them (ADR
  // 20260827-clearwater-surface-language, decision 4). An entry pointing at the
  // bare home would be a second palette row landing on Today's own URL — the
  // duplicate control principle 8 forbids, and one this registry's
  // unique-URL invariant refuses outright. Today keeps the blocked badge.
  { id: "divers", suffix: "/divers", navGroup: "primary", inPalette: true },
  // Staff work a departure on /trips/[id], which is the board's detail view —
  // keep the board tab lit so they don't lose their place.
  {
    id: "board",
    suffix: "/schedule/board",
    navGroup: "primary",
    inPalette: true,
    // Trips are the board's detail views. (Staffing used to be claimed here
    // too — it has its own "Run the shop" row now, and lights that instead.)
    alsoMatch: ["/trips"],
  },
  // The end-of-day ritual (ADR 20260804-day-closeout) is a top-level working
  // surface: it is the one place staff return to after the boat is home, so it
  // earns the fifth destination tab and the sixth-slot ceiling remains intact.
  { id: "closeOut", suffix: "/close-out", navGroup: "primary", inPalette: true },
  // The global "seat a diver" door. It is an action rather than a place, so it
  // stays out of the header — the board hosts its own button and the palette
  // answers for it everywhere else. It is *here* because the registry is the
  // only place a destination may be declared: it used to be a hand-written
  // palette item, which is exactly the drift this file exists to end.
  { id: "addBooking", suffix: "/bookings/new", navGroup: null, inPalette: true },
  // A way into Check-in rather than a destination of its own, so it stays out
  // of the header and lives where someone types what they want.
  { id: "walkIn", suffix: "/check-in/walk-in", navGroup: null, inPalette: true },
  { id: "staffing", suffix: "/staffing", navGroup: "daily", inPalette: true },
  { id: "courses", suffix: "/courses", navGroup: "daily", inPalette: true },
  { id: "diveSites", suffix: "/dive-sites", navGroup: "daily", inPalette: true },
  // The rental fleet register (ADR 20260815-minimal-gear-register). "Run the
  // shop" work like the site library beside it — packing, handing over, and
  // chasing returns is the day's rhythm, not configuration. Ungated: gear is
  // any-staff work (H-06 already lets any staff member substitute a real
  // available item, "because that is the day's work"). Its pending-work
  // signal is Today's gear rows, never a nav badge — same rule as Reviews.
  { id: "gear", suffix: "/gear", navGroup: "daily", inPalette: true },
  // The waiver template and signature log — owner/manager work, and part of
  // running the shop rather than setting it up: the log is where a signature
  // question gets answered on a working day.
  {
    id: "waivers",
    suffix: "/waivers",
    navGroup: "daily",
    inPalette: true,
    gate: "waivers",
  },
  // Its pending-work signal lives on Today's queue (a `reviews_pending`
  // row), the same pattern as stuck payments — a queue's badge belongs on the
  // page that ranks work, not on a nav row.
  { id: "reviews", suffix: "/reviews", navGroup: "daily", inPalette: true },
  // Divers asking for a day that is not on the board. Part of the shop's
  // running cadence rather than its setup — a shop reads this the way it reads
  // reviews, on its own rhythm, and answers it by putting a departure up. It is
  // deliberately *not* a sixth primary tab: the dock holds five and the sixth
  // slot is More (ADR 20260813-more-is-the-shops-other-door).
  //
  // Gated with Reports and Promo codes rather than left open like Reviews
  // beside it. Two reasons, and they point the same way. The rows are a pile of
  // *prospects* — names, email addresses and phone numbers of people who have
  // not booked anything, and who reached a public form rather than the shop's
  // roster — so this is the one "Run the shop" surface that hands contact
  // details for strangers to whoever opens it. And what a shop *does* with it
  // is commercial: decide which unscheduled day is worth a boat. That is the
  // work Reports and Promo codes already sit behind, not the work a captain
  // does. A captain runs the water; demand that has not become a departure yet
  // is the desk's. Absent for them, never shown and refused (ADR
  // 20260724-role-gated-surfaces-hide-not-explain).
  { id: "requests", suffix: "/requests", navGroup: "daily", inPalette: true, gate: "reports" },
  // Money the shop reads daily — a "Run the shop" destination, not one of the
  // five all-day tabs. Orders remains ungated and palette-visible, and the
  // page's own links keep the money workflow reachable from its context.
  { id: "orders", suffix: "/orders", navGroup: "daily", inPalette: true },
  // The monthly read of the money Orders tracks daily — the last beat of the
  // "Run the shop" cadence, not configuration, so it files under `daily`
  // rather than `setup`. Its page lights its own row now instead of borrowing
  // the Orders tab.
  { id: "reports", suffix: "/reports", navGroup: "daily", inPalette: true, gate: "reports" },
  // Team and Promo codes still have doors on Settings' own cards — but a card
  // on a page you must already be on is a cross-link, not a menu presence,
  // and these two lead "Set up" because they are the configuration acts a
  // shop actually repeats (a new hire, a season's discount).
  { id: "team", suffix: "/settings/team", navGroup: "setup", inPalette: true, gate: "team" },
  { id: "promoCodes", suffix: "/promos", navGroup: "setup", inPalette: true, gate: "reports" },
  // The one page under `/settings` that is *not* shop configuration: a
  // staffer's own calendar subscription, a personal feed of their own shifts,
  // filed there by URL only. It needs its own entry precisely because Settings
  // above it is gated — without a door of its own it would vanish from the
  // nav and the palette for every role that most wants it, and be reachable
  // only by typing the URL. Ungated, so for daily crew it is what keeps the
  // "Set up" group from ever rendering empty.
  {
    id: "calendarFeed",
    suffix: "/settings/calendar",
    navGroup: "setup",
    inPalette: true,
  },
  // Last, always: Settings is where a shop goes when nothing else on the menu
  // was the answer, so it closes the "Set up" group — a group with that name
  // ending anywhere else would be a joke missing its punchline.
  //
  // Still not a tab: it is the one destination a shop configures rather than
  // works, and it does not get a sixth of a phone dock the other five are
  // tapped from all day with wet hands. It lived behind the header's
  // shop-identity menu for a while; that door closed when the More groups
  // arrived (ADR 20260813-more-is-the-shops-other-door) — one destination in
  // two menus is the duplicate control principle 8 forbids, and the identity
  // menu is about *this reader and this session* (language, sign out), not a
  // place in the shop.
  //
  // No `alsoMatch` any more: Promo codes, Dive sites and Waivers each light
  // their own row now, and `/settings/*` sub-pages light this one by prefix —
  // except Team and the calendar feed, whose own rows win by being the more
  // specific match (`currentStaffNavDestinationId`).
  {
    id: "settings",
    suffix: "/settings",
    navGroup: "setup",
    inPalette: true,
    gate: "settings",
  },
];

/** The `/shop/<shopSlug>` prefix every destination hangs off. */
export function staffShopRoot(shopSlug: string): string {
  return `/shop/${shopSlug}`;
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

/** The destinations in one header group, already filtered for permissions. */
export function staffNavDestinations(
  group: StaffNavGroup,
  gates: StaffDestinationGates,
): readonly StaffDestination[] {
  return visibleStaffDestinations(gates).filter((destination) => destination.navGroup === group);
}

/** The "Go to" rows the command palette offers this viewer. */
export function staffPaletteDestinations(
  gates: StaffDestinationGates,
): readonly StaffDestination[] {
  return visibleStaffDestinations(gates).filter((destination) => destination.inPalette);
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
 * Which nav destination is "you are here" for this page — exactly one, or
 * none. Most specific claim wins, so `/settings/team` lights Team rather than
 * both Team *and* the Settings row above it; ties fall to registry order
 * (the shop root is Today, never the by-departure view). Only destinations
 * that actually render somewhere in the nav (`navGroup` set) compete: the
 * walk-in counter is a way into Check-in, and its more specific path must not
 * steal the Check-in tab's light.
 *
 * Every nav consumer — the header tabs, the phone dock, the More menu and
 * sheet — answers "which row is current?" through this one function; three of
 * them used to answer it independently, and only one knew about `alsoMatch`.
 */
export function currentStaffNavDestinationId(
  pathname: string,
  root: string,
  gates: StaffDestinationGates,
): StaffDestinationId | null {
  let currentId: StaffDestinationId | null = null;
  let longest = 0;
  for (const destination of visibleStaffDestinations(gates)) {
    if (destination.navGroup === null) continue;
    const claim = destinationClaim(pathname, root, destination);
    if (claim > longest) {
      currentId = destination.id;
      longest = claim;
    }
  }
  return currentId;
}
