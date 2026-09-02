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

/**
 * The widget views of the embed catalogue (Harbor — ADR
 * 20260901-diveday-reimagined, decision 2): `/s/<slug>/embed/grid`,
 * `/embed/departure`, `/embed/courses`. Each exists only to be framed, so it
 * is an embed request by path alone — no `?embed=1` to forget or to smuggle.
 * The calendar is the schedule page in its `?embed=1` mode, as before.
 */
export const EMBED_WIDGETS = ["grid", "departure", "courses"] as const;
export type EmbedWidget = (typeof EMBED_WIDGETS)[number];
const EMBEDDABLE_WIDGET = /^\/s\/[a-z0-9-]+\/embed\/(grid|departure|courses)\/?$/;

export function isEmbedWidgetRoute(pathname: string): boolean {
  return EMBEDDABLE_WIDGET.test(pathname);
}

export function isEmbedWidget(value: unknown): value is EmbedWidget {
  return typeof value === "string" && (EMBED_WIDGETS as readonly string[]).includes(value);
}

export function isEmbeddableShopRoute(pathname: string): boolean {
  return (
    EMBEDDABLE_SCHEDULE.test(pathname) ||
    EMBEDDABLE_TRIP_PAGE.test(pathname) ||
    EMBEDDABLE_WIDGET.test(pathname)
  );
}

/**
 * What the loader on a shop's own site tells the frame about the page it sits
 * in ("inherit the host page", the look every widget defaults to): the host's
 * link colour, its body face, and — when the shop fixed one — the language.
 * Each rides a query parameter the proxy validates and forwards as a header,
 * so the layout can read it without a `searchParams` prop it does not have.
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
