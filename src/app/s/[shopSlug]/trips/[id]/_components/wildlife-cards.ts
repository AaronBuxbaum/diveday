import {
  isMarineLifeSlug,
  MARINE_LIFE_BY_SLUG,
  type MarineLifeKind,
} from "@/db/marine-life-catalog";
import { type MarineLifeCard, marineLifeCard } from "@/i18n/marine-life-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { SiteSightings } from "@/lib/sightings";
import type { DiveBriefing } from "./types";

// Editorial preference, not a claim about rarity. Categories absent here have equal priority.
const DESIRABILITY: Partial<Record<MarineLifeKind, number>> = {
  marineMammal: 5,
  shark: 4,
  ray: 4,
  turtle: 4,
  camouflage: 3,
  predator: 2,
};

export function wildlifeCards(
  briefings: readonly DiveBriefing[],
  sightings: ReadonlyMap<string, SiteSightings> | undefined,
  t: DiverTranslator,
): { card: MarineLifeCard; seen: boolean }[] {
  const selected = new Map<string, { card: MarineLifeCard; seen: boolean }>();
  const extras = new Map<
    string,
    { card: MarineLifeCard; seen: boolean; score: number; date: number }
  >();
  for (const { diveSite, creatures } of briefings) {
    const tallies = diveSite ? sightings?.get(diveSite.id) : undefined;
    const rows = tallies?.allSpecies ?? tallies?.species ?? [];
    for (const card of creatures) {
      const seen = rows.some((row) => !row.customName && row.speciesSlug === card.slug);
      const existing = selected.get(card.slug);
      if (existing) existing.seen ||= seen;
      else selected.set(card.slug, { card, seen });
    }
    for (const row of rows) {
      if (row.customName || !isMarineLifeSlug(row.speciesSlug)) continue;
      const card = marineLifeCard(row.speciesSlug, t);
      const score = DESIRABILITY[MARINE_LIFE_BY_SLUG.get(row.speciesSlug)?.kind ?? "reefFish"] ?? 0;
      const date = new Date(row.lastSeenAt).getTime();
      const existing = extras.get(row.speciesSlug);
      if (!existing || date > existing.date)
        extras.set(row.speciesSlug, { card, seen: true, score, date });
    }
  }
  const additional = [...extras.values()]
    .filter(({ card }) => !selected.has(card.slug))
    .sort((a, b) => b.score - a.score || b.date - a.date || a.card.slug.localeCompare(b.card.slug))
    .slice(0, 3);
  return [...selected.values(), ...additional];
}
