import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import type { MapPin } from "@/components/map/SiteMap";
import { shopMapAnchor } from "@/components/map/shop-map-anchor";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import { getGlobalDiveSiteTemplate, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import type { Shop } from "@/db/schema";
import { staffDiveSiteDepthText } from "@/i18n/depth-labels";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { parseDiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import { joinFacts } from "@/lib/format";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { importDiveSiteTemplateAction } from "../actions";
import { cachedCatalogMapRows } from "../catalog-map-cache";
import { CatalogMapLayout } from "./CatalogMapLayout";
import { TemplatePreview } from "./TemplatePreview";

/**
 * DiveDay's published site catalog, folded in from its own former route
 * (ADR 20260806-dive-site-catalog-is-a-view). Reachable only from the
 * library's own "Browse templates" doors, so it renders as this page's
 * `?view=catalog` rather than a peer destination.
 */
export async function CatalogView({
  shopSlug,
  shop,
  db,
  t,
  diverT,
  page,
  slug,
}: {
  shopSlug: string;
  shop: Shop;
  db: AppDb;
  t: StaffTranslator;
  diverT: DiverTranslator;
  page?: string;
  /** A template to open in full before deciding — `?view=catalog&template=<slug>`. */
  slug?: string;
}) {
  const back = shopPath(shopSlug, "dive-sites");
  const catalogHref = `${back}?view=catalog`;
  const catalogPageHref =
    page && Number.parseInt(page, 10) > 1
      ? `${catalogHref}&page=${Number.parseInt(page, 10)}`
      : catalogHref;
  const locationIsProvided = !!(shop.addressStreet && shop.addressLocality);

  if (!locationIsProvided) {
    return (
      <StaffPage width="full">
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
          eyebrowHref={back}
          title={t("diveSites.catalog.title")}
        />
        <EmptyState
          title={t("diveSites.catalog.locationRequiredTitle")}
          body={t("diveSites.catalog.locationRequiredDescription")}
          action={
            <Link
              href={`${shopPath(shopSlug, "settings")}?section=address`}
              className={buttonClass()}
            >
              {t("diveSites.catalog.goToSettings")}
            </Link>
          }
        />
      </StaffPage>
    );
  }

  const catalog = await listGlobalDiveSiteTemplates(db, {
    page: Number.parseInt(page ?? "", 10),
    shop,
  });
  const pageHref = (target: number) => (target > 1 ? `${catalogHref}&page=${target}` : catalogHref);

  const previewSlug = slug?.trim();
  const preview = previewSlug ? await getGlobalDiveSiteTemplate(db, previewSlug, shop) : null;
  if (previewSlug && preview) {
    return (
      <TemplatePreview
        template={preview}
        backHref={catalogPageHref}
        importAction={importDiveSiteTemplateAction}
        t={t}
        diverT={diverT}
        depthUnit={shop.depthUnit}
      />
    );
  }

  const mapRows = await cachedCatalogMapRows(catalog.mapRevision);

  const shopAnchor = shopMapAnchor(shop);

  const catalogPins: MapPin[] = mapRows.map((site) => ({
    id: site.templateId,
    name: site.name,
    latitude: site.latitude,
    longitude: site.longitude,
    details: [
      staffDiveSiteDepthText(t, site, shop.depthUnit),
      diveSiteDifficultyLabel(
        site.difficultyLevel ?? parseDiveSiteDifficulty(site.difficulty),
        diverT,
      ),
    ].filter((detail): detail is string => Boolean(detail)),
    description: site.description,
    href: `${catalogPageHref}&template=${encodeURIComponent(site.slug)}`,
    hrefLabel: t("diveSites.map.openSite"),
    tone: "primary",
  }));

  return (
    <StaffPage width="full">
      <div>
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
          eyebrowHref={back}
          title={t("diveSites.catalog.title")}
          description={t("diveSites.catalog.description")}
          descriptionIsCaption
        />
      </div>
      <CatalogMapLayout
        viewportStorageKey={`${shop.id}:catalog`}
        shopAnchor={shopAnchor}
        pins={catalogPins}
        clusterLabel={t("diveSites.map.clusterLabel")}
      >
        <ul className="space-y-1">
          {catalog.templates.map(({ template, version }) => (
            <LedgerRow
              key={template.id}
              id={`template-row-${template.id}`}
              href={`${catalogPageHref}&template=${encodeURIComponent(template.slug)}`}
              linkLabel={version.briefing.name}
              stacked
              pad="lg"
            >
              <div className="min-w-0">
                <p className="font-medium">{version.briefing.name}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {joinFacts([
                    version.briefing.locationName,
                    t("diveSites.catalog.templateVersion", { version: version.version }),
                  ])}
                </p>
                {/* The one paragraph that earns a row of its own: a shop choosing
                    among thirty-four reefs it has never dived has nothing else to
                    choose on, which is the opposite of its own library. */}
                {version.briefing.description ? (
                  <p className="mt-1 text-sm text-muted">{version.briefing.description}</p>
                ) : null}
              </div>
            </LedgerRow>
          ))}
        </ul>
        <Pager
          page={catalog.page}
          pageCount={catalog.pageCount}
          href={pageHref}
          total={t("diveSites.catalog.pagination.total", { count: catalog.total })}
          words={staffPagerWords(t)}
        />
      </CatalogMapLayout>
    </StaffPage>
  );
}
