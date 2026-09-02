import { EMBED_WIDGETS, type EmbedWidget } from "./embed-routes";
import { publicSchedulePath, publicTripPath } from "./public-routes";

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

export function isEmbedKind(value: unknown): value is EmbedKind {
  return typeof value === "string" && (EMBED_KINDS as readonly string[]).includes(value);
}

export type EmbedLook = "site" | "light";
export type EmbedOptions = {
  /** `site` reads the host page's colour and face; `light` is DiveDay's own. */
  look: EmbedLook;
  /** A diver locale to fix the widget to, or `auto` for the visitor's browser. */
  lang: string;
  /** A trip id (departure, lightbox) or a course slug (courses), when one is chosen. */
  show?: string | null;
};

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = { look: "site", lang: "auto", show: null };

/** The URL the loader frames for a framed kind — the same grammar in JS. */
export function embedFrameUrl(
  origin: string,
  shopSlug: string,
  kind: Extract<EmbedKind, "calendar" | EmbedWidget>,
  options: EmbedOptions = DEFAULT_EMBED_OPTIONS,
  host: { brand?: string | null; font?: string | null } = {},
): string {
  const url = new URL(
    kind === "calendar"
      ? publicSchedulePath(shopSlug)
      : `${publicSchedulePath(shopSlug)}/embed/${kind}`,
    origin,
  );
  if (kind === "calendar") url.searchParams.set("embed", "1");
  if (options.show && kind === "departure") url.searchParams.set("show", options.show);
  if (options.lang !== "auto") url.searchParams.set("lang", options.lang);
  if (options.look === "site") {
    if (host.brand) url.searchParams.set("brand", host.brand);
    if (host.font) url.searchParams.set("font", host.font);
  }
  return url.toString();
}

/** Where a button, a lightbox or a QR code sends a diver. */
export function embedTargetUrl(
  origin: string,
  shopSlug: string,
  options: EmbedOptions = DEFAULT_EMBED_OPTIONS,
): string {
  const path = options.show ? publicTripPath(shopSlug, options.show) : publicSchedulePath(shopSlug);
  return new URL(path, origin).toString();
}

/** A hotel's or a resort's referral link — the storefront, attributed. */
export function partnerLinkUrl(origin: string, shopSlug: string, partner: string): string {
  const url = new URL(publicSchedulePath(shopSlug), origin);
  url.searchParams.set("utm_source", "partner");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set(
    "utm_campaign",
    partner
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );
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
  const show = options.show && kind === "departure" ? ` data-show="${attr(options.show)}"` : "";
  return `${loader}\n<div data-diveday="${kind}" ${common}${show}></div>`;
}
