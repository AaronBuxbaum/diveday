import { EMBED_WIDGETS, type EmbedWidget } from "./embed-routes";
import { publicSchedulePath, publicTripPath } from "./public-routes";
import { partnerReferralSlug } from "./referrals";

/**
 * The embed catalogue's grammar (Harbor — ADR 20260901-diveday-reimagined,
 * decision 2): what a shop pastes, and what the loader on its site turns that
 * into. Eight things a shop can put on its own website, chosen in Settings →
 * Website embed:
 *
 * - **button** — a link to the storefront, in the shop's colour;
 * - **lightbox** — the same link, opened in a sheet over the shop's site;
 * - **calendar** — the schedule in its compact mode (`?embed=1`);
 * - **grid** — trips and courses as cards;
 * - **departure** — one departure as a card, for a blog post;
 * - **courses** — the course list;
 * - **qr** — a QR code for the counter and the boat, pointing at the storefront;
 * - **partner** — a referral link a hotel or resort can hand out.
 *
 * **The data attributes are a contract.** A snippet a shop pasted last season
 * has to keep working, so `public/embed.js` reads exactly these names and
 * `embed-snippets.test.ts` pins them; a new option is a new attribute, never a
 * renamed one.
 */
export const EMBED_KINDS = [
  "button",
  "lightbox",
  "calendar",
  ...EMBED_WIDGETS,
  "qr",
  "partner",
] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

/**
 * The host platforms the generator writes instructions for. One list, one
 * code: WordPress, Squarespace and Wix get their own *words*, never their own
 * markup (ADR 20260901-diveday-reimagined, decision 2). It lives here rather
 * than beside the generator because a server page reads it too, and a plain
 * array exported from a `"use client"` module reaches the server as a client
 * reference rather than an array — `.map` on it is a production-only crash.
 */
