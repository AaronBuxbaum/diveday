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
 * Where a destination sits in the header.
 *
 * - `primary` — the five tabs always on screen.
 * - `daily` — inside "More": the surfaces a shop touches on an ordinary day.
 * - `setup` — inside "More": the ones it configures once and revisits rarely.
 *
 * `null` means the destination is real and reachable, but not in the header —
 * it earns its place in the palette instead of a fifteenth tab (design
 * principle 8, fewer controls).
 */
export type StaffNavGroup = "primary" | "daily" | "setup";

export type StaffDestinationId =
  | "today"
  | "checkIn"
  | "walkIn"
  | "blockers"
  | "divers"
  | "board"
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
  { id: "today", suffix: "", navGroup: "primary", inPalette: true, shortcut: "t" },
  { id: "checkIn", suffix: "/check-in", navGroup: "primary", inPalette: true },
  {
    id: "blockers",
    suffix: "/blockers",
    navGroup: "primary",
    inPalette: true,
    badge: "blockers",
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
  // A shortcut into Check-in rather than a destination of its own, so it stays
  // out of the header and lives where someone types what they want.
  { id: "walkIn", suffix: "/check-in/walk-in", navGroup: null, inPalette: true },
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
  // Promo codes move money, so they sit with the owner/manager payment
  // settings rather than in the day-to-day group (H-14).
  { id: "promoCodes", suffix: "/promos", navGroup: "setup", inPalette: true, gate: "reports" },
  { id: "settings", suffix: "/settings", navGroup: "setup", inPalette: true },
  { id: "team", suffix: "/settings/team", navGroup: "setup", inPalette: true, gate: "team" },
];

/** The `/shop/<shopSlug>` prefix every destination hangs off. */
export function staffShopRoot(shopSlug: string): string {
  return `/shop/${shopSlug}`;
}

/** A destination's full path for one shop. */
export function staffDestinationHref(root: string, destination: StaffDestination): string {
  return `${root}${destination.suffix}`;
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
