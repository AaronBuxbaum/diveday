import { publicSchedulePath } from "./public-routes";

/**
 * **A frame is where the URL is** (issue #2744; ADR 20260726-schedule-embed,
 * amendment 2026-11-03). Everything a shop can frame on its own website lives
 * under one path prefix, `/s/<shopSlug>/embed/`, and nothing outside it is
 * framable: the storefront, the trip page, this same shop's staff and sign-in
 * pages all keep the site's default deny (src/proxy.ts), so a third-party page
 * can never frame them for a clickjacking attempt.
 *
 * - the widget views of the embed catalogue (Harbor — ADR
 *   20260901-diveday-reimagined, decision 2): `embed/grid`, `embed/departure`,
 *   `embed/courses`, `embed/reviews`;
 * - the calendar, the next few departures as a compact ledger:
 *   `embed/calendar`;
 * - one departure's booking page, which the calendar's rows and a departure's
 *   lightbox open: `embed/trip/<tripId>`.
 *
 * There is no query parameter that turns a page into a frame. `?embed=1` used
 * to, on the storefront and the trip page, and it was deleted rather than
 * redirected (H-20260815-no-legacy): a query is something to forget on one
 * link or to smuggle onto another, and a segment's `loading.tsx` cannot read
 * it. A path is neither, and each of these segments has the frame's own
 * skeleton.
 */
export const EMBED_WIDGETS = ["grid", "departure", "courses", "reviews"] as const;
export type EmbedWidget = (typeof EMBED_WIDGETS)[number];

/** The static segment under `embed/` the framed schedule renders from. Never a widget. */
export const EMBED_CALENDAR_SEGMENT = "calendar";
/** The static segment under `embed/` whose `[id]` child is the framed trip page. */
export const EMBED_TRIP_SEGMENT = "trip";

const EMBED_ROUTE = new RegExp(
  `^/s/[a-z0-9-]+/embed/(?:${[...EMBED_WIDGETS, EMBED_CALENDAR_SEGMENT].join("|")}|${EMBED_TRIP_SEGMENT}/[^/]+)/?$`,
);

/**
 * True for exactly the paths a shop may frame — the one framing exception the
 * proxy grants, decided by the path alone.
 */
export function isEmbedRoute(pathname: string): boolean {
  return EMBED_ROUTE.test(pathname);
}

export function isEmbedWidget(value: unknown): value is EmbedWidget {
  return typeof value === "string" && (EMBED_WIDGETS as readonly string[]).includes(value);
}

/** A widget, or the calendar: every one-segment name under `embed/` that renders. */
export function isEmbedSegment(value: unknown): boolean {
  return isEmbedWidget(value) || value === EMBED_CALENDAR_SEGMENT;
}

const EMBED_SEGMENT_SHAPE = /^\/s\/[a-z0-9-]+\/embed\/([^/]+)\/?$/;

/**
 * `/s/<slug>/embed/<something>` where the something is neither a widget nor
 * the calendar. The page would answer with `notFound()`, but under partial
 * prerendering the static shell has already gone out with a 200 by the time
 * the page body runs, so a crawler or a host page with a typo would get a 200
 * not-found. The proxy answers these with a plain 404 before any shell is sent.
 *
 * This was the first edge refusal in the namespace and for a while the only
 * one, which made it look like a property of the embed *page* — a wrong reading
 * that cost three issues (#1489, #1510, #1604). It is not: every `/s/**` URL
 * that names nothing is now refused in `src/proxy.ts` for exactly this reason
 * (ADR 20260912-the-public-namespace-refuses-at-the-edge). This predicate stays
 * as the widget-catalogue half of that one rule — the only segment here whose
 * answer is a closed list rather than a row. `embed/trip/<id>` is a row, and
 * `public-route-shape.ts` judges it like the trip page.
 */
export function isUnknownEmbedWidgetRoute(pathname: string): boolean {
  const match = EMBED_SEGMENT_SHAPE.exec(pathname);
  return match !== null && !isEmbedSegment(match[1]);
}

/** The framed calendar: `/s/<slug>/embed/calendar`. */
export function embedCalendarPath(shopSlug: string): string {
  return `${publicSchedulePath(shopSlug)}/embed/${EMBED_CALENDAR_SEGMENT}`;
}

/** One catalogue widget: `/s/<slug>/embed/<widget>`. */
export function embedWidgetPath(shopSlug: string, widget: EmbedWidget): string {
  return `${publicSchedulePath(shopSlug)}/embed/${widget}`;
}

