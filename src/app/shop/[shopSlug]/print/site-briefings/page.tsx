import type { Metadata } from "next";
import { listDiveSites, listSiteFieldGuides } from "@/db/dive-sites";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { printSheetSpec, storefrontAddress } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { PaperSheet, SheetMark } from "../_components/PaperSheet";
import { SheetDocument } from "../_components/SheetDocument";

export const instant = true;

export const metadata: Metadata = {
  title: "Site briefing cards — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The site briefing cards** (A5 landscape, one per site, all in one job) —
 * ADR 20260908-one-hand, decision 6, lever X.
 *
 * The crew's clipboard. Every card is the shop's own briefing off the site
 * editor and the field guide it picked, so the words a diver hears on the boat
 * are the words on the storefront — which is the whole argument for printing
 * from the app rather than retyping a laminated sheet once a season.
 *
 * **The words are the shop's, except the species.** The briefing is whatever
 * the site editor holds, uncaptioned and unedited (ADR
 * 20260813-dive-site-briefings-are-the-shops-own-words); the field guide is a
 * *selection* of catalog species whose names are DiveDay's, in the reader's
 * language (ADR 20260813-marine-life-is-diveday-copy), which is why this page
 * carries a diver translator beside its staff one.
 *
 * No code on this card. It is read on a boat by a crew member holding it, and
 * there is no public page for one site to send them to.
 */
export default async function SiteBriefingsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const diverT = diverTranslator(locale);
  const sites = await listDiveSites(db, shop.id);
  const guides = await listSiteFieldGuides(
    db,
    shop.id,
    sites.map((site) => site.id),
  );
  const spec = printSheetSpec("site_briefing");
  const theme = deriveBrandTheme(shop.brandColor ?? DIVEDAY_BRAND_COLOR);
  const printed = t("print.sheet.briefing.fold", {
    date: formatDateWithYear(nowDate(), locale, shop.timezone),
  });
  const address = storefrontAddress(shopSlug, publicAppUrl());

  return (
    <SheetDocument
      shopSlug={shopSlug}
      paper={spec.paper}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("print.settings.title")}
      printLabel={t("print.settings.door")}
    >
      {sites.map((site, index) => {
        const level = diveSiteDifficultyLabel(site.difficultyLevel, diverT);
        const meta = [site.depthRange, level].filter((part): part is string => Boolean(part));
        const species = fieldGuideCards(guides.get(site.id) ?? [], diverT);
        return (
          <PaperSheet
            key={site.id}
            paper={spec.paper}
            tone={{ band: theme.primary, bandInk: theme.primaryForeground }}
            band={
              <>
                <SheetMark name={shop.name} size="sm" />
                <span className="font-brand-display text-sm font-bold">{site.name}</span>
                {meta.length > 0 ? (
                  <span className="ms-auto font-mono text-[0.625rem]">{meta.join(" · ")}</span>
                ) : null}
              </>
            }
            foldLeft={printed}
            foldRight={t("print.sheet.briefing.index", {
              index: index + 1,
              total: sites.length,
            })}
          >
            {site.description ? (
              <>
                <h2 className="font-brand-display text-base font-bold">
                  {t("print.sheet.briefing.briefingHeading")}
                </h2>
                <p className="paper-sheet-muted mt-1.5 text-xs leading-snug whitespace-pre-line">
                  {site.description}
                </p>
              </>
            ) : null}
            {site.divePlan ? (
              <p className="paper-sheet-muted mt-3 text-xs leading-snug whitespace-pre-line">
                {site.divePlan}
              </p>
            ) : null}
            {species.length > 0 ? (
              <>
                <h2 className="font-brand-display mt-4 text-base font-bold">
                  {t("print.sheet.briefing.seenHeading")}
                </h2>
                <p className="paper-sheet-muted mt-1 text-xs leading-snug">
                  {species.map((card) => card.name).join(", ")}
                </p>
              </>
            ) : null}
            <p className="paper-sheet-muted mt-4 text-[0.625rem]">{address}</p>
          </PaperSheet>
        );
      })}
    </SheetDocument>
  );
}
