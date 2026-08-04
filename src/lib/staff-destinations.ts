/**
 * Every place a staff member can go inside `/shop/<shopSlug>`, in one list.
 *
 * The header nav, the ⌘K command palette, and the `g`-sequence keyboard
 * shortcuts used to each keep their own hand-written list, and the three had
 * drifted: Orders and Walk-in existed only in the palette, Team only in the
 * nav, and the shortcut sheet knew about five destinations out of fourteen. A
 * destination that exists in one list and not another is a surface a shop can
 * only reach by luck, so all three now derive from this table and cannot
 * disagree by construction.
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
export type StaffDestinationGate = "waivers" | "reports" | "team";

/** Which gates the current viewer passes. */
export type StaffDestinationGates = Record<StaffDestinationGate, boolean>;

/**
 * Pending-work counts a destination can carry as a badge. Computed by whoever
 * renders the nav — a badge here never runs its own query.
 */
export type StaffDestinationBadge = "reviews" | "blockers";

/** Counts for the badge sources above. */
export type StaffDestinationCounts = Record<StaffDestinationBadge, number>;

/**
 * What each badge's number *means*, in tone. Beside the badge sources rather
 * than in the nav component so the two cannot disagree, and so a new badge
 * source has to answer the question.
 *
 * `blockers` is danger because every other surface that names a blocked diver
 * is (glossary: "blocked is always danger" — `readinessStatusTone`). A count of
 * people who cannot board, toned like Reviews' moderation queue, was the one
 * place the shop's readiness vocabulary changed colour on the way to the nav.
 */
export const STAFF_DESTINATION_BADGE_TONES: Record<StaffDestinationBadge, "primary" | "danger"> = {
  reviews: "primary",
  blockers: "danger",
};

/**
 * Where a destination sits in the header.
 *
 * - `primary` — the four tabs always on screen (Today, Check-in, Divers, Board;
 *   Not ready gave its tab up when it became Today's by-departure view).
 * - `daily` — inside "More": the surfaces a shop touches on an ordinary day.
 * - `setup` — inside "More": the ones it configures once and revisits rarely.
 *
 * `null` means the destination is real and reachable, but not in the header —
 * it earns its place in the palette instead of one more tab (design
 * principle 8, fewer controls).
 */
export type StaffNavGroup = "primary" | "daily" | "setup";

export type StaffDestinationId =
  | "today"
  | "checkIn"
  | "closeOut"
  | "walkIn"
  | "blockers"
  | "divers"
  | "board"
  | "addBooking"
  | "staffing"
  | "diveSites"
  | "courses"
  | "reviews"
  | "orders"
  | "waivers"
  | "reports"
  | "promoCodes"
  | "settings"
  | "team";

/**
 * The word each destination goes by, resolved from the staff bundle by
 * whoever renders. `src/lib` never picks the words — it only insists that
 * every destination has exactly one, shared by all three consumers.
 */
export type StaffDestinationLabels = Record<StaffDestinationId, string>;

export type StaffDestination = {
  readonly id: StaffDestinationId;
  /** Path below `/shop/<shopSlug>`; `""` is the shop home (Today). */
  readonly suffix: string;
  /**
   * A query string (leading `?`) that selects a *view* of `suffix` rather than
   * a page of its own — the one case where two registry entries share a path.
   * Only `blockers` uses it; see its entry below for why it is still an entry.
   */
  readonly query?: string;
  /** Header placement, or `null` for palette-only. */
  readonly navGroup: StaffNavGroup | null;
  /** Whether the command palette offers it under "Go to". */
  readonly inPalette: boolean;
  /** Permission required to see it anywhere; absent means everyone. */
  readonly gate?: StaffDestinationGate;
  /** Pending-work count rendered beside the label. */
  readonly badge?: StaffDestinationBadge;
  /** Second key of the `g`-then-key sequence, when it has one. */
  readonly shortcut?: string;
  /**
   * A second path prefix that should also read as "you are here" — a detail
   * view living outside the destination's own subtree.
   */
  readonly alsoMatch?: string;
};

/**
 * Order matters: it is the order the nav renders each group and the order the
 * palette lists "Go to".
 */
