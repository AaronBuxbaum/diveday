import {
  TranslationEditor,
  type TranslationEditorCopy,
} from "@/components/assists/TranslationEditor";
import type { DbExecutor } from "@/db/client";
import { readsTranslations, readTranslations } from "@/db/shop-text-translations";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  sourceDigest,
  TRANSLATION_MAX_LENGTH,
  type TranslatableKind,
  translationBoxId,
} from "@/lib/assists/shop-translate";
import { draftTranslationAction, saveTranslationAction } from "../content-assist-actions";

export function translationEditorCopy(t: StaffTranslator): TranslationEditorCopy {
  return {
    label: t("deskAssists.translate.label"),
    draft: t("deskAssists.translate.draft"),
    drafting: t("deskAssists.drafting"),
    save: t("deskAssists.translate.save"),
    saving: t("deskAssists.translate.saving"),
    saved: t("deskAssists.translate.saved"),
    error: t("deskAssists.translate.error"),
    stale: t("deskAssists.translate.stale"),
    staleSave: t("deskAssists.translate.staleSave"),
  };
}

/** One Spanish box's subject and what it holds now. */
export type TranslationBox = {
  kind: TranslatableKind;
  id: string;
  field: string;
  text: string;
  /** The digest of the English the saved Spanish translates, or "". */
  translatedFrom: string;
  stale: boolean;
};

/**
 * The Spanish box for one of the shop's own fields, read from
 * `shop_text_translations`, or null when there is no box to draw: a shop
 * whose own language is Spanish (its divers already read the original), a
 * field with no original yet, or a read that failed (the editor around it
 * still renders; a translation box is never why a page breaks).
 */
export async function loadTranslationBox(
  db: DbExecutor,
  shop: { id: string; defaultLocale: string },
  subject: { kind: TranslatableKind; id: string; field: string },
  original: string | null,
): Promise<TranslationBox | null> {
  if (!readsTranslations("es-ES", shop.defaultLocale) || !original?.trim()) return null;
  try {
    const stored = (await readTranslations(db, shop.id, subject.kind, [subject.id])).get(
      `${subject.id}:${subject.field}`,
    );
    return {
      ...subject,
      text: stored?.text ?? "",
      translatedFrom: stored?.text ? stored.sourceDigest : "",
      stale: Boolean(stored && stored.sourceDigest !== sourceDigest(original)),
    };
  } catch {
    return null;
  }
}

export function ShopTextTranslation({
  shopSlug,
  box,
  canAssist,
  t,
  maxLength = TRANSLATION_MAX_LENGTH,
  label,
}: {
  shopSlug: string;
  box: TranslationBox | null;
  canAssist: boolean;
  t: StaffTranslator;
  maxLength?: number;
  /** When the page has more than one box, which one this is. */
  label?: string;
}) {
  if (!box) return null;
  const { kind, id, field } = box;
  return (
    <TranslationEditor
      boxId={translationBoxId(kind, id, field)}
      defaultValue={box.text}
      translatedFrom={box.translatedFrom}
      stale={box.stale}
      maxLength={maxLength}
      save={saveTranslationAction.bind(null, shopSlug, kind, id, field)}
      draft={canAssist ? draftTranslationAction.bind(null, shopSlug, kind, id, field) : undefined}
      copy={{ ...translationEditorCopy(t), ...(label ? { label } : {}) }}
    />
  );
}
