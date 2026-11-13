/**
 * **The route tree is the registry; a page's parent is its URL's parent**
 * (issue #2748, `docs/design/principles.md` §10).
 *
 * Every staff page under `/shop/<shopSlug>` is a node here, keyed by its
 * directory below `[shopSlug]` exactly as the file system spells it
 * (`staff-routes.test.ts` walks `src/app/shop/[shopSlug]` and fails on a page
 * with no node, or a node with no page). A node's way up is read off the URL:
 * the nearest ancestor that is itself a page. Depth 1 has none, so its eyebrow
 * is its own name. A node writes its parent only where the URL lies about it,
 * and each such line says why.
 *
 * `ShopPageHeader` and `EyebrowWayUp` resolve the link from the pathname, so a
 * page never carries a hand-written href for its way up, and a page added
 * below an existing one links to it without anyone writing the link.
 *
 * Paths only, never a word anyone reads: the eyebrow's words stay with the
 * page (they are often data — a diver's name), and this module returns hrefs.
 */

/** One staff page. Every field is optional: most nodes are just their key. */
export type StaffRouteNode = {
  /**
   * The parent's path below `[shopSlug]`, when the URL's own parent is not it.
   * `[name]` segments take the current page's params by name, so
   * `schedule/blowout/[tripId]` can name `trips/[tripId]`. `null` says the page
   * has no way up although its URL is nested (a section's own home).
   */
  readonly parent?: string | null;
  /**
   * A departure's face: one of the strip's members (ADR
   * 20260827-the-departure, decision 1). Its way up is the departure's parent,
   * the board, not the departure itself, because the faces are readings of one
   * departure rather than places below it.
   */
  readonly face?: true;
  /** Appended to the parent's href: where on the parent this page came from. */
  readonly upHash?: string;
};

const BOARD = "schedule/board";
const SETTINGS = "settings";

/**
 * Every staff page. Keys are sorted as the file system lists them.
 *
 * The overrides fall into three families. The shop's registers (boats, trip
 * tags, safety checklist, waivers) sit at depth 1 for their own nav rows but
 * are set up from Settings, so Settings is their parent until they move under
 * it. The board wears two URL segments (`/schedule` has no page), so every
 * reading of the schedule names it directly. And the faces and paper sheets say
 * where on the parent they were opened from.
 */
export const STAFF_ROUTES = {
  "": {},
  boats: { parent: SETTINGS },
  courses: {},
  certifications: {},
  "courses/[slug]/edit": {},
  "dive-sites": {},
  "dive-sites/[id]": {},
  divers: {},
  "divers/[personId]": {},
  "divers/[personId]/merge/[survivorId]": {},
  "divers/[personId]/waivers/[recordId]": { upHash: "#waiver" },
  "divers/[personId]/waivers/[recordId]/print": {},
  gear: {},
  "gear/[id]": {},
  "gear/rentals/[ticketId]": {},
  "gear/work-orders": {},
  "gear/work-orders/[workOrderId]": {},
  "gear/work-orders/[workOrderId]/tag": {},
  inbox: {},
  "lost-found": {},
  // `/me` has no page: the account hub is `me/security`, and the staffer's own
  // calendar feed and email hang off it.
  "me/calendar": { parent: "me/security" },
  "me/email": { parent: "me/security" },
  "me/security": {},
  orders: {},
  "orders/[id]": {},
  "orders/[id]/print/dispute": {},
  print: {},
  "print/counter-card": { parent: SETTINGS },
  promos: {},
  reports: {},
  requests: {},
  reviews: {},
  safety: {},
  "safety/drills": {},
  "safety/print": {},
  "safety-checklist": { parent: SETTINGS },
  "schedule/blowout/day/[date]": { parent: BOARD },
  "schedule/board": {},
  "schedule/day/[date]": { parent: BOARD },
  settings: {},
  "settings/activity": {},
  "settings/billing": {},
  "settings/bookkeeper": {},
  "settings/dock-day": {},
  "settings/embed": {},
  "settings/emergency-reference": {},
  "settings/export": {},
  // Backups is the Data group's second page, beside Export rather than under it.
  "settings/export/backups": { parent: SETTINGS },
  "settings/features": {},
  "settings/import": {},
  "settings/integrations": {},
  "settings/profile": {},
  "settings/rentals": {},
  "settings/team": {},
  "settings/whatsapp": {},
  staffing: {},
  "staffing/print": {},
  "trip-tags": { parent: SETTINGS },
  // `/trips` has no page: a departure is the board's detail view.
  "trips/[id]": { parent: BOARD },
  "trips/[id]/incidents/[reportId]": { upHash: "?view=details#incidents" },
  "trips/[id]/log": {},
  "trips/[id]/log/print": {},
  "trips/[id]/manifest": { face: true },
  "trips/[id]/party/[leadId]/waivers": {},
  "trips/[id]/party/[leadId]/waivers/[bookingId]/doctor": {},
  "trips/[id]/prep": { face: true },
  waivers: { parent: SETTINGS },
  "waivers/print": {},
} as const satisfies Record<string, StaffRouteNode>;

export type StaffRouteKey = keyof typeof STAFF_ROUTES;

