import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";

/**
 * **sightings**: at the rail a crew member types, or dictates with the phone's
 * own keyboard microphone, "two turtles and an eagle ray", and Claude matches
 * it to the chips this reef already offers. The answer is proposed chips with
 * counts; nothing is logged until the crew confirms, and then each sighting is
 * the same tap a chip makes. Phone dictation turns the speech into text on the
 * device, so no audio leaves it.
 *
 * A species outside the offered chips cannot be answered: the schema's enum is
 * the chip list, and the mapping drops anything else again.
 */

export const SIGHTINGS_MATCH_FEATURE = "sightings_match";
export const SIGHTINGS_MAX_SAID = 300;
/** A rail tally, not a census: more than this of one thing is a typo. */
export const SIGHTINGS_MAX_COUNT = 20;

export const SIGHTINGS_MATCH_SYSTEM = [
  "A dive crew member says what they saw on a dive. Match it to the species offered, by slug, with how many of each they said (1 when they did not say).",
  "Only species from the offered list. Leave out anything that does not clearly match one; never pick the nearest guess.",
].join("\n");

export type SightingChip = { readonly slug: string; readonly name: string };
export type SightingMatch = { slug: string; count: number };

export function sightingsMatchCall<Slug extends string>(
  said: string,
  chips: readonly (SightingChip & { slug: Slug })[],
) {
  const slugs = chips.map((chip) => chip.slug) as [Slug, ...Slug[]];
  const schema = z.object({
    species: z.array(z.object({ slug: z.enum(slugs), count: z.number() })),
  });
  const call: StructuredCall<typeof schema> = {
    model: "quick",
    system: SIGHTINGS_MATCH_SYSTEM,
    content: JSON.stringify({ offered: chips.map(({ slug, name }) => ({ slug, name })), said }),
    schema,
    maxTokens: 400,
  };
  return call;
}

/** The chips to propose: offered ones only, each once, a whole count from 1 to 20. */
export function sightingMatches(
  value: { species: { slug: string; count: number }[] } | null,
  chips: readonly SightingChip[],
): SightingMatch[] {
  if (!value) return [];
  const offered = new Set(chips.map((chip) => chip.slug));
  const counts = new Map<string, number>();
  for (const { slug, count } of value.species) {
    if (!offered.has(slug)) continue;
    const whole = Number.isFinite(count) ? Math.round(count) : 1;
    counts.set(slug, Math.min(SIGHTINGS_MAX_COUNT, Math.max(1, (counts.get(slug) ?? 0) + whole)));
  }
  return [...counts].map(([slug, count]) => ({ slug, count }));
}

export function sightingsMatchFixture(request: { messages: unknown }): unknown {
  const content = String((request.messages as { content: string }[])[0]?.content ?? "{}");
  const { offered = [] } = JSON.parse(content) as { offered?: { slug: string }[] };
  return {
    species: offered.slice(0, 2).map((chip, index) => ({ slug: chip.slug, count: index + 1 })),
  };
}
