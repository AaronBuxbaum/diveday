import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { formatMoneyCents } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { fillFacts, languageName, VOICE_RULES } from "./facts";

/**
 * **monday**: three sentences above the Monday numbers (what changed, what is
 * coming, what needs a look), written from the digest's own sections.
 *
 * Every claim links to the number it came from. Each sentence names the one
 * section it is about, and may only quote that section's numbers, by
 * placeholder; the email links the sentence to that section's page. A
 * sentence that names a number of its own, or another section's, is dropped.
 */

export const MONDAY_READ_FEATURE = "monday_read";
export const MONDAY_READ_SENTENCES = 3;

export const MONDAY_READ_SYSTEM = [
  "You write the opening of a dive shop owner's Monday email: at most three sentences, one each about what changed last week, what is coming this week, and what needs a look.",
  "Each sentence is about exactly one section and names it. Write every number as a placeholder from that section's facts, such as {this_week.departures}; never write a digit yourself.",
  "Skip a sentence rather than stretch: a quiet week can take one sentence.",
  VOICE_RULES,
].join("\n");

export type MondaySection = {
  readonly kind: string;
  /** This section's facts, already formatted for the reader (`12`, `$1,240`, `Sat 25 Oct`). */
  readonly facts: Readonly<Record<string, string>>;
};

/**
 * A digest section's own numbers as facts, formatted the way the email prints
 * them: a `…Cents` field in the section's currency, every other number in the
 * reader's locale. Nested parts (the weakest boat, the owed list) and words
 * stay out: the read is about the counts, and a title is not a number.
 */
export function mondaySectionFacts(
  section: { readonly kind: string } & Readonly<Record<string, unknown>>,
  locale: string,
): MondaySection {
  const currency = typeof section.currency === "string" ? section.currency : "usd";
  const facts: Record<string, string> = {};
  for (const [key, value] of Object.entries(section)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    facts[key] = key.endsWith("Cents")
      ? formatMoneyCents(value, currency, locale)
      : cachedFormatter("num", Intl.NumberFormat, locale).format(value);
  }
  return { kind: section.kind, facts };
}

export function mondayReadCall<Kind extends string>(
  sections: readonly (MondaySection & { kind: Kind })[],
  locale: string,
) {
  const kinds = sections.map((section) => section.kind) as [Kind, ...Kind[]];
  const schema = z.object({
    sentences: z.array(z.object({ section: z.enum(kinds), text: z.string() })),
  });
  const call: StructuredCall<typeof schema> = {
    model: "draft",
    system: MONDAY_READ_SYSTEM,
    content: JSON.stringify({
      language: languageName(locale),
      sections: sections.map((section) => ({
        section: section.kind,
        facts: Object.fromEntries(
          Object.entries(section.facts).map(([key, value]) => [`${section.kind}.${key}`, value]),
        ),
      })),
    }),
    schema,
    maxTokens: 1_200,
  };
  return call;
}

export type MondaySentence = { section: string; text: string };

/** The sentences to print, each quoting only its own section, at most three. */
export function mondayRead(
  value: { sentences: { section: string; text: string }[] } | null,
  sections: readonly MondaySection[],
): MondaySentence[] {
  if (!value) return [];
  const bySection = new Map(sections.map((section) => [section.kind, section]));
  const used = new Set<string>();
  const sentences: MondaySentence[] = [];
  for (const sentence of value.sentences) {
    const section = bySection.get(sentence.section);
    if (!section || used.has(section.kind)) continue;
    const facts = Object.fromEntries(
      Object.entries(section.facts).map(([key, fact]) => [`${section.kind}.${key}`, fact]),
    );
    const text = fillFacts(sentence.text, facts);
    if (!text || text.length > 280) continue;
    used.add(section.kind);
    sentences.push({ section: section.kind, text });
    if (sentences.length === MONDAY_READ_SENTENCES) break;
  }
  return sentences;
}

export function mondayReadFixture(request: { messages: unknown }): unknown {
  const text = JSON.stringify(request.messages);
  const sentences = [];
  if (text.includes("this_week.departures")) {
    sentences.push({
      section: "this_week",
      text: "{this_week.departures} boats go out this week.",
    });
  }
  if (text.includes("waivers.divers")) {
    sentences.push({ section: "waivers", text: "{waivers.divers} divers still owe a waiver." });
  }
  return { sentences };
}
