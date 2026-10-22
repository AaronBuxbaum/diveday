import { AssistFillButton } from "@/components/assists/AssistFillButton";
import { shopAssistsAvailable } from "@/db/assist-shop";
import type { AppDb } from "@/db/client";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  loadTranslationBox,
  ShopTextTranslation,
  type TranslationBox,
} from "../../_components/ShopTextTranslation";
import { draftSiteBriefAction } from "../../content-assist-actions";

/**
 * A dive site's Claude assists: "Draft from these fields" inside the briefing
 * form (`site-brief`), and the briefing's Spanish below it (`shop-translate`).
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
  const canAssist = await shopAssistsAvailable(db, shop.id);
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
    />
  ) : undefined;
}

/** The briefing's Spanish, each its own small form below the save form (forms cannot nest). */
export function SiteTranslations({
  shopSlug,
  assists,
  t,
}: {
  shopSlug: string;
  assists: SiteAssists;
  t: StaffTranslator;
}) {
  if (!assists.description && !assists.marineLife) return null;
  return (
    <div className="mt-8 flex flex-col gap-6">
      <ShopTextTranslation
        shopSlug={shopSlug}
        box={assists.description}
        canAssist={assists.canAssist}
        t={t}
        maxLength={1200}
      />
      <ShopTextTranslation
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
