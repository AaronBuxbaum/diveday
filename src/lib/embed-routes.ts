/**
 * The two diver surfaces a shop is meant to frame on its own website: the
 * public schedule (`/s/<shopSlug>`) and one departure's booking page
 * (`/s/<shopSlug>/trips/<tripId>`). Deliberately not every public route —
 * a course page is public but is not a supported widget, and everything else,
 * including this same shop's staff and sign-in pages, keeps the site's default
 * deny (src/proxy.ts) so a third-party page can never frame them for a
 * clickjacking attempt (ADR 20260726-schedule-embed).
 */
const EMBEDDABLE_SCHEDULE = /^\/s\/[a-z0-9-]+\/?$/;
const EMBEDDABLE_TRIP_PAGE = /^\/s\/[a-z0-9-]+\/trips\/[^/]+\/?$/;

export function isEmbeddableShopRoute(pathname: string): boolean {
  return EMBEDDABLE_SCHEDULE.test(pathname) || EMBEDDABLE_TRIP_PAGE.test(pathname);
}

/**
 * Set on the request (never trusted from the response side) by `src/proxy.ts`
 * when — and only when — the current request is a genuine embed request
 * (`isEmbeddableShopRoute` route + `?embed=1`). The public shop layout reads it
 * to suppress chrome, since a layout (unlike a page) is never handed
 * `searchParams` directly. On every proxied request the incoming copy of this
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
