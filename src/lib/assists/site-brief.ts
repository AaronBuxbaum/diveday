import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import {
  claimsAnAudience,
  fillFacts,
  hasNumberWord,
  promptLanguage,
  softensTheDive,
  VOICE_RULES,
} from "./facts";

/**
 * **site-brief**: from a dive site's structured fields (depth, difficulty,
 * location, landmarks, the field guide) Claude drafts the briefing's prose and
 * its marine-life paragraph, for staff to edit before saving. The numbers come
 * from the fields: the model names them by placeholder, the field's own value
 * (in the shop's unit) goes in, and a draft that writes a number, in digits or
 * words, is refused.
 *
 * A briefing is read before a diver books a drift or a deep site, so it keeps
 * every current, entry and hazard as strong as the shop gave it, never says
 * who the dive suits (the page shows the site's requirement), and never calls
 * the dive easy or gentle unless the site's difficulty is `beginner`. A draft
 * that does is refused.
 */

export const SITE_BRIEF_FEATURE = "site_brief";
export const SITE_BRIEF_LIMITS = { description: 1_200, marineLifeDescription: 1_200 } as const;

export const SITE_BRIEF_SYSTEM = [
  "You draft a dive site briefing for a dive shop: a short description of the dive, and a short paragraph about the marine life.",
  "Use only the facts given. Name every number by its placeholder, such as {maxDepth}; never write a number in digits or in words, and never add a hazard, a current or a creature you were not given.",
  "description: two to four sentences on what the dive is like: the entry, the route and what you see. Never say who the dive suits or is for, never name a certification, a level or an amount of experience, and never call a dive easy, gentle or for beginners unless the difficulty given says so: the page shows the site's requirement itself.",
  "Keep every current, entry and hazard you were given, as strongly as it was given: never soften one. Where the shop's words hold a number you have no placeholder for, say it is in the plan rather than writing the number in words.",
  "The requirement is given only so you do not contradict it. Never restate it.",
  "marineLife: one to three sentences about the creatures listed, or null when none are listed.",
  VOICE_RULES,
].join("\n");

const Brief = z.object({ description: z.string(), marineLife: z.string().nullable() });

export type SiteBriefInput = {
  readonly locale: string;
  /** Words from the form: name, location, difficulty (`beginner` | `intermediate` | `advanced`), current, plan, creature names. */
  readonly words: Readonly<Record<string, string | readonly string[]>>;
  /** The site's requirement, labelled (`minCert`, `specialties`, `nitrox`): context the draft must not restate. */
  readonly requirement?: Readonly<Record<string, string>>;
  /** Placeholder values formatted in the shop's unit (`maxDepth`: "18 m"). */
  readonly facts: Readonly<Record<string, string>>;
};

export function siteBriefCall(input: SiteBriefInput): StructuredCall<typeof Brief> {
  return {
    model: "draft",
    system: SITE_BRIEF_SYSTEM,
    content: JSON.stringify({
      language: promptLanguage(input.locale),
      site: input.words,
      requirement: input.requirement ?? {},
      placeholders: Object.keys(input.facts),
    }),
    schema: Brief,
    maxTokens: 1_500,
  };
}

/** The two boxes' drafts, each filled from the fields, or null when the description fails. */
export function siteBrief(
  value: z.infer<typeof Brief> | null,
  input: SiteBriefInput,
): { description: string; marineLifeDescription: string | null } | null {
  if (!value) return null;
  const given = Object.values(input.words).flatMap((word) =>
    typeof word === "string" ? [word] : [...word],
  );
  const easyAllowed = input.words.difficulty === "beginner";
  const fill = (text: string) =>
    hasNumberWord(text) ||
    claimsAnAudience(text, given) ||
    (!easyAllowed && softensTheDive(text, given))
      ? null
      : fillFacts(text, input.facts);
  const description = fill(value.description);
  if (!description || description.length > SITE_BRIEF_LIMITS.description) return null;
  const marine = value.marineLife ? fill(value.marineLife) : null;
  return {
    description,
    marineLifeDescription:
      marine && marine.length <= SITE_BRIEF_LIMITS.marineLifeDescription ? marine : null,
  };
}

export function siteBriefFixture(request: { messages: unknown }): unknown {
  const depth = JSON.stringify(request.messages).includes("maxDepth")
    ? " that drops to {maxDepth}"
    : "";
  return {
    description: `A reef${depth} along the sand edge, with the mooring at the start of the route.`,
    marineLife: "Look under the ledges for lobster and the odd nurse shark.",
  };
}
