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
 * **Where a destination sits in time** — ADR 20260919-one-idea, decision I ·
 * Tide, slice 23b.
 *
 * This was `StaffNavGroup`: `primary` for the tabs always on screen, `daily`
 * and `setup` for the two groups inside "More". Those are kinds of *noun* — a
 * shop was asked which of twenty-one things it wanted, and the answer had to
 * be a row in a bar, a row in a menu, or a row in a sheet rising from a dock.
 * Tide asks a different question: **when does this thing happen?** A boat is a
 * moment on the day, a course is sessions on days, a request is a day somebody
 * asked for, money is what the days made. Only what a shop *configures* has no
 * hour at all.
 *
 * - `day` — what is happening now: the day itself, the dock this morning, what
 *   divers wrote back.
 * - `week` — what is coming: the board, who is working it, the courses running
 *   across it, the days divers asked for.
 * - `season` — what the days added up to: the money, the month, the reviews.
 * - `shop` — the only one with no hour, and the reason it is a place at all:
 *   what a shop sets up rather than works. It lives behind the shop's own name
 *   (the ADR: "Only Settings has no hour and lives behind the shop's name").
 *
 * **Nothing is `null` any more, and that is the point.** `navGroup: null` used
 * to mean "real, reachable, but not in the header" — a hole the old bar needed
 * because it could only hold so many rows. A place is not a slot, so there is
 * nothing to be left out of: an act like the walk-in counter still happens on
 * the day, and saying so costs the bar nothing.
 *
 * The bar renders **three** of these and never a list of destinations: Today,
 * Week and Season, one link each (`STAFF_BAR_PLACES`). Everything else is
 * reached through the day it sits on, or through the search — which is a
 * control in the bar at every width, not a keyboard shortcut. That distinction
 * is load-bearing: ADR 20260813-more-is-the-shops-other-door retired an
 * earlier bar on the grounds that "fourteen destinations reachable only by ⌘K
 * was a desktop-keyboard answer to a phone-thumb question", and it still is.
 */
export type StaffPlace = "day" | "week" | "season" | "shop";

/**
 * The three the bar wears, in order, each one link rather than a group.
 *
 * Drawn that way: the desk bar on `Tide.dc.html` is the shop's name, then
 * `Today · Week · Season`, then the search, then the reader. The pills are
 * times, so the pages behind them may be rebuilt (the board becomes the week
 * in 23f, the season grows in 23g) without the bar changing at all.
 */
export const STAFF_BAR_PLACES = [
  { place: "day", id: "today" },
  { place: "week", id: "board" },
  { place: "season", id: "reports" },
] as const satisfies readonly { place: StaffPlace; id: StaffDestinationId }[];

/** One of the three the bar wears — never `shop`, which is behind the name. */
export type StaffBarPlace = (typeof STAFF_BAR_PLACES)[number]["place"];

export type StaffDestinationId =
  | "today"
  | "checkIn"
  | "walkIn"
  | "tookACall"
  | "divers"
  | "board"
  | "addBooking"
  | "staffing"
  | "diveSites"
  | "gear"
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
  walkIn: "shared.shopNavLinks.walkIn",
  tookACall: "shared.shopNavLinks.tookACall",
  divers: "shared.shopNavLinks.divers",
  board: "shared.shopNavLinks.board",
  addBooking: "shared.shopNavLinks.addBooking",
  staffing: "shared.shopNavLinks.staffing",
  diveSites: "shared.shopNavLinks.diveSites",
  gear: "shared.shopNavLinks.gear",
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
  inbox: "inbox.title",
  diveSites: "diveSites.list.title",
  promoCodes: "promos.title",
};

