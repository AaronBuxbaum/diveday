import type { FirstRunChecklistCopy } from "@/app/shop/[shopSlug]/_components/today/FirstRunChecklist";
import { DIVE_SITE_TEMPLATES } from "@/content/dive-site-templates";
import type { Shop } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { siteCatalogIsLocal } from "@/lib/curated-defaults";
import { FIRST_RUN_STEP_COUNT } from "@/lib/onboarding";

/**
 * Every sentence the first-run checklist shows, in this reader's language.
 * The dive-site step's body names the starter catalogue's size only where the
 * catalogue is local to the shop's waters; elsewhere it asks for the shop's own.
 */
export function firstRunChecklistCopy(
  t: StaffTranslator,
  shop: Shop,
  counts: { diveSiteCount: number; doneCount: number },
): FirstRunChecklistCopy {
  return {
    groupLabel: t("shopHome.firstRun.groupLabel"),
    subtitle: t("shopHome.firstRun.subtitle"),
    progress: t("shopHome.firstRun.progress", {
      done: counts.doneCount,
      total: FIRST_RUN_STEP_COUNT,
    }),
    contactTitle: t("shopHome.firstRun.contactTitle"),
    contactBody: t("shopHome.firstRun.contactBody"),
    contactAction: t("shopHome.firstRun.contactAction"),
    contactDone: t("shopHome.firstRun.contactDone"),
    profileTitle: t("shopHome.firstRun.profileTitle"),
    profileBody: t("shopHome.firstRun.profileBody"),
    profileAction: t("shopHome.firstRun.profileAction"),
    profileDone: t("shopHome.firstRun.profileDone"),
    unitsTitle: t("shopHome.firstRun.unitsTitle"),
    unitsBody: t("shopHome.firstRun.unitsBody", {
      currency: shop.currency.toUpperCase(),
      depth: t(
        shop.depthUnit === "feet" ? "shopHome.firstRun.unitsFeet" : "shopHome.firstRun.unitsMeters",
      ),
    }),
    unitsAction: t("shopHome.firstRun.unitsAction"),
    unitsDone: t("shopHome.firstRun.unitsDone"),
    siteTitle: t("shopHome.firstRun.siteTitle"),
    siteBody: siteCatalogIsLocal(shop)
      ? t("shopHome.firstRun.siteBody", { count: DIVE_SITE_TEMPLATES.length })
      : t("shopHome.firstRun.siteBodyOwn"),
    siteAction: t("shopHome.firstRun.siteAction"),
    siteDone: t("shopHome.firstRun.siteDone", { count: counts.diveSiteCount }),
    releaseTitle: t("shopHome.firstRun.releaseTitle"),
    releaseBody: t("shopHome.firstRun.releaseBody"),
    releaseAction: t("shopHome.firstRun.releaseAction"),
    releaseDone: t("shopHome.firstRun.releaseDone"),
    tripTitle: t("shopHome.firstRun.tripTitle"),
    tripBody: t("shopHome.firstRun.tripBody"),
    tripAction: t("shopHome.firstRun.tripAction"),
    scheduleTitle: t("shopHome.firstRun.scheduleTitle"),
    scheduleBody: t("shopHome.firstRun.scheduleBody"),
    scheduleCopy: t("shopHome.firstRun.scheduleCopy"),
    scheduleCopied: t("shopHome.firstRun.scheduleCopied"),
    scheduleCopyFailed: t("shopHome.firstRun.scheduleCopyFailed"),
    stripeTitle: t("shopHome.firstRun.stripeTitle"),
    stripeBody: t("shopHome.firstRun.stripeBody"),
    stripeAction: t("shopHome.firstRun.stripeAction"),
    stripeDone: t("shopHome.firstRun.stripeDone"),
    doneBadge: t("shopHome.firstRun.doneBadge"),
  };
}
