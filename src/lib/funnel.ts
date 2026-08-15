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
 * position (`home-hero` / `home-closing`, `product` / `product-mid`,
 * `pricing` / `pricing-close`) — otherwise a mid-page door added to answer "one
 * CTA at the bottom of ten sections" folds into the page total and can never be
 * shown to have earned its place. The unsuffixed tag stays the page's original
 * one so attribution history doesn't break when a new position is added beside
 * it.
 *
 * A tag stays registered after its door is removed, so the history it collected
 * still reads — but a retired tag is **not** free to reuse, because new traffic
 * would land in the same bucket as the old and neither could be read on its own.
 * `home-mid` is retired: the homepage's mid-page demo door came out on
 * 2026-08-13 when three consecutive banded CTAs merged into one close. A new
 * mid-page door on `/` needs a new tag.
 */
const FIXED_SOURCES = [
  "home-hero",
  "home-diver-moment",
  // Retired 2026-08-13 — kept for history, not for reuse. See above.
  "home-mid",
  // The records band's two doors onto the switching surface, split by position
  // for the reason above: `home-records` is the band-level link to the hub,
  // `home-records-arriving` the spreadsheet door inside the "Coming in" column.
  // Folded into one tag, neither could be read on its own — and which of them a
  // spreadsheet shop uses is the question that put the second one there
  // (docs/product/marketing.md).
  "home-records",
  "home-records-arriving",
  "home-closing",
  "nav",
  "product",
  "product-mid",
  "pricing",
  "pricing-close",
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

/**
 * The two doors onto the switching surface: the hub, which forks to the
 * incumbent guides and the spreadsheet path, and the spreadsheet guide itself.
 * A union rather than a free path because the question these tags answer is
 * which of the two a reader takes — a third destination is a deliberate edit
 * here, not a string a page invents.
 *
 * A switching page retags its own demo/trial CTAs with its own source, so the
 * hop *into* it can only be attributed on the way in: the query string this
 * builds rides the Vercel `<Analytics />` page view, the same way
 * `scheduleAttributionHref` carries the diver-preview link's tag.
 */
export type SwitchingDestination = "/switching" | "/switching/spreadsheet";

export function switchingHref(destination: SwitchingDestination, source: FunnelSource): string {
  return `${destination}?from=${source}`;
}
