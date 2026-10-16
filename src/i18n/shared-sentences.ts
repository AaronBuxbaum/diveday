import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **One rate-limit sentence and one role refusal, not eleven copies**
 * (fifth-loop ideas, item 60). "You have sent a lot of … this hour" and "Only
 * an owner or manager can …" were each written once per area, so the voice
 * had a place to drift in every one, and Spanish had a translation to keep
 * right in every one. Each is now one bundle entry (`shared.limits`) with the
 * noun or the act filled in by an ICU select, and a surface names which.
 */

/** What a staffer sent too much of this hour; the bundle's select names each. */
export type SendLimitThing = "replies" | "recaps" | "invites";

/** What only an owner or manager may do; the bundle's select names each. */
export type OwnerOnlyAct =
  | "whatsapp"
  | "integrations"
  | "backup"
  | "questionnaire"
  | "invoice"
  | "bill"
  | "courseForm";

/** A message key and the values it takes, for a notice table to carry. */
export type StaffWords = { key: StaffMessageKey; values?: Record<string, string> };

export function sendLimitWords(thing: SendLimitThing): StaffWords {
  return { key: "shared.limits.sendLimit", values: { thing } };
}

export function ownerOnlyWords(act: OwnerOnlyAct): StaffWords {
  return { key: "shared.limits.ownerOnly", values: { act } };
}

/** Say a notice table's entry: a bare key, or a key with its values. */
export function sayWords(t: StaffTranslator, words: StaffMessageKey | StaffWords): string {
  return typeof words === "string" ? t(words) : t(words.key, words.values);
}
