import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { fillFacts, languageName, VOICE_RULES } from "./facts";

/**
 * **recap**: from the crew's logged sightings and the sites and conditions they
 * recorded, a warm two-sentence summary for the diver recap ("Two turtles and
 * an eagle ray at North Wall, 26°C and 20 m visibility"). It drafts into the
 * crew's recap note, which staff save (that save is the approval), or which a
 * shop that turned on auto-approve lets the recap send fill when the note is
 * still empty.
 *
 * No claims beyond the log. A site, a species and every number are named by
 * placeholder and filled from the rows, a digit the model wrote is refused, and
 * a draft naming any catalog species the crew did not log is refused whole.
 * Free-text crew notes are not sent: they can carry a diver's health.
 */

export const RECAP_LINE_FEATURE = "recap_line";
export const RECAP_LINE_MAX = 400;

export const RECAP_LINE_SYSTEM = [
  "You write the two-sentence highlight a dive shop sends divers after a day on the boat.",
  "Use only what the log gives. Name each site as {site1}, {site2}, each species as {species:slug} and each condition by its placeholder. Never write a digit, and never mention a creature, a site or a condition you were not given.",
  "Warm and specific, two sentences at most, in the language asked for.",
  VOICE_RULES,
].join("\n");

const Line = z.object({ text: z.string() });

export type RecapLog = {
  readonly locale: string;
  readonly sites: readonly string[];
  /** What the crew logged, with the species' name in the recap's language. */
  readonly species: readonly { slug: string; name: string; count: number }[];
  /** Conditions the crew recorded, formatted (`waterTemp`: "26°C"). */
  readonly conditions: Readonly<Record<string, string>>;
};

export function recapLineCall(log: RecapLog): StructuredCall<typeof Line> {
  return {
    model: "quick",
    system: RECAP_LINE_SYSTEM,
    content: JSON.stringify({
      language: languageName(log.locale),
      sites: log.sites.map((name, index) => ({ placeholder: `{site${index + 1}}`, name })),
      sightings: log.species.map(({ slug, name, count }) => ({
        placeholder: `{species:${slug}}`,
        name,
        count,
      })),
      conditions: Object.keys(log.conditions).map((key) => `{${key}}`),
    }),
    schema: Line,
    maxTokens: 500,
  };
}

/** Lowercased for a whole-word search. */
function containsName(text: string, name: string): boolean {
  const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "u").test(text);
}

/**
 * The filled line, or null. `catalog` is every species DiveDay knows, with its
 * names in each bundle, so a creature the crew did not log is caught whatever
 * language the model slipped it in.
 */
export function recapLine(
  value: { text: string } | null,
  log: RecapLog,
  catalog: readonly { slug: string; names: readonly string[] }[],
): string | null {
  if (!value) return null;
  const facts: Record<string, string> = { ...log.conditions };
  log.sites.forEach((name, index) => {
    facts[`site${index + 1}`] = name;
  });
  for (const { slug, name } of log.species) facts[`species:${slug}`] = name.toLowerCase();
  const text = fillFacts(value.text, facts);
  if (!text || text.length > RECAP_LINE_MAX) return null;
  // Strip the logged names first, so "stingray" inside a logged "southern
  // stingray" is not read as a second, unlogged species.
  let rest = text.toLowerCase();
  const logged = new Set(log.species.map((entry) => entry.slug));
  const loggedNames = catalog
    .filter((entry) => logged.has(entry.slug))
    .flatMap((entry) => entry.names)
    .concat(log.species.map((entry) => entry.name))
    .map((name) => name.toLowerCase())
    .sort((a, b) => b.length - a.length);
  for (const name of loggedNames) rest = rest.split(name).join(" ");
  for (const entry of catalog) {
    if (logged.has(entry.slug)) continue;
    if (entry.names.some((name) => name.length > 2 && containsName(rest, name))) return null;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function recapLineFixture(request: { messages: unknown }): unknown {
  const content = String((request.messages as { content: string }[])[0]?.content ?? "{}");
  const log = JSON.parse(content) as {
    sightings?: { placeholder: string }[];
    sites?: { placeholder: string }[];
  };
  const creature = log.sightings?.[0]?.placeholder ?? "";
  const site = log.sites?.[0]?.placeholder ?? "";
  // i18n-exempt: a canned model answer for the browser fleet (e2e-fixtures.ts), never DiveDay copy
  if (!creature || !site) return { text: "A calm day on the water with the whole crew." };
  // i18n-exempt: a canned model answer for the browser fleet (e2e-fixtures.ts), never DiveDay copy
  return { text: `Plenty of ${creature} at ${site} today. A good day on the water.` };
}
