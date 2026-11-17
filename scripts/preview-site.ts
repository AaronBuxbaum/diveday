/**
 * What a prospect's public home page says about the shop: its name, its main
 * colour and its town (ADR 20261116-demo-previews). Pure string work over one
 * page of HTML, so it is tested without a network, and everything it returns
 * is a guess the founder reads before a preview is built. Flags given to
 * `pnpm preview build` win over anything found here.
 */

export type SiteFacts = {
  name: string | null;
  brandColor: string | null;
  tagline: string | null;
  locality: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#38;": "&",
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&#8217;": "’",
  "&rsquo;": "’",
  "&ndash;": "–",
  "&#8211;": "–",
  "&mdash;": "—",
  "&#8212;": "—",
  "&nbsp;": " ",
};

function clean(value: string | undefined | null, max: number): string | null {
  if (!value) return null;
  const text = value
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length <= max ? text : null;
}

/** The `content` of the first `<meta>` whose `name` or `property` is `key`. */
function meta(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const named = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (named?.toLowerCase() !== key) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    return content?.[1] ?? content?.[2];
  }
  return undefined;
}

function normalizeHex(value: string | undefined): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

/** Near-white, near-black and gray are a page's paper and ink, never its brand. */
function isNeutral(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(r, g, b) - Math.min(r, g, b) < 40;
}

/** The declared theme colour, else the colour the page's own styles use most. */
function brandColor(html: string): string | null {
  const declared = normalizeHex(meta(html, "theme-color"));
  if (declared && !isNeutral(declared)) return declared;
  const counts = new Map<string, number>();
  const styled = [
    ...(html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []),
    ...(html.match(/\bstyle\s*=\s*"[^"]*"/gi) ?? []),
  ].join(" ");
  for (const found of styled.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []) {
    const hex = normalizeHex(found);
    if (hex && !isNeutral(hex)) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [hex, count] of counts) {
    if (!best || count > (counts.get(best) ?? 0)) best = hex;
  }
  return best;
}

type Json = Record<string, unknown>;

/** Every object in the page's JSON-LD blocks, `@graph` members included. */
function linkedData(html: string): Json[] {
  const found: Json[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") {
      found.push(node as Json);
      visit((node as Json)["@graph"]);
    }
  };
  for (const block of html.match(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
  ) ?? []) {
    try {
      visit(JSON.parse(block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "")));
    } catch {
      // A page's malformed structured data is its own; the rest is still read.
    }
  }
  return found;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function coordinate(value: unknown, limit: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** A page title is usually "Shop | Town" or "Home - Shop": keep the longest part that is not a page name. */
function nameFromTitle(title: string | null): string | null {
  if (!title) return null;
  const parts = title
    .split(/\s[|–—-]\s|\s:\s/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(home|welcome|homepage)$/i.test(part));
  return parts[0] ?? null;
}

export function readShopSite(html: string): SiteFacts {
  const data = linkedData(html);
  const business = data.find((node) => node.address && typeof node.address === "object");
  const address = (business?.address ?? {}) as Json;
  const geo = (data.find((node) => node.geo && typeof node.geo === "object")?.geo ?? {}) as Json;
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
  const latitude = coordinate(geo.latitude, 90);
  const longitude = coordinate(geo.longitude, 180);

  return {
    name:
      clean(meta(html, "og:site_name"), 80) ??
      clean(text(business?.name), 80) ??
      clean(meta(html, "application-name"), 80) ??
      clean(nameFromTitle(title), 80),
    brandColor: brandColor(html),
    tagline: clean(meta(html, "description") ?? meta(html, "og:description"), 140),
    locality: clean(text(address.addressLocality), 80),
    region: clean(text(address.addressRegion), 40),
    latitude: latitude !== null && longitude !== null ? latitude : null,
    longitude: latitude !== null && longitude !== null ? longitude : null,
  };
}