export type StaffDestination = {
  readonly id: StaffDestinationId;
  /** Path below `/shop/<shopSlug>`; `""` is the shop home (Today). */
  readonly suffix: string;
  /** When this thing happens. Never absent — a place is not a slot. */
  readonly place: StaffPlace;
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
  // are read — both ways of reading them (ADR 20260803-not-ready-is-a-view) —
  // and, since H-62, where the day is closed as well. **There is no Close-out
  // destination**: the evening is a state this page settles into, not a place
  // to go (ADR 20260827-clearwater-surface-language, decision 4). An entry
  // pointing at the bare home would be a second row landing on Today's own
  // URL, which this registry's unique-URL invariant refuses outright — so the
  // palette answers "close the day" with a command carrying an anchor, not
  // with a destination.
  {
    id: "today",
    suffix: "",
    place: "day",
    inPalette: true,
    badge: "blockers",
  },
  { id: "checkIn", suffix: "/check-in", place: "day", inPalette: true },
  // **There is no "Not ready" destination.** It was a page, then Today's
  // by-departure view behind `?view=departures`, and it is now neither: the
  // shop home is one chronological spine and a blocked diver is a row on the
  // station of the boat waiting for them (ADR
  // 20260827-clearwater-surface-language, decision 4). An entry pointing at the
  // bare home would be a second palette row landing on Today's own URL — the
  // duplicate control principle 8 forbids, and one this registry's
  // unique-URL invariant refuses outright. Today keeps the blocked badge.
  { id: "divers", suffix: "/divers", place: "day", inPalette: true },
  // Staff work a departure on /trips/[id], which is the board's detail view —
  // keep the board tab lit so they don't lose their place.
  {
    id: "board",
    suffix: "/schedule/board",
    place: "week",
    inPalette: true,
    // Trips are the board's detail views. (Staffing used to be claimed here
    // too — it has its own "Run the shop" row now, and lights that instead.)
    alsoMatch: ["/trips"],
  },
  // The global "seat a diver" door. It is an action rather than a place, so it
  // stays out of the header — the board hosts its own button and the palette
  // answers for it everywhere else. It is *here* because the registry is the
  // only place a destination may be declared: it used to be a hand-written
  // palette item, which is exactly the drift this file exists to end.
  { id: "addBooking", suffix: "/bookings/new", place: "day", inPalette: true },
  // A way into Check-in rather than a destination of its own, so it stays out
  // of the header and lives where someone types what they want.
  { id: "walkIn", suffix: "/check-in/walk-in", place: "day", inPalette: true },
  // The desk phone's door (N-22): one capture that becomes a date request, a
  // wait-list entry or a booking. Palette-only for the same reason `addBooking`
  // and `walkIn` are — it is an *act*, not a place a shop stands in, and the
  // bar wears three times and no acts at all. It is *here* because the registry
  // is the only place a destination may be declared at all, and its `place` is
  // the day because that is the day it interrupts.
  //
  // Ungated, deliberately: gating this would take the phone away from the
  // person most likely to answer it. It used to be the odd one out — the
  // Requests page one of its three outcomes writes to, and redirects to, sat
  // behind `reports` — and since 2026-09-16 that page is ungated too, so the
  // call and the row it becomes are now reachable by the same people.
  { id: "tookACall", suffix: "/calls", place: "day", inPalette: true },
  { id: "staffing", suffix: "/staffing", place: "week", inPalette: true },
  { id: "courses", suffix: "/courses", place: "week", inPalette: true },
  { id: "diveSites", suffix: "/dive-sites", place: "shop", inPalette: true },
  // The rental fleet register (ADR 20260815-minimal-gear-register), and the
  // **day's** work rather than the shop's: packing, handing over and chasing
  // returns is a morning's rhythm, not configuration.
  //
  // It was `navGroup: "daily"` and slice 23b mapped it to `place: "shop"`,
  // which inverted it — that place is what a shop *sets up*, and it is
  // defined by living behind the shop's own name. Gear never did: Settings
  // has a door to the site library, the waiver template, promo codes, the
  // team and the calendar feed, and never had one to the fleet. So the row
  // said "behind the shop's name" while its own comment said "the day's
  // rhythm", and the register was reachable by the search alone on any
  // morning nothing had gone wrong. `settings-doors.test.ts` now refuses
  // the mismatch in either direction (#1937).
  //
  // Filed under the day it belongs to, it keeps the company it always had:
  // `divers`, `checkIn`, `walkIn` and `inbox` are whole lists too, and they
  // are the day's because a diver, a counter and a message are worked on a
  // day. So is a wetsuit that goes out at eight and is chased at four.
  //
  // Ungated: gear is any-staff work (H-06 already lets any staff member
  // substitute a real available item, "because that is the day's work"). Its
  // pending-work signal is Today's gear rows, never a nav badge — same rule
  // as Reviews.
  { id: "gear", suffix: "/gear", place: "day", inPalette: true },
  // The waiver template and signature log — owner/manager work, and part of
  // running the shop rather than setting it up: the log is where a signature
  // question gets answered on a working day.
  {
    id: "waivers",
    suffix: "/waivers",
    place: "shop",
    inPalette: true,
    gate: "waivers",
  },
  // Its pending-work signal lives on Today's queue (a `reviews_pending`
  // row), the same pattern as stuck payments — a queue's badge belongs on the
  // page that ranks work, not on a nav row.
  //
  // Ungated, and the absent `gate:` covers the destination only: moderating
  // public words is any-staff work, but the private "asked us to fix" panel
  // *inside* the page carries its own owner/manager gate (issue #1410), in the
  // page and again in its action.
  { id: "reviews", suffix: "/reviews", place: "season", inPalette: true },
  // Divers asking for a day that is not on the board. Part of the shop's
  // running cadence rather than its setup — a shop reads this the way it reads
  // reviews, on its own rhythm, and answers it by putting a departure up, which
  // is why it sits in the **week**: a request is a day that is not on the board
  // yet.
  //
  // **Ungated since 2026-09-16**, and the gate was *deleted* rather than
  // relaxed, the way the inbox's was (issue #1679, an H-14 amendment).
  //
  // It carried the `reports` gate on two grounds. The privacy one stopped being
  // true on 2026-09-10: the inbox one row below renders the same thing for a
  // message from an address with no diver record — a stranger's address or
  // number, their subject and their message — to every live staff role, and
  // lets them answer it in the shop's name. A rule that refuses a captain here
  // and admits them one tab across is not drawing a line, it is describing
  // where two features happened to ship.
  //
  // The commercial one — deciding which unscheduled day is worth a boat is the
  // desk's work, not the water's — survived longer and lost on the same
  // argument that opened the inbox: the person best placed to answer a diver
  // asking for a Tuesday is whoever is at the counter on Tuesday. Putting a
  // departure on the board is still the board's own work and unchanged by this.
  //
  // One thing this repairs rather than widens: `/calls` (the desk phone's door)
  // has always been ungated, and its `date-request` outcome *redirects* to this
  // page. A captain who took a call and wrote down a request was sent straight
  // into a refusal for the row they had just written.
  { id: "requests", suffix: "/requests", place: "week", inPalette: true },
  // What divers wrote back (ADR 20260907-two-way-inbox). Work a shop reads on
  // its own rhythm and empties by answering, beside Requests and Reviews — but
  // filed under the **day**, not the week: an unanswered message is somebody
  // waiting on today's answer, and Today's queue is where it signals.
  //
  // Ungated since 2026-09-10: it carried an owner/manager gate of its own for
  // the three days between shipping and the owner reading both halves of that
  // gate's argument the other way (issues #1505/#1518, an H-14 amendment —
  // the reasoning is in ADR 20260907-two-way-inbox decision 9, and the code it
  // governs is `replyToDiverAction`). Its pending-work signal is Today's
  // `unanswered_messages` row, never a nav badge — the same rule Reviews
  // follows.
  { id: "inbox", suffix: "/inbox", place: "day", inPalette: true },
  // Money the shop reads daily — a "Run the shop" destination, not one of the
  // five all-day tabs. Orders remains ungated and palette-visible, and the
  // page's own links keep the money workflow reachable from its context.
  { id: "orders", suffix: "/orders", place: "season", inPalette: true },
  // The monthly read of the money Orders tracks daily — the last beat of the
  // "Run the shop" cadence, not configuration, so it files under `daily`
  // rather than `setup`. Its page lights its own row now instead of borrowing
  // the Orders tab.
  { id: "reports", suffix: "/reports", place: "season", inPalette: true, gate: "reports" },
  // Team and Promo codes still have doors on Settings' own cards — but a card
  // on a page you must already be on is a cross-link, not a menu presence,
  // and these two lead "Set up" because they are the configuration acts a
  // shop actually repeats (a new hire, a season's discount).
  { id: "team", suffix: "/settings/team", place: "shop", inPalette: true, gate: "team" },
  { id: "promoCodes", suffix: "/promos", place: "shop", inPalette: true, gate: "reports" },
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
    place: "shop",
    inPalette: true,
  },
  // Last, always: Settings is where a shop goes when nothing else on the menu
  // was the answer, so it closes the "Set up" group — a group with that name
  // ending anywhere else would be a joke missing its punchline.
  //
  // **The one place with no hour in it**, which is why `place` is `shop` and
  // the bar — three times — cannot hold it. So it is back behind the shop's own
  // name, where it lived before the More groups took it (ADR
  // 20260919-one-idea, slice 23b): the objection then was that one destination
  // in two menus is the duplicate control principle 8 forbids, and with the nav
  // gone there is no second menu for it to be in. `ShopIdentityMenu` draws it
  // above the rule, apart from the language and the way out, because those are
  // about *this reader and this session* and this is about the shop.
  //
  // No `alsoMatch` any more: Promo codes, Dive sites and Waivers each light
  // their own row now, and `/settings/*` sub-pages light this one by prefix —
  // except Team and the calendar feed, whose own rows win by being the more
  // specific match (`currentStaffNavDestinationId`).
  {
    id: "settings",
    suffix: "/settings",
    place: "shop",
    inPalette: true,
    gate: "settings",
  },
];

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

