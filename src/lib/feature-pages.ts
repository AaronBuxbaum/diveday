import type { DemoLanding } from "./demo-landings";
import type { DemoRoleId } from "./demo-roles";

/**
 * **The feature pages: one public page per job a shop hires DiveDay for**,
 * at `/product/<slug>` (the 2026-10-05 marketing rework, H-93).
 *
 * Until then the product had one page, `/product`, which walked a single
 * dive day in five screens and then listed every shipped workflow in one
 * long index. A shop owner who came to ask "does it do waivers?" had to find
 * the answer inside a line of that index, and a search engine had one page to
 * send every question to. Each page here answers one of those questions on its
 * own: what the shop gets, the screen that does it, how it works, everything
 * in it, and the questions shops ask about it.
 *
 * Keys and codes only, never words (ADR 20260731-domain-layer-copy-leaks; this
 * file is in `scripts/check-domain-strings.mjs`'s `proseFreeFiles`). Every
 * page's copy lives in the diver bundle under `marketing.featurePages.<key>`,
 * the same fields for every page, so the one template renders all twelve and
 * a page cannot quietly grow a section the others lack.
 *
 * The slug list is closed, and three things read it as such: the route's
 * `generateStaticParams` (no other slug is ever rendered), the edge refusal in
 * `src/lib/public-route-shape.ts` (any other slug is a real 404 before the
 * page streams), and the funnel's `eventSource` (a tag naming any other slug
 * is clamped to "unknown").
 */
export const FEATURE_PAGE_SLUGS = [
  "online-booking",
  "website",
  "waivers",
  "certifications",
  "messages",
  "check-in",
  "boat-manifest",
  "dive-sites",
  "rental-gear",
  "schedule",
  "courses",
  "payments",
] as const;

export type FeaturePageSlug = (typeof FEATURE_PAGE_SLUGS)[number];

/**
 * The bundle namespace of each page, `marketing.featurePages.<key>`, which is
 * also the key of its capability group (`marketing.capabilities.<key>`, read
 * through `productCapabilityIndex` in `src/lib/marketing.ts`).
 */
export type FeaturePageKey =
  | "onlineBooking"
  | "website"
  | "waivers"
  | "certifications"
  | "messages"
  | "checkIn"
  | "boatManifest"
  | "diveSites"
  | "rentalGear"
  | "schedule"
  | "courses"
  | "payments";

/**
 * Where in a shop's year the page's job falls, which is how `/product` groups
 * the pages: what happens before a diver arrives, what happens on the dive
 * day, and what runs the season around both.
 */
export const FEATURE_PHASES = ["before", "day", "season"] as const;
export type FeaturePhase = (typeof FEATURE_PHASES)[number];

/**
 * The screen a page draws, as a code; the page maps the code to its mockup
 * (`src/app/product/_components/FeatureScreen.tsx`). Each is a hand-drawn,
 * token-only picture of the real screen, element for element, never a
 * screenshot (docs/product/marketing.md, "Visuals").
 */
export type FeatureScreen =
  | "bookingCard"
  | "storefront"
  | "waiverSigning"
  | "readiness"
  | "nightBefore"
  | "arrivalDesk"
  | "rollCall"
  | "siteBriefing"
  | "gearRegister"
  | "scheduleWeek"
  | "coursePage"
  | "ordersLedger";

export interface FeaturePage {
  slug: FeaturePageSlug;
  key: FeaturePageKey;
  phase: FeaturePhase;
  screen: FeatureScreen;
  /**
   * Where the page's demo doors drop the reader: as which role, and on which
   * staff page (`src/lib/demo-landings.ts`). A diver lands on the public
   * schedule of their own demo shop and has no staff page, so a diver door
   * names no landing; every other door names the owner unless it lands on
   * Today, which every role has.
   */
  demo: { role: DemoRoleId; landing: DemoLanding | null };
  /** Three other pages a shop reading this one asks about next, in order. */
  related: readonly [FeaturePageSlug, FeaturePageSlug, FeaturePageSlug];
}

