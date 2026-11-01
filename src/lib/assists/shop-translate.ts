import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { numbersCameFrom, samePlaceholders } from "./facts";

/**
 * **shop-translate**: a drafted Spanish version of what a shop wrote itself
 * (trip descriptions, course summaries, dive-site briefings), so its diver
 * pages read fully in Spanish. The shop edits and saves the draft; nothing is
 * published by the model.
 *
 * Waiver and medical wording is excluded until H-20260730-jurisdiction-waiver-text-medical and H-20260724-current-typed-name-explicit are decided: only
 * the fields in `TRANSLATABLE_FIELDS` can be sent, and none of them is a waiver,
 * a medical question or a course form.
 *
 * A translation may not change a number or a depth marker: every digit run and
 * every `{depth18}` in the Spanish must be in the source.
 */

export const SHOP_TRANSLATE_FEATURE = "shop_translate";

/** The subject kinds and fields a translation may be stored for. */
export const TRANSLATABLE_FIELDS = {
  trip: ["description"],
  course: ["summary"],
  dive_site: ["description", "marineLifeDescription"],
} as const;
export type TranslatableKind = keyof typeof TRANSLATABLE_FIELDS;
export type TranslatableField<K extends TranslatableKind = TranslatableKind> =
  (typeof TRANSLATABLE_FIELDS)[K][number];

export function isTranslatable(kind: string, field: string): kind is TranslatableKind {
  return (
    Object.hasOwn(TRANSLATABLE_FIELDS, kind) &&
    (TRANSLATABLE_FIELDS[kind as TranslatableKind] as readonly string[]).includes(field)
  );
}

/** The Spanish box's element id, so a description draft in another form can fill it. */
export function translationBoxId(kind: TranslatableKind, id: string, field: string): string {
  return `es-${kind}-${id}-${field}`;
}

/**
 * The id of the box's hidden "translated from" field: the digest of the
 * English its Spanish was written from, set by a draft and cleared when the
 * staffer types (TranslationEditor).
 */
export function translationSourceId(boxId: string): string {
  return `${boxId}-from`;
}

export const TRANSLATION_MAX_LENGTH = 1_500;

export const SHOP_TRANSLATE_SYSTEM = [
  "Translate a dive shop's own public text into Latin American Spanish, for divers reading the shop's site.",
  "Keep the meaning, the tone and the length. Keep every number, unit and placeholder in braces exactly as written. Keep names of places, boats and people as they are.",
  "Use dive terms a Spanish diver uses (inmersión, tanque, plomos, chaleco).",
].join("\n");

const Translation = z.object({ text: z.string() });

export function shopTranslateCall(source: string): StructuredCall<typeof Translation> {
  return {
    model: source.length > 400 ? "draft" : "quick",
    system: SHOP_TRANSLATE_SYSTEM,
    content: `Text: ${source}`,
    schema: Translation,
    maxTokens: 2_000,
  };
}

/** The Spanish to put in the box, or null when it changed a fact. */
export function shopTranslation(value: { text: string } | null, source: string): string | null {
  const text = value?.text.trim() ?? "";
  if (!text || text.length > TRANSLATION_MAX_LENGTH) return null;
  if (!numbersCameFrom(text, source) || !numbersCameFrom(source, text)) return null;
  if (!samePlaceholders(text, source)) return null;
  return text;
}

/** A short, stable fingerprint of the source, so a translation of old words is never shown. */
export function sourceDigest(source: string): string {
  let hash = 0x811c9dc5;
  for (const char of source.trim()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function shopTranslateFixture(request: { messages: unknown }): unknown {
  const text = String((request.messages as { content: string }[])[0]?.content ?? "").replace(
    /^Text: /,
    "",
  );
  const numbers = text.match(/\p{Nd}+(?:[.,]\p{Nd}+)?/gu) ?? [];
  return { text: ["Texto en español.", ...numbers].join(" ") };
}
