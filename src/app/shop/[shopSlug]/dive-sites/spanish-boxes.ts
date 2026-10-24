import type { AppDb } from "@/db/client";
import { readTranslations, saveTranslation } from "@/db/shop-text-translations";
import {
  sourceDigest,
  TRANSLATION_MAX_LENGTH,
  type TranslatableKind,
} from "@/lib/assists/shop-translate";
import { spanishFromName, spanishTextName } from "./spanish-box-names";

/**
 * **The Spanish of a field, saved by the editor's one Save** (visual review
 * 2026-10-24, A11). The dive-site and course editors each carried a "Save
 * Spanish" form of their own below the save form, because forms cannot nest;
 * the boxes now sit inside the one form, under names of their own, and the
 * editor's action writes them with everything else.
 *
 * Two halves, because a refusal has to come before any write: `planSpanishBoxes`
 * reads what was posted and says whether it may be saved, and the action calls
 * `writeSpanishBoxes` once the English it translates is saved. The rules are
 * `saveTranslation`'s own, asked early: Spanish written from English other than
 * the English being saved is stale, and a box longer than its limit is refused.
 * A box nobody touched is left alone, so changing the English never refuses a
 * save for Spanish the staffer did not edit (the box says it is out of date on
 * the next render instead).
 */
export type SpanishBox = { field: string; text: string; translatedFrom: string; original: string };

export type SpanishPlan =
  | { ok: true; boxes: readonly SpanishBox[] }
  | { ok: false; reason: "stale" | "refused" };

export async function planSpanishBoxes(
  db: AppDb,
  shopId: string,
  subject: { kind: TranslatableKind; id: string },
  /** Each translatable field's English as this save will store it, with the box's own limit. */
  originals: Readonly<Record<string, { text: string; maxLength?: number }>>,
  formData: FormData,
): Promise<SpanishPlan> {
  const posted = Object.keys(originals).filter((field) => formData.has(spanishTextName(field)));
  if (posted.length === 0) return { ok: true, boxes: [] };
  const stored = await readTranslations(db, shopId, subject.kind, [subject.id]);
  const boxes: SpanishBox[] = [];
  for (const field of posted) {
    const rawText = formData.get(spanishTextName(field));
    const rawFrom = formData.get(spanishFromName(field));
    const text = typeof rawText === "string" ? rawText.trim() : "";
    const translatedFrom = typeof rawFrom === "string" ? rawFrom : "";
    if ((stored.get(`${subject.id}:${field}`)?.text ?? "") === text) continue;
    const { text: original, maxLength = TRANSLATION_MAX_LENGTH } = originals[field] ?? {
      text: "",
    };
    if (text.length > Math.min(maxLength, TRANSLATION_MAX_LENGTH)) {
      return { ok: false, reason: "refused" };
    }
    if (text && translatedFrom && translatedFrom !== sourceDigest(original)) {
      return { ok: false, reason: "stale" };
    }
    boxes.push({ field, text, translatedFrom, original });
  }
  return { ok: true, boxes };
}

export async function writeSpanishBoxes(
  db: AppDb,
  shopId: string,
  subject: { kind: TranslatableKind; id: string },
  boxes: readonly SpanishBox[],
): Promise<void> {
  for (const box of boxes) {
    await saveTranslation(
      db,
      shopId,
      { kind: subject.kind, id: subject.id, field: box.field },
      { text: box.text, original: box.original, translatedFrom: box.translatedFrom },
    );
  }
}