/** In `FEATURE_PAGE_SLUGS` order, which is the order `/product` lists them in. */
export const FEATURE_PAGES: readonly FeaturePage[] = [
  {
    slug: "online-booking",
    key: "onlineBooking",
    phase: "before",
    screen: "bookingCard",
    demo: { role: "diver", landing: null },
    related: ["website", "payments", "waivers"],
  },
  {
    slug: "website",
    key: "website",
    phase: "before",
    screen: "storefront",
    demo: { role: "diver", landing: null },
    related: ["online-booking", "courses", "dive-sites"],
  },
  {
    slug: "waivers",
    key: "waivers",
    phase: "before",
    screen: "waiverSigning",
    demo: { role: "owner", landing: "waivers" },
    related: ["certifications", "check-in", "messages"],
  },
  {
    slug: "certifications",
    key: "certifications",
    phase: "before",
    screen: "readiness",
    demo: { role: "owner", landing: "today" },
    related: ["waivers", "check-in", "boat-manifest"],
  },
  {
    slug: "messages",
    key: "messages",
    phase: "before",
    screen: "nightBefore",
    demo: { role: "owner", landing: "inbox" },
    related: ["online-booking", "waivers", "schedule"],
  },
  {
    slug: "check-in",
    key: "checkIn",
    phase: "day",
    screen: "arrivalDesk",
    demo: { role: "owner", landing: "today" },
    related: ["certifications", "boat-manifest", "rental-gear"],
  },
  {
    slug: "boat-manifest",
    key: "boatManifest",
    phase: "day",
    screen: "rollCall",
    demo: { role: "captain", landing: "today" },
    related: ["check-in", "dive-sites", "certifications"],
  },
  {
    slug: "dive-sites",
    key: "diveSites",
    phase: "day",
    screen: "siteBriefing",
    demo: { role: "owner", landing: "diveSites" },
    related: ["boat-manifest", "website", "schedule"],
  },
  {
    slug: "rental-gear",
    key: "rentalGear",
    phase: "day",
    screen: "gearRegister",
    demo: { role: "owner", landing: "gear" },
    related: ["online-booking", "check-in", "payments"],
  },
  {
    slug: "schedule",
    key: "schedule",
    phase: "season",
    screen: "scheduleWeek",
    demo: { role: "owner", landing: "board" },
    related: ["courses", "online-booking", "messages"],
  },
  {
    slug: "courses",
    key: "courses",
    phase: "season",
    screen: "coursePage",
    demo: { role: "owner", landing: "courses" },
    related: ["schedule", "certifications", "website"],
  },
  {
    slug: "payments",
    key: "payments",
    phase: "season",
    screen: "ordersLedger",
    demo: { role: "owner", landing: "orders" },
    related: ["online-booking", "rental-gear", "schedule"],
  },
];

const BY_SLUG = new Map<string, FeaturePage>(FEATURE_PAGES.map((page) => [page.slug, page]));

/** The page a slug names, or `undefined` for anything off the list. */
export function getFeaturePage(slug: string): FeaturePage | undefined {
  return BY_SLUG.get(slug);
}

/** A feature page's public path. */
export function featurePagePath(slug: FeaturePageSlug): `/product/${FeaturePageSlug}` {
  return `/product/${slug}`;
}

/** The pages of one phase, in list order. */
export function featurePagesIn(phase: FeaturePhase): readonly FeaturePage[] {
  return FEATURE_PAGES.filter((page) => page.phase === phase);
}

/**
 * A page's three related pages, resolved. Throws on a slug the registry does
 * not hold, which the registry's own test makes unreachable.
 */
export function relatedFeaturePages(page: FeaturePage): readonly FeaturePage[] {
  return page.related.map((slug) => {
    const related = getFeaturePage(slug);
    if (!related) throw new Error(`unregistered related feature page: ${slug}`);
    return related;
  });
}
