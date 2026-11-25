/**
 * What a prospect's public site says about the shop: its name, its main
 * colour and its town from the home page, and the times its boats leave and
 * the boats' names from the home page and the few schedule or charter pages
 * it links to (ADRs 20261116-demo-previews, 20261125-previews-wear-the-prospects-day). Pure string work over HTML, so it
 * is tested without a network, and everything it returns is a guess the
 * founder reads before a preview is built. Flags given to
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
  /** When the boats leave, as 24-hour "HH:MM" shop-local times, earliest first. */
  departureTimes: string[];
  /** The boats' own names, most mentioned first. */
  boatNames: string[];
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

/** A page's readable words, with each tag's edge kept as a cell break. */
function visibleText(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " | ")
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ");
  return text.replace(/(?:\s*\|\s*)+/g, " | ");
}

/**
 * A boat's name as a site writes it beside the words that give it away:
 * "aboard the Little Deeper", "Little Deeper departs from", "the boats Steel
 * Slinger and Narcosis", "The Aqua View is a custom catamaran", "M/V Spree".
 * One to three capitalised words; a word that only starts a sentence is not
 * a boat.
 */
const NAME = String.raw`((?:[A-Z][\w'’]*|[IVX]+|\d+)(?: (?:[A-Z][\w'’]*|[IVX]+|\d+)){0,2})`;
const BOAT_PATTERNS = [
  new RegExp(String.raw`\bM\/?V\.? (?:\| )?${NAME}`, "g"),
  new RegExp(String.raw`\baboard (?:the )?(?:\| )?${NAME}`, "g"),
  new RegExp(
    String.raw`\b(?:vessels?|boats?) (?:the )?(?:\| )?${NAME}(?: \|)? (?:&|and) (?:the )?(?:\| )?${NAME}`,
    "g",
  ),
  new RegExp(String.raw`\b(?:vessel|boat) the ${NAME}`, "g"),
  new RegExp(String.raw`${NAME} (?:\| )?(?:departs|leaves|sails)\b`, "g"),
  new RegExp(
    String.raw`\b[Tt]he (?:\| )?${NAME} (?:\| )?is an? (?:[\w'’-]+ ){0,5}(?:boat|vessel|catamaran|Newton|Delta|dive boat)\b`,
    "g",
  ),
];

/** Words that start a name-shaped run without being one. */
const NOT_A_BOAT = new Set(
  "A An And Our The This That These Their We You Your Dive Diving Scuba Boat Boats Charter Charters Snorkel Snorkeling Trip Trips Book Booking Key Florida Reef Reefs Morning Afternoon Night Daily Each Every All Two Three Our Check Departure Departs Join Choose Riviera Beach Marina City Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split(
    " ",
  ),
);

function boatNames(text: string): string[] {
  const counts = new Map<string, number>();
  for (const pattern of BOAT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      for (const raw of match.slice(1)) {
        const name = raw?.trim();
        if (!name || name.length < 3 || name.length > 40) continue;
        if (NOT_A_BOAT.has(name.split(" ")[0])) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 4);
}

/** "8:30 AM", "1 p.m.", "8:30a": a clock time a site writes. Bare "1 a" is not one. */
const CLOCK = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?(m\.?)?(?![a-z])/gi;
/** The nearest of these before a time says what the time is. */
const LEAVES = /\b(depart\w*|leav\w*|sail\w*)\b/gi;
const NOT_LEAVING =
  /\b(check[- ]?in\w*|arriv\w*|return\w*|hours?|open\w*|closed?|sunset|sunrise|gear issue|pool|lunch|back)\b/gi;

function lastIndex(pattern: RegExp, text: string): number {
  let at = -1;
  for (const match of text.matchAll(pattern)) at = match.index;
  return at;
}

/**
 * When the boats leave: each clock time whose nearest cue says it is a
 * departure ("Departure from Dock 9:00 AM", "an 8:30 AM departure", a boat's
 * own name), never a check-in, a return or the store's hours. A time listed
 * straight after a departure time ("8:00 a.m. or 1:00 p.m.") is one too.
 * Times within 45 minutes of each other are one slot, the one said most.
 */
export function departureTimes(text: string, boats: readonly string[] = []): string[] {
  const counts = new Map<number, number>();
  let previousEnd = -Infinity;
  for (const match of text.matchAll(CLOCK)) {
    if (!match[2] && !match[4]) continue;
    const end = match.index + match[0].length;
    const before = text.slice(Math.max(0, match.index - 60), match.index);
    const after = text.slice(end, end + 14);
    const cue = Math.max(
      lastIndex(LEAVES, before),
      ...boats.map((boat) => before.lastIndexOf(boat)),
    );
    const against = lastIndex(NOT_LEAVING, before);
    const listed =
      match.index - previousEnd <= 6 &&
      /^(?:\s*(?:,|or|and|&|\|))+\s*$/i.test(text.slice(previousEnd, match.index));
    const said = /^\s*(?:\|\s*)?(depart|leav|sail)/i.test(after);
    const refused = /^\s*(?:\|\s*)?(check|arriv|return|-|–|to\b)/i.test(after);
    const leaves = said || ((listed || cue > against) && !refused);
    previousEnd = leaves ? end : -Infinity;
    if (!leaves) continue;
    const hour = (Number(match[1]) % 12) + (match[3].toLowerCase() === "p" ? 12 : 0);
    const minute = hour * 60 + Number(match[2] ?? 0);
    if (minute < 5 * 60 || minute > 21 * 60) continue;
    counts.set(minute, (counts.get(minute) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const kept: number[] = [];
  for (const [minute] of ranked) {
    if (kept.length < 4 && kept.every((other) => Math.abs(other - minute) >= 45)) kept.push(minute);
  }
  return kept
    .sort((a, b) => a - b)
    .map(
      (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
    );
}

/** Path words of a page that lists sailings; "trip" alone is the travel page. */
const SCHEDULE_PATH = /schedul|charter|depart(?!ment)|boats?\b|dive-boat|rates/i;

/**
 * The same site's pages most likely to say when the boats leave, schedule
 * pages first, at most `limit`. Anything on another host is not the shop's.
 */
export function schedulePageLinks(html: string, pageUrl: string, limit = 4): string[] {
  const base = new URL(pageUrl);
  const found = new Map<string, number>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>/gi)) {
    let url: URL;
    try {
      url = new URL(match[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (url.host.replace(/^www\./, "") !== base.host.replace(/^www\./, "")) continue;
    if (!/^https?:$/.test(url.protocol)) continue;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || !SCHEDULE_PATH.test(path) || /\.(?:pdf|jpe?g|png|webp|gif)$/i.test(path))
      continue;
    const key = `${url.origin}${path}`;
    if (found.has(key)) continue;
    const rank = /schedul/i.test(path) ? 0 : /depart|charter/i.test(path) ? 1 : 2;
    found.set(key, rank * 1000 + path.length);
  }
  return [...found]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([url]) => url);
}

/**
 * The facts of a shop: the home page's name, colour, line and town, and the
 * departure times and boat names said anywhere across the home page and the
 * schedule pages read with it.
 */
export function readShopSite(html: string, morePages: readonly string[] = []): SiteFacts {
  const data = linkedData(html);
  const business = data.find((node) => node.address && typeof node.address === "object");
  const address = (business?.address ?? {}) as Json;
  const geo = (data.find((node) => node.geo && typeof node.geo === "object")?.geo ?? {}) as Json;
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
  const words = [html, ...morePages].map(visibleText).join(" | ");
  const boats = boatNames(words);
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
    departureTimes: departureTimes(words, boats),
    boatNames: boats,
  };
}