export const PLATFORMS = ["html", "wordpress", "squarespace", "wix"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isEmbedKind(value: unknown): value is EmbedKind {
  return typeof value === "string" && (EMBED_KINDS as readonly string[]).includes(value);
}

/**
 * The framed kinds that `show` means something to: one departure, or one
 * course out of the catalogue (issue #1284). `grid` and `calendar` are the
 * whole board by definition, so a `show` on either is silently nothing rather
 * than a narrowing nobody asked for.
 *
 * **Adding a kind here is additive by construction**: the attribute is
 * `data-show` in every case, which is the name `public/embed.js` has always
 * read and `embed-snippets.test.ts` pins. A snippet a shop pasted last season
 * carries no `data-show` at all and keeps meaning what it meant.
 */
const SHOWS_ONE: ReadonlySet<EmbedKind> = new Set(["departure", "courses"]);

/**
 * The list kinds — the ones a shop's own named set can narrow (issue #1284).
 * `grid` and `courses`: both render many things, and a set is a shorter many.
 * `departure` and `calendar` take none — a card points at one departure, and a
 * calendar is the whole month by definition.
 *
 * Its own attribute, `data-set`, beside the untouched `data-show`. A snippet a
 * shop pasted last season carries neither and keeps meaning what it meant.
 */
const SHOWS_SET: ReadonlySet<EmbedKind> = new Set(["grid", "courses"]);

export type EmbedLook = "site" | "light";
export type EmbedOptions = {
  /** `site` reads the host page's colour and face; `light` is DiveDay's own. */
  look: EmbedLook;
  /** A diver locale to fix the widget to, or `auto` for the visitor's browser. */
  lang: string;
  /**
   * What the widget narrows to: a trip id for `departure` (and for the button,
   * lightbox and QR code, which link at one departure), or a **course slug**
   * for `courses`.
   *
   * The two are told apart by the kind, never by the value — a slug and a UUID
   * are both opaque strings here, and the widget that reads one looks it up in
   * its own namespace.
   */
  show?: string | null;
  /**
   * A named list's id, for `grid` and `courses` (issue #1284) — "our three
   * beginner boats", "the wreck week".
   *
   * Told apart from `show` by the **attribute**, never by the value: both are
   * opaque strings, and a set id and a trip id would be indistinguishable if
   * they shared one. That is also why this is a new field rather than a
   * widening of `show` — the loader on a shop's site reads names, and a name
   * that started meaning two things could not be read at all.
   */
  set?: string | null;
};

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = {
  look: "site",
  lang: "auto",
  show: null,
  set: null,
};

/** The URL the loader frames for a framed kind — the same grammar in JS. */
export function embedFrameUrl(
  origin: string,
  shopSlug: string,
  kind: Extract<EmbedKind, "calendar" | EmbedWidget>,
  options: EmbedOptions = DEFAULT_EMBED_OPTIONS,
  host: { brand?: string | null; font?: string | null; credit?: boolean } = {},
): string {
  const url = new URL(
    kind === "calendar"
      ? publicSchedulePath(shopSlug)
      : `${publicSchedulePath(shopSlug)}/embed/${kind}`,
    origin,
  );
  if (kind === "calendar") url.searchParams.set("embed", "1");
  // `departure` and `courses` are the two widgets that can narrow to one
  // thing; `grid` and `calendar` are the whole board by definition.
  if (options.show && SHOWS_ONE.has(kind)) url.searchParams.set("show", options.show);
  // `grid` and `courses` are the two that can narrow to a named list.
  if (options.set && SHOWS_SET.has(kind)) url.searchParams.set("set", options.set);
  if (options.lang !== "auto") url.searchParams.set("lang", options.lang);
  if (options.look === "site") {
    if (host.brand) url.searchParams.set("brand", host.brand);
    if (host.font) url.searchParams.set("font", host.font);
  }
  // The loader always sets this: it draws the crawlable credit on the host
  // page, and the frame — told so — draws none, so a widget carries one credit
  // line rather than two. The generator's preview, which has no host page,
  // leaves it off and the frame keeps its own.
  if (host.credit) url.searchParams.set("credit", "host");
  return url.toString();
}

/**
 * Where a button, a lightbox or a QR code sends a diver.
 *
 * `set` is deliberately not read: those three point at **one object** — a
 * departure or the storefront — and a link cannot point at a list.
 */
export function embedTargetUrl(
  origin: string,
  shopSlug: string,
  options: EmbedOptions = DEFAULT_EMBED_OPTIONS,
): string {
  const path = options.show ? publicTripPath(shopSlug, options.show) : publicSchedulePath(shopSlug);
  return new URL(path, origin).toString();
}

/**
 * A hotel's or a resort's referral link — the storefront, attributed.
 *
 * The slug comes from `partnerReferralSlug` rather than a normalisation of its
 * own, because the same function runs again on the way *in* (src/proxy.ts, then
 * the booking action): a link this builder writes has to produce a value the
 * reader will accept unchanged, or a booking is credited to a slightly
 * different partner than the one whose link it came from. A partner name that
 * slugs to nothing yields a plain storefront link — attributed to nobody rather
 * than to the empty string.
 */
export function partnerLinkUrl(origin: string, shopSlug: string, partner: string): string {
  const url = new URL(publicSchedulePath(shopSlug), origin);
  const slug = partnerReferralSlug(partner);
  if (!slug) return url.toString();
  url.searchParams.set("utm_source", "partner");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", slug);
  return url.toString();
}

function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The one loader line every framed or scripted snippet starts with. */
export function embedLoaderTag(origin: string): string {
  return `<script async src="${origin}/embed.js"></script>`;
}

/**
 * The HTML a shop pastes. Every snippet works with the loader missing: a
 * button is a link, a lightbox is a link, a framed kind is a `<div>` the loader
 * fills — and the same snippet is what WordPress, Squarespace and Wix take,
 * pasted into whatever each calls its HTML block.
 */
export function embedSnippet(
  origin: string,
  shopSlug: string,
  kind: Exclude<EmbedKind, "qr" | "partner">,
  options: EmbedOptions,
  words: { button: string },
): string {
  const common = `data-shop="${attr(shopSlug)}" data-look="${options.look}" data-lang="${attr(options.lang)}"`;
  const loader = embedLoaderTag(origin);
  if (kind === "button" || kind === "lightbox") {
    return `${loader}\n<a href="${attr(embedTargetUrl(origin, shopSlug, options))}" data-diveday="${kind}" ${common}>${attr(words.button)}</a>`;
  }
  const show = options.show && SHOWS_ONE.has(kind) ? ` data-show="${attr(options.show)}"` : "";
  const set = options.set && SHOWS_SET.has(kind) ? ` data-set="${attr(options.set)}"` : "";
  return `${loader}\n<div data-diveday="${kind}" ${common}${show}${set}></div>`;
}
