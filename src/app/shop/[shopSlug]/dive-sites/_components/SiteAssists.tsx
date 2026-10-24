import { AssistFillButton } from "@/components/assists/AssistFillButton";
import { assistsAvailable } from "@/db/assists";
import type { AppDb } from "@/db/client";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { translationBoxId } from "@/lib/assists/shop-translate";
import { loadTranslationBox, type TranslationBox } from "../../_components/ShopTextTranslation";
import { draftSiteBriefAction, draftTranslationAction } from "../../content-assist-actions";
import { type SpanishBoxCopy, SpanishBoxField } from "./SpanishBoxField";

/**
 * A dive site's Claude assists: "Draft from these fields" inside the briefing
 * form (`site-brief`), and the briefing's Spanish inside it (`shop-translate`).
 */
export type SiteAssists = {
  canAssist: boolean;
  description: TranslationBox | null;
  marineLife: TranslationBox | null;
};

export async function loadSiteAssists(
  db: AppDb,
  shop: { id: string; defaultLocale: string },
  site: { id: string; description: string | null; marineLifeDescription: string | null } | null,
): Promise<SiteAssists> {
  const canAssist = await assistsAvailable(db, shop.id);
  if (!site) return { canAssist, description: null, marineLife: null };
  const [description, marineLife] = await Promise.all(
    (["description", "marineLifeDescription"] as const).map((field) =>
      loadTranslationBox(db, shop, { kind: "dive_site", id: site.id, field }, site[field]),
    ),
  );
  return { canAssist, description: description ?? null, marineLife: marineLife ?? null };
}

/** The Draft button for the briefing form, or nothing while assists are dark. */
export function siteBriefAssist(shopSlug: string, canAssist: boolean, t: StaffTranslator) {
  return canAssist ? (
    <AssistFillButton
      draft={draftSiteBriefAction.bind(null, shopSlug)}
      label={t("deskAssists.siteBrief.draft")}
      pendingLabel={t("deskAssists.drafting")}
      emptyLabel={t("deskAssists.nothing")}
    />
  ) : undefined;
}

/** The words every Spanish box in an editor's form says. */
export function spanishBoxCopy(t: StaffTranslator, label?: string): SpanishBoxCopy {
  return {
    label: label ?? t("deskAssists.translate.label"),
    draft: t("deskAssists.translate.draft"),
    drafting: t("deskAssists.drafting"),
    nothing: t("deskAssists.nothing"),
    stale: t("deskAssists.translate.stale"),
  };
}

/** One Spanish box as a field of the editor's form, or nothing when there is none to draw. */
export function SpanishBox({
  shopSlug,
  box,
  canAssist,
  maxLength,
  t,
  label,
}: {
  shopSlug: string;
  box: TranslationBox | null;
  canAssist: boolean;
  maxLength: number;
  t: StaffTranslator;
  label?: string;
}) {
  if (!box) return null;
  const { kind, id, field } = box;
  return (
    <SpanishBoxField
      boxId={translationBoxId(kind, id, field)}
      field={field}
      defaultValue={box.text}
      translatedFrom={box.translatedFrom}
      stale={box.stale}
      maxLength={maxLength}
      draft={canAssist ? draftTranslationAction.bind(null, shopSlug, kind, id, field) : undefined}
      copy={spanishBoxCopy(t, label)}
    />
  );
}

/**
 * The briefing's Spanish, as fields of the one briefing form (visual review
 * 2026-10-24, A11): the save that writes the English writes them too.
 */
export function siteSpanishFields(shopSlug: string, assists: SiteAssists, t: StaffTranslator) {
  if (!assists.description && !assists.marineLife) return null;
  return (
    <div className="flex flex-col gap-6">
      <SpanishBox
        shopSlug={shopSlug}
        box={assists.description}
        canAssist={assists.canAssist}
        t={t}
        maxLength={1200}
      />
      <SpanishBox
        shopSlug={shopSlug}
        box={assists.marineLife}
        canAssist={assists.canAssist}
        t={t}
        maxLength={1200}
        label={t("deskAssists.translate.marineLifeLabel")}
      />
    </div>
  );
}
