import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  isTranslatable,
  sourceDigest,
  TRANSLATION_MAX_LENGTH,
  type TranslatableKind,
} from "@/lib/assists/shop-translate";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { courses, diveSites, shopTextTranslations, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * A shop's own words in Spanish (`shop_text_translations`). Read by the diver
 * pages when the reader's language is Spanish, and only while the original's
 * words are the ones that were translated.
 */

export const TRANSLATION_LOCALE = "es-ES";

type Subject = { kind: TranslatableKind; id: string; field: string };

/** The stored Spanish for each subject, keyed `id:field`, whatever its digest. */
export async function readTranslations(
  db: DbExecutor,
  shopId: string,
  kind: TranslatableKind,
  ids: readonly string[],
  locale: string = TRANSLATION_LOCALE,
): Promise<Map<string, { text: string; sourceDigest: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      subjectId: shopTextTranslations.subjectId,
      field: shopTextTranslations.field,
      text: shopTextTranslations.text,
      sourceDigest: shopTextTranslations.sourceDigest,
    })
    .from(shopTextTranslations)
    .where(
      and(
        eq(shopTextTranslations.shopId, shopId),
        eq(shopTextTranslations.subjectKind, kind),
        eq(shopTextTranslations.locale, locale),
        inArray(shopTextTranslations.subjectId, [...ids]),
      ),
    );
  return new Map(
    rows.flatMap((row) =>
      row.text
        ? [[`${row.subjectId}:${row.field}`, { text: row.text, sourceDigest: row.sourceDigest }]]
        : [],
    ),
  );
}

/**
 * The words a reader sees: the translation when the reader's language has one
 * and it still matches the original, otherwise the original.
 */
export function translatedOr(
  translations: ReadonlyMap<string, { text: string; sourceDigest: string }>,
  id: string,
  field: string,
  original: string | null,
): string | null {
  if (!original?.trim()) return original;
  const stored = translations.get(`${id}:${field}`);
  return stored && stored.sourceDigest === sourceDigest(original) ? stored.text : original;
}

/** Whether a reader in `locale` reads translations at all. */
export function readsTranslations(locale: string, shopLocale: string): boolean {
  return locale.toLowerCase().startsWith("es") && !shopLocale.toLowerCase().startsWith("es");
}

/**
 * Saves the shop's Spanish for one field, pinned to the original it
 * translates. An empty box stores null. Refuses a field outside the list.
 */
export async function saveTranslation(
  db: AppDb,
  shopId: string,
  subject: Subject,
  input: { text: string; original: string },
): Promise<boolean> {
  if (!isTranslatable(subject.kind, subject.field)) return false;
  const text = input.text.trim();
  if (text.length > TRANSLATION_MAX_LENGTH) return false;
  const now = nowDate();
  const values = {
    shopId,
    subjectKind: subject.kind,
    subjectId: subject.id,
    field: subject.field,
    locale: TRANSLATION_LOCALE,
    text: text || null,
    sourceDigest: sourceDigest(input.original),
    createdAt: now,
    updatedAt: now,
  };
  await db
    .insert(shopTextTranslations)
    .values(values)
    .onConflictDoUpdate({
      target: [
        shopTextTranslations.shopId,
        shopTextTranslations.subjectKind,
        shopTextTranslations.subjectId,
        shopTextTranslations.field,
        shopTextTranslations.locale,
      ],
      set: { text: values.text, sourceDigest: values.sourceDigest, updatedAt: now },
    });
  return true;
}

/**
 * The original words of one translatable field, read in this shop only, or
 * null when the shop has no such live record. Every write of a translation
 * pins to this, never to text a form posted.
 */
export async function translatableOriginal(
  db: AppDb,
  shopId: string,
  kind: TranslatableKind,
  id: string,
  field: string,
): Promise<string | null> {
  if (!isTranslatable(kind, field)) return null;
  if (kind === "trip") {
    const [row] = await db
      .select({ description: trips.description })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.shopId, shopId), liveTrip()))
      .limit(1);
    return row ? (row.description ?? "") : null;
  }
  if (kind === "course") {
    const [row] = await db
      .select({ summary: courses.summary })
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.shopId, shopId)))
      .limit(1);
    return row ? (row.summary ?? "") : null;
  }
  const [row] = await db
    .select({
      description: diveSites.description,
      marineLifeDescription: diveSites.marineLifeDescription,
    })
    .from(diveSites)
    .where(and(eq(diveSites.id, id), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .limit(1);
  if (!row) return null;
  return (field === "marineLifeDescription" ? row.marineLifeDescription : row.description) ?? "";
}

/**
 * A record with its translatable fields as a reader in `locale` should see
 * them: the shop's saved Spanish where the reader reads Spanish, the shop
 * writes in another language and the Spanish still matches the original;
 * the original otherwise. One read for all the fields.
 */
export async function withTranslatedFields<T extends { id: string }, F extends keyof T & string>(
  db: DbExecutor,
  shop: { id: string; defaultLocale: string },
  locale: string,
  kind: TranslatableKind,
  row: T,
  fields: readonly F[],
): Promise<T> {
  if (!readsTranslations(locale, shop.defaultLocale)) return row;
  const stored = await readTranslations(db, shop.id, kind, [row.id]);
  if (stored.size === 0) return row;
  const next = { ...row };
  for (const field of fields) {
    const original = row[field];
    if (typeof original === "string") {
      next[field] = translatedOr(stored, row.id, field, original) as T[F];
    }
  }
  return next;
}