/** The framed trip page: `/s/<slug>/embed/trip/<tripId>`. */
export function embedTripPath(shopSlug: string, tripId: string): string {
  return `${publicSchedulePath(shopSlug)}/embed/${EMBED_TRIP_SEGMENT}/${tripId}`;
}

/**
 * What the loader on a shop's own site tells the frame about the page it sits
 * in ("inherit the host page", the look every widget defaults to): the host's
 * link colour, its body face, and — when the shop fixed one — the language.
 * Each rides a query parameter the proxy validates and forwards as a header,
 * so the layout can read it without a `searchParams` prop it does not have.
 * These are options of a frame, never what makes one: the path does that.
 */
export const EMBED_BRAND_HEADER = "x-diveday-embed-brand";
export const EMBED_FONT_HEADER = "x-diveday-embed-font";
export const EMBED_LOCALE_HEADER = "x-diveday-embed-locale";

/** A host colour is `#rrggbb` or nothing — the same shape the brand column keeps. */
export function parseEmbedBrandParam(value: string | null): string | null {
  if (!value) return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

/**
 * A host font family is rendered into a `<style>`, so only the characters a
 * `font-family` list is made of pass: letters, digits, spaces, commas, hyphens
 * and straight quotes, at most 120 of them. Anything else is not a font.
 */
export function parseEmbedFontParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9 ,'"-]{1,120}$/.test(trimmed) ? trimmed : null;
}

/**
 * Set on the request (never trusted from the response side) by `src/proxy.ts`
 * when — and only when — the current request is a genuine embed request
 * (`isEmbedRoute`). The public shop layout reads it to suppress chrome, since a
 * layout (unlike a page) is never handed the URL, only its own `params`. On every proxied request the incoming copy of this
 * header is explicitly overwritten (set or deleted), so a client-supplied
 * value can never survive to reach a reader downstream. The proxy matcher's
 * static-asset escape hatch means "proxied" is not "all", so readers must stay
 * fail-closed about its absence and treat the value as advisory, never as
 * proof.
 */
export const EMBED_REQUEST_HEADER = "x-diveday-embed";

/**
 * The request's own pathname, stamped onto the request by `src/proxy.ts` for
 * the same reason `EMBED_REQUEST_HEADER` exists: a layout is never handed the
 * URL (no `searchParams`, no pathname — only its own `params`), and
 * `ShopLayout` has to tell a *public* shop route (schedule, courses — readable
 * by anyone, including staff of a different shop) apart from a staff one
 * before it decides whether a cross-tenant visit is a 404. Its second reader
 * is `src/app/s/[shopSlug]/not-found.tsx`, for the same reason one step
 * further on: Next hands a `not-found.tsx` no props whatsoever. Overwritten on
 * every *proxied* request, exactly like the embed header; because the proxy
 * matcher carries a static-asset escape hatch, `ShopLayout` additionally
 * binds the value to the slug it is rendering and fails closed on anything
 * else, so a value that somehow arrived unproxied still grants nothing.
 */
export const REQUEST_PATH_HEADER = "x-diveday-path";

/**
 * **Whose 404 this is.** Stamped by `src/proxy.ts` with a shop's slug when —
 * and only when — the request it refused named a shop that exists and a
 * resource under it that does not; empty on every other request, including a
 * refusal whose *shop* is the part that is missing.
 *
 * Issue #765's rule is that a diver who taps a link outliving its departure
 * lands somewhere that still looks like the shop they were trying to reach,
 * never on DiveDay's sales-page 404. That used to be a matter of which
 * `not-found.tsx` Next picked; since the namespace started refusing above the
 * streaming boundary (ADR 20260912-the-public-namespace-refuses-at-the-edge)
 * the refusal is a rewrite to `/_not-found`, which renders under the *root*
 * layout where the shop's segment layout never runs. So the frame has to be
 * composed there, and this header is how that file — handed no props and no
 * URL — learns which shop to compose it for.
 *
 * Why the slug and not the path: `REQUEST_PATH_HEADER` beside it already
 * carries the original URL, and `shopSlugFromPublicPath` would read a slug out
 * of it — but that slug is only ever *claimed*. Offering a schedule that is
 * itself a 404 is a worse landing than DiveDay's own, so the one bit the
 * reader cannot work out for itself is the one this header carries: the proxy
 * looked, and the shop is really there.
 *
 * Overwritten on every proxied request exactly like the two headers above, and
 * the reader still holds the value to the slug charset rather than trusting
 * it, because the proxy matcher's static-asset escape hatch means "proxied" is
 * not "all".
 */
export const REFUSED_SHOP_SLUG_HEADER = "x-diveday-refused-shop";
