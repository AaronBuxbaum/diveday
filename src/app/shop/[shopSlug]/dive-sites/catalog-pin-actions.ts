"use server";

import type { MapPinDetails } from "@/components/map/SiteMap";
import { getGlobalDiveSiteTemplate } from "@/db/dive-sites";
import { requireShopSurface } from "@/features/session";
import { staffDiveSiteDepthText } from "@/i18n/depth-labels";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";

/** Read-only action: selection rechecks the live shop gate, outside the neutral map cache. */
export async function catalogPinDetailsAction(
  shopSlug: string,
  slug: string,
): Promise<MapPinDetails | null> {
  const { db, shop } = await requireShopSurface(shopSlug);
  if (typeof slug !== "string" || slug.length > 200) return null;
  // Same current-version join as the preview: unpublished/missing versions reveal nothing.
  const row = await getGlobalDiveSiteTemplate(db, slug);
  if (!row) return null;
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const briefing = row.version.briefing;
  return {
    details: [
      staffDiveSiteDepthText(t, briefing, shop.depthUnit),
      diveSiteDifficultyLabel(briefing.difficultyLevel, diverTranslator(locale)),
    ].filter((detail): detail is string => Boolean(detail)),
    description: Array.from(briefing.description || briefing.currentNote || "")
      .slice(0, 360)
      .join(""),
  };
}