export const STAFF_DESTINATIONS: readonly StaffDestination[] = [
  // Carries the blocked-diver badge because Today is now where blocked divers
  // are read — both ways of reading them (ADR 20260803-not-ready-is-a-view).
  {
    id: "today",
    suffix: "",
    navGroup: "primary",
    inPalette: true,
    badge: "blockers",
    shortcut: "t",
  },
  { id: "checkIn", suffix: "/check-in", navGroup: "primary", inPalette: true },
  // Not a page any more: Not ready is Today's by-departure *view*, selected by
  // a query param and served by the shop home. It keeps a registry entry
  // because it is still somewhere staff go by name — ⌘K "Not ready" and `g b`
  // both land on that view — and the registry is the only place a destination
  // may be declared. `navGroup: null` is what takes it out of the header: a
  // tab beside Today that only re-renders Today's own queue is the duplicate
  // control principle 8 forbids, and the switch on the page is the honest
  // control for it.
  {
    id: "blockers",
    suffix: "",
    query: "?view=departures",
    navGroup: null,
    inPalette: true,
    shortcut: "b",
  },
  { id: "divers", suffix: "/divers", navGroup: "primary", inPalette: true, shortcut: "d" },
  // Staff work a departure on /trips/[id], which is the board's detail view —
  // keep the board tab lit so they don't lose their place.
  {
    id: "board",
    suffix: "/schedule/board",
    navGroup: "primary",
    inPalette: true,
    shortcut: "s",
    alsoMatch: "/trips",
  },
  // The global "seat a diver" door. It is an action rather than a place, so it
  // stays out of the header — the board hosts its own button and the palette
  // answers for it everywhere else. It is *here* because the registry is the
  // only place a destination may be declared: it used to be a hand-written
  // palette item, which is exactly the drift this file exists to end.
  { id: "addBooking", suffix: "/bookings/new", navGroup: null, inPalette: true, shortcut: "a" },
  // A shortcut into Check-in rather than a destination of its own, so it stays
  // out of the header and lives where someone types what they want.
  { id: "walkIn", suffix: "/check-in/walk-in", navGroup: null, inPalette: true },
  // The end-of-day ritual (ADR 20260804-day-closeout) — Today's evening
  // mirror. Every staff role may close the day: whoever is last out of the
  // shop owns the ritual, and the recorded act carries their name, so the
  // accountability is in the trail rather than a gate. It leads the "Run the
  // shop" group because it is the one destination there that is part of every
  // single working day.
  { id: "closeOut", suffix: "/close-out", navGroup: "daily", inPalette: true },
  { id: "staffing", suffix: "/staffing", navGroup: "daily", inPalette: true },
  { id: "diveSites", suffix: "/dive-sites", navGroup: "daily", inPalette: true },
  { id: "courses", suffix: "/courses", navGroup: "daily", inPalette: true },
  { id: "reviews", suffix: "/reviews", navGroup: "daily", inPalette: true, badge: "reviews" },
  // Money the shop reads daily. It used to be reachable only from Settings'
  // Money card, the palette, or a deep link.
  { id: "orders", suffix: "/orders", navGroup: "daily", inPalette: true },
  {
    id: "waivers",
    suffix: "/waivers",
    navGroup: "daily",
    inPalette: true,
    gate: "waivers",
    shortcut: "w",
  },
  { id: "reports", suffix: "/reports", navGroup: "daily", inPalette: true, gate: "reports" },
  // Promo codes and Team are reachable from Settings' own Money and Your-shop
  // cards, and a destination that lives in two menus at once is the duplicate
  // control principle 8 forbids — the header used to carry both *and* Settings,
  // so "where do I add a colleague?" had two right answers. They keep their
  // palette rows and their `g`-less shortcut-free presence here (the registry
  // is the only place a destination may be declared); the header just stops
  // being one of the two doors. Team is also literally a Settings sub-page.
  { id: "promoCodes", suffix: "/promos", navGroup: null, inPalette: true, gate: "reports" },
  { id: "team", suffix: "/settings/team", navGroup: null, inPalette: true, gate: "team" },
  // Last, always: Settings is where a shop goes when nothing else on the menu
  // was the answer, and it is the one destination the whole "Set up" group
  // now holds. `alsoMatch` keeps the header honest for the destination that
  // left it: Promo codes is reached *from* this page, and without this the
  // promos page is the one staff surface where nothing in the header reads as
  // current at all. Team needs no entry — `/settings/team` is already below
  // `/settings`.
  {
    id: "settings",
    suffix: "/settings",
    navGroup: "setup",
    inPalette: true,
    alsoMatch: "/promos",
  },
];

/** The `/shop/<shopSlug>` prefix every destination hangs off. */
export function staffShopRoot(shopSlug: string): string {
  return `/shop/${shopSlug}`;
}

/**
 * Everything below `/shop/<shopSlug>` for one destination — its path plus, for
 * a destination that is a *view* of another page, the query that selects it.
 * Consumers that build a URL from parts (the keyboard-shortcut sheet) use this
 * rather than `suffix`, so a view can never be navigated to without its query.
 */
export function staffDestinationSuffix(destination: StaffDestination): string {
  return `${destination.suffix}${destination.query ?? ""}`;
}

/** A destination's full path for one shop. */
export function staffDestinationHref(root: string, destination: StaffDestination): string {
  return `${root}${staffDestinationSuffix(destination)}`;
}

/**
 * One destination by id, for the callers that link to a *particular* place
 * rather than rendering a list of them (Today's orientation card). Without
 * this they hand-write the path, which is how a link ends up pointing at
 * `/blockers` — a 308 to the view that replaced it — long after the registry
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

/** The `g`-sequence shortcuts this viewer can actually use. */
export function staffShortcutDestinations(
  gates: StaffDestinationGates,
): readonly (StaffDestination & { shortcut: string })[] {
  return visibleStaffDestinations(gates).filter(
    (destination): destination is StaffDestination & { shortcut: string } =>
      destination.shortcut !== undefined,
  );
}
