import type { DiveSpecialty } from "@/db/schema";
import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";

/**
 * **What the dive-site library can be narrowed by**, all of it in the URL so a
 * filtered list survives a reload, a new tab and the back button.
 *
 * - `difficulty`: DiveDay's three levels, or `unrated` for the sites nobody has rated.
 * - `need`: the kind of dive a site asks for: a specialty, or nitrox.
 * - `area`: the rectangle the map shows, so the list can follow the map.
 *
 * Anything unreadable reads as "no filter" rather than an error, like `?page=`.
 */
export const SITE_DIFFICULTY_FILTERS = [
  "beginner",
  "intermediate",
  "advanced",
  "unrated",
] as const satisfies readonly (DiveSiteDifficulty | "unrated")[];
export type SiteDifficultyFilter = (typeof SITE_DIFFICULTY_FILTERS)[number];

export const SITE_NEED_FILTERS = [
  "nitrox",
  "deep",
  "wreck",
  "night",
  "drysuit",
  "cavern",
] as const satisfies readonly ("nitrox" | DiveSpecialty)[];
export type SiteNeedFilter = (typeof SITE_NEED_FILTERS)[number];

export type MapArea = { south: number; west: number; north: number; east: number };

export type SiteListFilters = {
  difficulty?: SiteDifficultyFilter;
  need?: SiteNeedFilter;
  area?: MapArea;
};

export function parseMapArea(raw: string | undefined): MapArea | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((part) => Number.parseFloat(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [south, west, north, east] = parts as [number, number, number, number];
  if (south >= north || west >= east) return undefined;
  return {
    south: Math.max(-90, south),
    west: Math.max(-180, west),
    north: Math.min(90, north),
    east: Math.min(180, east),
  };
}

export function formatMapArea(area: MapArea): string {
  const round = (value: number) => value.toFixed(4);
  return [area.south, area.west, area.north, area.east].map(round).join(",");
}

export function parseSiteFilters(search: {
  difficulty?: string;
  need?: string;
  area?: string;
}): SiteListFilters {
  return {
    difficulty: SITE_DIFFICULTY_FILTERS.find((word) => word === search.difficulty),
    need: SITE_NEED_FILTERS.find((word) => word === search.need),
    area: parseMapArea(search.area),
  };
}

/** The library's URL for a set of choices; empty choices stay out of it. */
export function siteListHref(
  base: string,
  choices: { q?: string; page?: number } & SiteListFilters,
): string {
  const params = new URLSearchParams();
  if (choices.q) params.set("q", choices.q);
  if (choices.difficulty) params.set("difficulty", choices.difficulty);
  if (choices.need) params.set("need", choices.need);
  if (choices.area) params.set("area", formatMapArea(choices.area));
  if (choices.page && choices.page > 1) params.set("page", String(choices.page));
  const encoded = params.toString();
  return encoded ? `${base}?${encoded}` : base;
}
