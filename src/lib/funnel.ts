import { FEATURE_PAGE_SLUGS, type FeaturePageSlug } from "./feature-pages";
import { MIGRATION_GUIDE_SLUGS } from "./migration-guides";
import { publicSchedulePath } from "./public-routes";

/**
 * The funnel vocabulary: every page that can send a visitor toward the demo,
 * named once. `demo_entered` and `setup_requested` carry one of these tags so
 * both doors can be read per surface: the demo form posts it, and the set-up
 * door carries it to `/get-set-up?from=`, whose form posts it back (ADR
 * 20261007-setup-request-form).
 *
 * A registry rather than a loose string, because the failure it prevents is
 * silent: a misspelled tag doesn't error, it just opens a second bucket that
 * looks like a real page with suspiciously few visits. Tags are chosen from
 * this list at the call site (`<FunnelTag>`), and anything that
 * arrives off a request is clamped back to it by `eventSource`.
 *
 * A page that offers the same action from more than one place splits its tag by
 * position (`home-hero` / `home-closing`, `pricing` / `pricing-close`,
 * `about-rules` / `about-closing`)
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
  // Retired 2026-10-05 — kept for history, not for reuse. The homepage's
  // annotated screens each ended in one door into the demo as the screen's
  // role (the 2026-09-24 voice decision), one tag per screen. The screens
  // became the steps of one booking (H-93), and each step now links to
  // its feature page, whose own demo door opens on that screen and carries
  // that page's tag (`featureSource`).
  "home-diver-moment",
  "home-desk-moment",
  "home-dock-moment",
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
  // Retired 2026-09-25 with the hero it tagged: the door out of the homepage's
  // "try it with your boats" drawing, which led to a self-serve sign-up that no
  // longer exists (ADR 20260925-shops-are-set-up-by-hand). Kept for history,
  // not for reuse.
  "home-drawn",
  "home-closing",
  "nav",
  "product",
  // Retired 2026-10-05 with the dock chapter's card it tagged, when `/product`
  // became the directory of the feature pages (H-93). Kept for history, not
  // for reuse.
  "product-mid",
  // Retired 2026-10-05 — kept for history, not for reuse. The door under
  // `/product`'s capability index, added 2026-08-28 when the index band's lede
  // dared the reader to go do any of its lines in the demo
  // (docs/product/marketing-review-20260827.md, "the dare gets a door"). The
  // index folded into the feature directory's rows in review on 2026-10-05,
  // and on a page that short the door stood 880px above the close's pair, the
  // pressure that retired `home-mid`.
  "product-index",
  // The in-page switching doors on `/product` and `/about` — one each, so they
  // take the page's name rather than a position suffix (the split above is for
  // one *action* offered from several places, which is
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
  // The export band's annotated screen ends in one door into the demo as the
  // owner, who downloads the export (issue #1955). Its own tag for the reason
  // `switching-hub-preview` has one: a reader who opened the demo from the
  // "what if I leave?" screen is a different moment from either pricing pair.
  "pricing-export",
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
  // `/about`'s work band, whose first door is the set-up form beside the
  // pricing and switching doors — a set-up door with no demo beside it, so it
  // takes its own tag rather than folding into the page's two pair positions.
  "about-work",
  "sign-in",
  // `/onboard`'s footer line, on both of the page's faces (issue #1956). The
  // page exists to start a shop, so a door back out of it is the one place
  // the funnel runs in reverse — a reader who came to set up and chose to look
  // first. That is a question worth its own bucket, and folded into `nav` or a
  // page tag it could never be asked. Until 2026-10-06 the line linked to `/`
  // and carried no tag at all.
  "onboard-demo",
  // `/onboard`'s closed door, for a reader who arrived from an old link: its
  // one button is the set-up form.
  "onboard-closed",
  // The thank-you page after a set-up request: one door into the demo while
  // the reader waits for a reply. Its own tag, because a demo opened by
  // somebody who has already asked to be set up is a different moment from a
  // demo opened instead of asking.
  "setup-sent",
  "switching-hub",
  // The hub's annotated import-preview screen ends in one door into the demo
  // as the owner, the role that runs the import (docs/design/brand.md, "The
  // builder's note"). Its own tag because a reader who opened the demo from
  // the screen itself is a different moment from one who did not find their
  // system in the list above it.
  "switching-hub-preview",
  "switching-spreadsheet",
  "switching-spreadsheet-mid",
  "switching-spreadsheet-close",
  // Retired 2026-10-02 with the demo's three story doors (`/demo/<story>`,
  // issue #1215), one tag per story. Kept for history, not for reuse.
  "story-first-booking",
  "story-returning-diver",
  "story-weather-day",
] as const;

/**
 * A switching guide contributes one tag per registered incumbent. Those slugs
 * are data (`migration-guides.ts`), not literals a page hand-types, so they
 * widen the type rather than enumerating it — `guideSource` is the only way to
 * build one, and the route has already 404'd an unregistered slug before any
 * page can ask for its tag.
 *
 * A feature page contributes its tags the same way, one per page and position
 * (`featureSource`): which feature a shop owner opened the demo from is the
 * question the feature pages exist to answer, so they are never folded into
 * one `product` bucket.
 */
export type FunnelSource =
  | (typeof FIXED_SOURCES)[number]
  | `switching-${string}`
  | `feature-${FeaturePageSlug}`
  | `feature-${FeaturePageSlug}-${FeaturePosition}`;
export type GuidePosition = "mid" | "close";

/**
 * A feature page's doors, by position: the hero pair is the page's own tag,
 * `close` is the closing band's pair. Split for the reason the file comment
 * gives: a reader who moved at the screen is a different moment from one who
 * read the questions and the limits first.
 */
export type FeaturePosition = "close";

const FIXED = new Set<string>(FIXED_SOURCES);

/** The funnel tag for one switching guide, from the slug the route validated. */
export function guideSource(slug: string, position?: GuidePosition): FunnelSource {
  return `switching-${slug}${position ? `-${position}` : ""}`;
}

/** The funnel tag for one feature page's doors, from the registry's own slug. */
export function featureSource(slug: FeaturePageSlug, position?: FeaturePosition): FunnelSource {
  return position ? `feature-${slug}-${position}` : `feature-${slug}`;
}

const FEATURE_SOURCES = new Set<string>(
  FEATURE_PAGE_SLUGS.flatMap((slug) => [featureSource(slug), featureSource(slug, "close")]),
);

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
    FEATURE_SOURCES.has(value) ||
    MIGRATION_GUIDE_SLUGS.some((slug) =>
      [guideSource(slug), guideSource(slug, "mid"), guideSource(slug, "close")].some(
        (source) => source === value,
      ),
    );
  return known ? (value as FunnelSource) : "unknown";
}

/** Where the `/get-set-up` form lives. */
export const SET_UP_PATH = "/get-set-up";

/** Where it lands once a request is stored: the thank-you page. */
export const SET_UP_SENT_PATH = `${SET_UP_PATH}/sent`;

/**
 * The "Get set up" door: the set-up form, carrying the tag of the page whose
 * door it is so the request it produces can be read per surface. The tag rides
 * the query string and the form posts it back; `eventSource` clamps whatever
 * arrives, so a hand-edited link opens no bucket of its own.
 */
export function setUpHref(source: FunnelSource): string {
  return `${SET_UP_PATH}?from=${source}`;
}

/**
 * The "see a diver's booking page" link's destination — the third door out of
 * a marketing CTA, alongside the demo and the set-up form. Tagged the same way
 * the demo form tags its own; the query string needs no companion custom event
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
