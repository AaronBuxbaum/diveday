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
 * position (`home-hero` / `home-closing`, `product` / `product-mid` /
 * `product-index`, `pricing` / `pricing-close`, `about-rules` / `about-closing`)
 * — otherwise a mid-page door added to answer "one CTA at the bottom of ten
 * sections" folds into the page total and can never be shown to have earned its
 * place. The unsuffixed tag stays the page's original one so attribution
 * history doesn't break when a new position is added beside it.
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
  // The door under `/product`'s capability index. Its band's lede — "every one
  // of these lines is something you can go and do in the live demo right now" —
  // makes the page's most explicit dare, and until 2026-08-28 the reader who
  // took it had nothing to act on for another two bands
  // (docs/product/marketing-review-20260827.md, "the dare gets a door"). It is
  // a third *position* for the same action rather than a different one, so it
  // suffixes `product` the way `product-mid` does: a reader convinced by the
  // inventory is a different moment from one convinced by the dock story, and
  // folded together neither could be read on its own.
  "product-index",
  // The in-page switching doors on `/product` and `/about` — one each, so they
  // take the page's name rather than a position suffix (the split above is for
  // one *action* offered from several places, which is
  // `product`/`product-mid`/`product-index` and
  // `home-records`/`home-records-arriving`). They are named apart from those
  // demo/trial tags because they are a different action: the reader is going to
  // read about moving, not to open the demo. Untagged until 2026-08-15, which
  // left `/switching/spreadsheet` with one measurable inbound door and one
  // invisible one — and `/product` is the page a reader lands on *after* the
  // homepage convinced them, so the hole was in the denominator of the exact
  // question the homepage door was added to answer.
  //
  // **A switching tag names its destination, not just its page**, because the
  // question these numbers answer is which of the two destinations a reader
  // chose. So `product-spreadsheet` groups with `home-records-arriving` (the
  // spreadsheet guide direct) and `about-switching` with `home-records` (the
  // hub, which forks) — a matched-looking `product-switching`/`about-switching`
  // pair would have hidden that they land in different places. A third page's
  // door follows the same rule: name where it goes.
  "product-spreadsheet",
  "pricing",
  "pricing-close",
  // `/about`'s two demo positions, split for the same reason as the three
  // above. The four checkable rules are where that page manufactures its
  // impulse — every card ends in the demo action that proves it, and the band
  // is headed "Four rules, and you can check every one" — and until 2026-08-28
  // the nearest thing to act on was a primary-weight mailto two bands further
  // down (docs/product/marketing-review-20260827.md, "help arrives after the
  // homework"). A reader who moved at the proof is a different moment from one
  // who read the concessions, the founder and the export terms and arrived at
  // the closing band; folded together neither could be read on its own.
  // `about-closing` stays the page's original tag so its history spans the
  // change.
  "about-rules",
  "about-closing",
  "about-switching",
  "sign-in",
  "switching-hub",
  "switching-spreadsheet",
  "switching-spreadsheet-mid",
  "switching-spreadsheet-close",
] as const;

/**
 * A switching guide contributes one tag per registered incumbent. Those slugs
 * are data (`migration-guides.ts`), not literals a page hand-types, so they
 * widen the type rather than enumerating it — `guideSource` is the only way to
 * build one, and the route has already 404'd an unregistered slug before any
 * page can ask for its tag.
 */
export type FunnelSource = (typeof FIXED_SOURCES)[number] | `switching-${string}`;
export type GuidePosition = "mid" | "close";

const FIXED = new Set<string>(FIXED_SOURCES);

/** The funnel tag for one switching guide, from the slug the route validated. */
export function guideSource(slug: string, position?: GuidePosition): FunnelSource {
  return `switching-${slug}${position ? `-${position}` : ""}`;
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
    FIXED.has(value) ||
    MIGRATION_GUIDE_SLUGS.some((slug) =>
      [guideSource(slug), guideSource(slug, "mid"), guideSource(slug, "close")].some(
        (source) => source === value,
      ),
    );
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

/**
 * `hash` lands the reader on the part of the guide the link's own words point
 * at — the homepage's "Your spreadsheet, column by column" opens two to three
 * screens above the column table it names unless it says `#columns`. It is
 * built here rather than at the call site so the ordering can only be right:
 * a fragment goes *after* the query string, and `"/switching/spreadsheet#columns?from=…"`
 * is a URL whose `?from=` is part of the fragment and never reaches analytics.
 * The fragment is our own literal, never anything off a request.
 */
export function switchingHref(
  destination: SwitchingDestination,
  source: FunnelSource,
  hash?: string,
): string {
  return `${destination}?from=${source}${hash ? `#${hash}` : ""}`;
}