/** Where a pathname sits in the tree. */
export type StaffRouteMatch = {
  readonly key: StaffRouteKey;
  readonly shopSlug: string;
  readonly params: Readonly<Record<string, string>>;
  /** The parent page's href, or `null` at depth 1 and for a section's own home. */
  readonly parentHref: string | null;
};

const STAFF_PREFIX = "/shop/";

function segmentsOf(path: string): string[] {
  return path === "" ? [] : path.split("/");
}

function isParam(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

/** The params a key's pattern binds from `segments`, or `null` when it does not match. */
function bind(key: string, segments: readonly string[]): Record<string, string> | null {
  const pattern = segmentsOf(key);
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of pattern.entries()) {
    const segment = segments[index] ?? "";
    if (isParam(part)) {
      if (segment === "") return null;
      params[part.slice(1, -1)] = segment;
    } else if (part !== segment) {
      return null;
    }
  }
  return params;
}

/**
 * A static segment outranks a param at the first place two keys differ, as the
 * router decides it: `gear/work-orders` is not `gear/[id]`.
 */
function moreSpecific(a: string, b: string): boolean {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  for (const [index, part] of left.entries()) {
    const other = right[index] ?? "";
    if (isParam(part) !== isParam(other)) return !isParam(part);
  }
  return false;
}

function matchKey(
  segments: readonly string[],
): { key: StaffRouteKey; params: Record<string, string> } | null {
  let best: { key: StaffRouteKey; params: Record<string, string> } | null = null;
  for (const key of Object.keys(STAFF_ROUTES) as StaffRouteKey[]) {
    const params = bind(key, segments);
    if (params && (best === null || moreSpecific(key, best.key))) best = { key, params };
  }
  return best;
}

function fill(template: string, params: Readonly<Record<string, string>>): string {
  return segmentsOf(template)
    .map((part) => (isParam(part) ? (params[part.slice(1, -1)] ?? part) : part))
    .join("/");
}

/** The parent's path below `[shopSlug]`, before any `upHash`; `null` for none. */
function parentPath(
  key: StaffRouteKey,
  segments: readonly string[],
  params: Readonly<Record<string, string>>,
): string | null {
  const node: StaffRouteNode = STAFF_ROUTES[key];
  if (node.face) {
    const departure = segments.slice(0, 2);
    const match = matchKey(departure);
    return match ? parentPath(match.key, departure, match.params) : null;
  }
  if (node.parent !== undefined) return node.parent === null ? null : fill(node.parent, params);
  // The URL's own parent: the nearest ancestor that is a page. The shop home is
  // nobody's way up — depth 1 names itself (principle 10, first bullet). The
  // ancestor is read off the node's own pattern, never matched afresh:
  // `gear/rentals` would match `gear/[id]`, but it is not a page.
  const pattern = segmentsOf(key);
  for (let depth = pattern.length - 1; depth >= 1; depth -= 1) {
    if (Object.hasOwn(STAFF_ROUTES, pattern.slice(0, depth).join("/"))) {
      return segments.slice(0, depth).join("/");
    }
  }
  return null;
}

/**
 * The staff page a pathname is, with its parent's href; `null` for a path that
 * is not a staff page. A query string or hash on the pathname is ignored.
 */
export function staffRouteAt(pathname: string): StaffRouteMatch | null {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith(STAFF_PREFIX)) return null;
  const [shopSlug = "", ...segments] = path
    .slice(STAFF_PREFIX.length)
    .split("/")
    .filter((segment) => segment !== "");
  if (shopSlug === "") return null;
  const match = matchKey(segments);
  if (!match) return null;
  const parent = parentPath(match.key, segments, match.params);
  const node: StaffRouteNode = STAFF_ROUTES[match.key];
  return {
    key: match.key,
    shopSlug,
    params: match.params,
    parentHref:
      parent === null
        ? null
        : `${STAFF_PREFIX}${shopSlug}${parent === "" ? "" : `/${parent}`}${node.upHash ?? ""}`,
  };
}

/**
 * The diver pages with a way up, keyed below `/s/[shopSlug]`. Each one's
 * parent is the shop's schedule, `/s/<shopSlug>` itself, which is what their
 * URL says. Every other diver page is a destination of `PublicShopNav` and
 * names itself.
 */
const PUBLIC_PAGES_WITH_A_WAY_UP = ["reviews", "sites/[siteSlug]", "trips/[id]"] as const;

const PUBLIC_PREFIX = "/s/";

/**
 * The href of the page above `pathname`, staff or diver; `null` when the page
 * has none. What `ShopPageHeader`'s eyebrow links to.
 */
export function wayUpHref(pathname: string): string | null {
  const staff = staffRouteAt(pathname);
  if (staff) return staff.parentHref;
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith(PUBLIC_PREFIX)) return null;
  const [shopSlug = "", ...segments] = path
    .slice(PUBLIC_PREFIX.length)
    .split("/")
    .filter((segment) => segment !== "");
  if (shopSlug === "") return null;
  return PUBLIC_PAGES_WITH_A_WAY_UP.some((key) => bind(key, segments) !== null)
    ? `${PUBLIC_PREFIX}${shopSlug}`
    : null;
}
