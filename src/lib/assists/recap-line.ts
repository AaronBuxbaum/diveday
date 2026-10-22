import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { fillFacts, hasNumberWord, promptLanguage, VOICE_RULES } from "./facts";

/**
 * **recap**: from the crew's logged sightings and the sites and conditions they
 * recorded, a plain two-sentence summary for the diver recap ("Two turtles and
 * an eagle ray at North Wall, 26°C and 20 m visibility"). It drafts into the
 * crew's recap note, which staff save (that save is the approval), or which a
 * shop that turned on auto-approve lets the recap send fill when the note is
 * still empty.
 *
 * No claims beyond the log. A site, a species and every count are named by
 * placeholder and filled from the rows, the sightings go grouped by the site
 * they were logged at and a creature put at another site is refused, a number
 * the model wrote (in digits or in en/es words) is refused, and a draft naming
 * any catalog species the crew did not log is refused whole. It never says how
 * the day went: the log does not hold that.
 * Free-text crew notes are not sent: they can carry a diver's health.
 */

export const RECAP_LINE_FEATURE = "recap_line";
export const RECAP_LINE_MAX = 400;

export const RECAP_LINE_SYSTEM = [
  "You write the two-sentence highlight a dive shop sends divers after a day on the boat.",
  "Use only what the log gives. Each site lists what was seen there: name the site as its placeholder ({site1}), a creature as its species placeholder and how many as its count placeholder, and keep each creature with the site it is listed under.",
  "Never write a number, in digits or in words, and never mention a creature, a site or a condition you were not given.",
  "Say what was seen and where. Never judge the day or the conditions (good, great, perfect, calm).",
  "Two sentences at most, in the language asked for.",
  VOICE_RULES,
].join("\n");

const Line = z.object({ text: z.string() });

export type RecapSighting = { slug: string; name: string; count: number };

export type RecapLog = {
  readonly locale: string;
  /** Each site the crew logged at, with what they logged there, the species named in the recap's language. */
  readonly sites: readonly { name: string; species: readonly RecapSighting[] }[];
  /** Conditions the crew recorded, formatted (`waterTemp`: "26°C"). */
  readonly conditions: Readonly<Record<string, string>>;
};

export function recapLineCall(log: RecapLog): StructuredCall<typeof Line> {
  return {
    model: "quick",
    system: RECAP_LINE_SYSTEM,
    content: JSON.stringify({
      language: promptLanguage(log.locale),
      sites: log.sites.map((site, index) => ({
        placeholder: `{site${index + 1}}`,
        name: site.name,
        sightings: site.species.map(({ slug, name }) => ({
          species: `{species:${index + 1}:${slug}}`,
          count: `{count:${index + 1}:${slug}}`,
          name,
        })),
      })),
      conditions: Object.keys(log.conditions).map((key) => `{${key}}`),
    }),
    schema: Line,
    maxTokens: 500,
  };
}

/**
 * True when each creature's placeholder sits with its own site: within a
 * sentence, the nearest site placeholder after it (else before it) must be the
 * site it was logged at. A sentence naming no site leaves it unplaced.
 */
function creaturesKeepTheirSite(text: string): boolean {
  for (const sentence of text.split(/[.;!?]/)) {
    const marks = [...sentence.matchAll(/\{(?:site(\d+)|(?:species|count):(\d+):[^}]*)\}/g)].map(
      (match) => ({ site: match[1], creature: match[2], at: match.index ?? 0 }),
    );
    const sites = marks.filter((mark) => mark.site);
    for (const mark of marks) {
      if (!mark.creature || sites.length === 0) continue;
      const after = sites.find((site) => site.at > mark.at);
      const before = [...sites].reverse().find((site) => site.at < mark.at);
      if ((after ?? before)?.site !== mark.creature) return false;
    }
  }
  return true;
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
  if (hasNumberWord(value.text) || !creaturesKeepTheirSite(value.text)) return null;
  const facts: Record<string, string> = { ...log.conditions };
  log.sites.forEach((site, index) => {
    facts[`site${index + 1}`] = site.name;
    for (const { slug, name, count } of site.species) {
      facts[`species:${index + 1}:${slug}`] = name.toLowerCase();
      facts[`count:${index + 1}:${slug}`] = String(count);
    }
  });
  const text = fillFacts(value.text, facts);
  if (!text || text.length > RECAP_LINE_MAX) return null;
  // Strip the logged names first, so "stingray" inside a logged "southern
  // stingray" is not read as a second, unlogged species.
  let rest = text.toLowerCase();
  const species = log.sites.flatMap((site) => site.species);
  const logged = new Set(species.map((entry) => entry.slug));
  const loggedNames = catalog
    .filter((entry) => logged.has(entry.slug))
    .flatMap((entry) => entry.names)
    .concat(species.map((entry) => entry.name))
    .map((name) => name.toLowerCase())
    .sort((a, b) => b.length - a.length);
  for (const name of loggedNames) rest = rest.split(name).join(" ");
  for (const entry of catalog) {
    if (logged.has(entry.slug)) continue;
    if (entry.names.some((name) => name.length > 2 && containsName(rest, name))) return null;
  }
  return text.replace(
    /(^|[.!?]\s+)(\p{Ll})/gu,
    (_whole, gap: string, letter: string) => `${gap}${letter.toUpperCase()}`,
  );
}

export function recapLineFixture(request: { messages: unknown }): unknown {
  const content = String((request.messages as { content: string }[])[0]?.content ?? "{}");
  const log = JSON.parse(content) as {
    sites?: { placeholder: string; sightings?: { species: string; count: string }[] }[];
  };
  const site = log.sites?.[0];
  const sighting = site?.sightings?.[0];
  // i18n-exempt: a canned model answer for the browser fleet (e2e-fixtures.ts), never DiveDay copy
  if (!site || !sighting) return { text: "Back on the boat with the whole crew." };
  // i18n-exempt: a canned model answer for the browser fleet (e2e-fixtures.ts), never DiveDay copy
  return { text: `${sighting.count} ${sighting.species} at ${site.placeholder} today.` };
}
