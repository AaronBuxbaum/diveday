import { MIGRATION_GUIDE_SLUGS } from "./migration-guides";
import { publicSchedulePath } from "./public-routes";

/**
 * The funnel vocabulary: every page that can send a visitor toward the demo or
 * a trial, named once. Both marketing events (`demo_entered`, `trial_started`)
 * carry one of these tags so the two halves can be read per surface.
 *
 * A registry rather than a loose string, because the failure it prevents is
 * silent: a misspelled tag doesn't error, it just opens a second bucket that
 * looks like a real page with suspiciously few visits. Tags are chosen from
 * this list at the call site (`trialHref`, `<FunnelTag>`), and anything that
 * arrives off a request is clamped back to it by `eventSource`.
 *
 * A page that offers the same action from more than one place splits its tag by
 * position (`home-hero` / `home-mid` / `home-closing`, `product` / `product-mid`)
 * — otherwise a mid-page door added to answer "one CTA at the bottom of ten
 * sections" folds into the page total and can never be shown to have earned its
 * place. The unsuffixed tag stays the page's original one so attribution
 * history doesn't break when a new position is added beside it.
 */
const FIXED_SOURCES = [
  "home-hero",
  "home-diver-moment",
  "home-mid",
  "home-closing",
  "nav",
  "product",
  "product-mid",
  "pricing",
  "about-closing",
  "sign-in",
  "switching-hub",
  "switching-spreadsheet",
] as const;

/**
 * A switching guide contributes one tag per registered incumbent. Those slugs
 * are data (`migration-guides.ts`), not literals a page hand-types, so they
 * widen the type rather than enumerating it — `guideSource` is the only way to
 * build one, and the route has already 404'd an unregistered slug before any
 * page can ask for its tag.
 */
export type FunnelSource = (typeof FIXED_SOURCES)[number] | `switching-${string}`;

const FIXED = new Set<string>(FIXED_SOURCES);

/** The funnel tag for one switching guide, from the slug the route validated. */
export function guideSource(slug: string): FunnelSource {
  return `switching-${slug}`;
}

/**
 * Normalize a funnel tag that arrived from the visitor's own request — a query
 * string or a posted form field. Only tags this file knows about survive;
 * everything else becomes "unknown" rather than entering the event stream as
 * its own property.
 */
export function eventSource(value: unknown): FunnelSource | "unknown" {
  if (typeof value !== "string") return "unknown";
  const known =
    FIXED.has(value) || MIGRATION_GUIDE_SLUGS.some((slug) => value === guideSource(slug));
  return known ? (value as FunnelSource) : "unknown";
}

/**
 * The trial CTA's destination. Every "Start a trial" link goes through here, so
 * the tag can't be forgotten on a new one or misspelled on an existing one —
 * both become type errors instead of a gap in the funnel.
 */
export function trialHref(source: FunnelSource): string {
  return `/onboard?from=${source}`;
}

/**
 * The "see a diver's booking page" link's destination — the third door out of
 * a marketing CTA, alongside the demo and the trial. Tagged the same way
 * `trialHref` tags its own; the query string needs no companion custom event
 * because the Vercel `<Analytics />` page view it produces already carries it.
 * Takes the shop slug rather than assuming the demo shop, so a server
 * component supplies `DEMO_SHOP_SLUG` and this file — reachable from a client
 * component — never imports `src/db`.
 */
export function scheduleAttributionHref(shopSlug: string, source: FunnelSource): string {
  return `${publicSchedulePath(shopSlug)}?from=${source}`;
}
