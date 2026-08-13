/**
 * The faces a diver might meet at one site — the site's own field guide.
 *
 * These rows (`dive_site_creatures`) existed from the start and had no way in:
 * the seed wrote them and no staff surface could add, edit, or remove one, so a
 * real shop's briefing had a field guide only if DiveDay had happened to write
 * it. This module is the shape the site form now posts, and the same shape a
 * DiveDay template carries into a shop's library on import.
 *
 * Everything here is the *shop's* copy once it lands — a name, a category
 * word, a sentence, and a tip, all rendered as typed. The DiveDay catalog
 * (`src/db/marine-life-catalog.ts`) is only where a shop starts: picking a
 * species copies its words onto the site, and the shop edits them from there.
 * That is why `kind` is free text here and a code in `dive-site-landmarks.ts` —
 * "juvenile reef fish" is a category a shop invents, not one DiveDay enumerates.
 */

import { safeJson } from "./safe-json";

export type DiveSiteCreature = {
  /** The catalog entry this started from, or empty for a species typed by hand. */
  slug: string;
  name: string;
  kind: string;
  description: string;
  /** How to actually see it — the lines the briefing's "slow down" aside collects. */
  preparationTip: string;
  /** A bundled catalog image, or a photo the shop uploaded. Empty renders an initial. */
  imageUrl: string;
};

/**
 * The most species one site's guide may hold. Eight fills two rows of the
 * briefing's four-up grid; past that a reader is scrolling a catalog rather
 * than learning a handful of faces before a dive.
 */
export const MAX_SITE_CREATURES = 8;

const MAX_NAME = 80;
const MAX_KIND = 40;
const MAX_DESCRIPTION = 240;
const MAX_TIP = 240;
const MAX_IMAGE_URL = 512;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Species from anywhere untrusted — the form's hidden JSON input, a template's
 * briefing blob, a row written by an older build — reduced to what every
 * renderer can assume. Never throws; an entry with no name is dropped, and an
 * empty guide is a first-class answer (a site the shop has nothing to say about
 * yet is the ordinary case, and the briefing reads fine in that state).
 *
 * `imageUrl` is kept only when it is a same-origin path. A briefing must never
 * make a live request to a host a staffer chose (CR-020) — the site gallery
 * solved that by uploading rather than pasting, and this is the same rule for
 * the same reason.
 */
export function parseDiveSiteCreatures(raw: unknown): DiveSiteCreature[] {
  const list = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(list)) return [];
  const creatures: DiveSiteCreature[] = [];
  for (const entry of list) {
    if (creatures.length >= MAX_SITE_CREATURES) break;
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = text(record.name, MAX_NAME);
    if (!name) continue;
    const imageUrl = text(record.imageUrl, MAX_IMAGE_URL);
    creatures.push({
      slug: text(record.slug, MAX_NAME),
      name,
      kind: text(record.kind, MAX_KIND),
      description: text(record.description, MAX_DESCRIPTION),
      preparationTip: text(record.preparationTip, MAX_TIP),
      imageUrl: imageUrl.startsWith("/") ? imageUrl : "",
    });
  }
  return creatures;
}
