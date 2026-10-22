import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { fillFacts, languageName, VOICE_RULES } from "./facts";

/**
 * **copywriter**: "Draft it" on a trip description or a course summary, in
 * DiveDay's voice, with the Spanish version alongside for the shop-translate
 * box. The facts (depth, minimum card, price, dives) are the record's: the
 * model names them by placeholder and the record's own formatted value goes in.
 * A draft that writes a number itself is refused, and the owner edits the box
 * before anything is saved.
 */

export const DESCRIPTION_DRAFT_FEATURE = "copywriter";

export const DESCRIPTION_KINDS = ["trip", "course"] as const;
export type DescriptionKind = (typeof DESCRIPTION_KINDS)[number];

/** Each kind's box, so a draft fits where it lands. */
export const DESCRIPTION_LIMITS: Record<DescriptionKind, number> = {
  trip: 500,
  course: 200,
};

export const DESCRIPTION_DRAFT_SYSTEM = [
  "You draft the short public description a dive shop shows divers for one trip or course.",
  "Write two or three sentences a diver reads before booking: what it is and who it suits.",
  "Every fact comes from the facts given. Name a fact by its placeholder, such as {maxDepth} or {price}; never write a digit yourself and never state a fact you were not given.",
  "Answer primary in the shop's language. Answer spanish as the same text in Latin American Spanish with the same placeholders, or null when the shop's language is Spanish.",
  VOICE_RULES,
].join("\n");

const Draft = z.object({ primary: z.string(), spanish: z.string().nullable() });

export type DescriptionFacts = {
  readonly kind: DescriptionKind;
  /** Words about the record, never numbers (`title`, `sites`, `minCert`). */
  readonly words: Readonly<Record<string, string>>;
  /** Placeholder values (`maxDepth`: "30 m"), formatted for the shop. */
  readonly facts: Readonly<Record<string, string>>;
  readonly locale: string;
};

export function descriptionDraftCall(input: DescriptionFacts): StructuredCall<typeof Draft> {
  return {
    model: "draft",
    system: DESCRIPTION_DRAFT_SYSTEM,
    context: undefined,
    content: JSON.stringify({
      kind: input.kind,
      shopLanguage: languageName(input.locale),
      about: input.words,
      placeholders: Object.keys(input.facts),
      maxCharacters: DESCRIPTION_LIMITS[input.kind],
    }),
    schema: Draft,
    maxTokens: 1_200,
  };
}

/** The filled drafts, or null when either one invented a fact or does not fit. */
export function descriptionDraft(
  value: z.infer<typeof Draft> | null,
  input: DescriptionFacts,
): { primary: string; spanish: string | null } | null {
  if (!value) return null;
  const limit = DESCRIPTION_LIMITS[input.kind];
  const primary = fillFacts(value.primary, input.facts);
  if (!primary || primary.length > limit) return null;
  const spanishWanted = !input.locale.toLowerCase().startsWith("es");
  const spanish = spanishWanted && value.spanish ? fillFacts(value.spanish, input.facts) : null;
  return { primary, spanish: spanish && spanish.length <= limit ? spanish : null };
}

export function descriptionDraftFixture(request: { messages: unknown }): unknown {
  const text = JSON.stringify(request.messages);
  const depth = text.includes("maxDepth") ? " to {maxDepth}" : "";
  return {
    primary: `Two relaxed dives${depth} with a crew who know the reef well.`,
    spanish: `Dos inmersiones tranquilas${depth} con una tripulación que conoce bien el arrecife.`,
  };
}
