import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { fillFacts, languageName, VOICE_RULES } from "./facts";

/**
 * **site-brief**: from a dive site's structured fields (depth, difficulty,
 * location, landmarks, the field guide) Claude drafts the briefing's prose and
 * its marine-life paragraph, for staff to edit before saving. The numbers come
 * from the fields: the model names them by placeholder, the field's own value
 * (in the shop's unit) goes in, and a draft that writes a digit is refused.
 */

export const SITE_BRIEF_FEATURE = "site_brief";
export const SITE_BRIEF_LIMITS = { description: 1_200, marineLifeDescription: 1_200 } as const;

export const SITE_BRIEF_SYSTEM = [
  "You draft a dive site briefing for a dive shop: a short description of the dive, and a short paragraph about the marine life.",
  "Use only the facts given. Name every number by its placeholder, such as {maxDepth}; never write a digit and never add a hazard, a current or a creature you were not given.",
  "description: two to four sentences on what the dive is like and who it suits. marineLife: one to three sentences about the creatures listed, or null when none are listed.",
  VOICE_RULES,
].join("\n");

const Brief = z.object({ description: z.string(), marineLife: z.string().nullable() });

export type SiteBriefInput = {
  readonly locale: string;
  /** Words from the form: name, location, difficulty, entry, landmarks, creature names. */
  readonly words: Readonly<Record<string, string | readonly string[]>>;
  /** Placeholder values formatted in the shop's unit (`maxDepth`: "18 m"). */
  readonly facts: Readonly<Record<string, string>>;
};

export function siteBriefCall(input: SiteBriefInput): StructuredCall<typeof Brief> {
  return {
    model: "draft",
    system: SITE_BRIEF_SYSTEM,
    content: JSON.stringify({
      language: languageName(input.locale),
      site: input.words,
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
  const description = fillFacts(value.description, input.facts);
  if (!description || description.length > SITE_BRIEF_LIMITS.description) return null;
  const marine = value.marineLife ? fillFacts(value.marineLife, input.facts) : null;
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
    description: `A gentle reef${depth}, easy to navigate along the sand edge.`,
    marineLife: "Look under the ledges for lobster and the odd nurse shark.",
  };
}