/**
 * The bar's three, minus any this viewer may not see.
 *
 * Season is `reports`, which is gated: a captain's bar is Today and Week, and
 * a two-pill bar is the honest picture rather than a pill that refuses. The
 * filtering lives here, with the gate, so the bar cannot forget to ask.
 */
export function staffBarPlaces(
  gates: StaffDestinationGates,
): readonly { place: StaffBarPlace; destination: StaffDestination }[] {
  return STAFF_BAR_PLACES.map(({ place, id }) => ({ place, destination: staffDestination(id) }))
    .filter(({ destination }) => passesGate(destination, gates))
    .map(({ place, destination }) => ({ place, destination }));
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
 * The destination this page belongs to — exactly one, or none. Most specific
 * claim wins, so `/settings/team` resolves to Team rather than the Settings
 * entry above it; ties fall to registry order (the shop root is Today).
 *
 * It no longer skips anything. It used to ignore every `navGroup: null` entry
 * so that the walk-in counter's more specific path could not steal the
 * Check-in tab's light — a guard the old bar needed because those two were
 * different rows in it. They are the same *place* now (both happen on the
 * day), so the question that guard existed to protect cannot be asked wrongly:
 * whichever of them claims the path, the answer is the day either way.
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
 * **Which of the bar's three is lit**, or none.
 *
 * The bar wears Today, Week and Season, so a page under `shop` — Settings,
 * the site library, the waiver template, promo codes — lights nothing, and
 * that is correct rather than a gap: every one of them lives behind the
 * shop's own name, which is its own control at the other end of the bar.
 * That "every" is the whole test of the place, and the gear register failed
 * it until #1937: it has no door there, because chasing a wetsuit is the
 * day's work. It is `day` now.
 */
export function currentStaffPlace(
  pathname: string,
  root: string,
  gates: StaffDestinationGates,
): StaffPlace | null {
  return currentStaffDestination(pathname, root, gates)?.place ?? null;
}
