import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { shopMapAnchor } from "@/components/map/shop-map-anchor";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import {
  getGlobalDiveSiteTemplate,
  listGlobalDiveSiteMapRows,
  listGlobalDiveSiteTemplates,
} from "@/db/dive-sites";
import type { Shop } from "@/db/schema";
import { type SiteListFilters, siteListHref } from "@/features/dive-sites";
import type { DiverTranslator } from "@/i18n/messages";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { joinFacts } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { importDiveSiteTemplateAction } from "../actions";
import { cachedCatalogMapRows } from "../catalog-map-cache";
import { compactCatalogPins } from "../catalog-map-pins";
import { catalogPinDetailsAction } from "../catalog-pin-actions";
import { CatalogMapLayout } from "./CatalogMapLayout";
import { SiteLibraryViews } from "./SiteLibraryViews";
import { SiteToolbar } from "./SiteToolbar";
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
  query,
  filters,
}: {
  shopSlug: string;
  shop: Shop;
  db: AppDb;
  t: StaffTranslator;
  diverT: DiverTranslator;
  page?: string;
  /** A template to open in full before deciding — `?view=catalog&template=<slug>`. */
  slug?: string;
  /** The search and chips, as the library reads them. */
  query: string;
  filters: SiteListFilters;
}) {
  const back = shopPath(shopSlug, "dive-sites");
  const requestedPage = Number.parseInt(page ?? "", 10);
  const narrowed = Boolean(filters.difficulty || filters.need || filters.area);
  /** This view's URL with the search and chips kept; only what is named changes. */
  const hrefFor = (change: { page?: number; template?: string; area?: null }) =>
    siteListHref(back, {
      view: "catalog",
      q: query,
      ...filters,
      ...(change.area === null ? { area: undefined } : {}),
      page: change.page,
      template: change.template,
    });
  const catalogPageHref = hrefFor({ page: requestedPage > 1 ? requestedPage : undefined });
  const withoutArea = hrefFor({ area: null });
  const matches = { query: query || undefined, ...filters };
  const locationIsProvided = !!(shop.addressStreet && shop.addressLocality);

  if (!locationIsProvided) {
    return (
      <StaffPage width="full">
        <ShopPageHeader title={t("diveSites.catalog.title")} />
        <SiteLibraryViews
          shopSlug={shopSlug}
          current="catalog"
          carry={{ q: query, difficulty: filters.difficulty, need: filters.need }}
          t={t}
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
    page: requestedPage,
    shop,
    filter: matches,
  });
  const pageHref = (target: number) => hrefFor({ page: target });

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

  // The whole catalog's pins are shared and cached by revision; a narrowed one
  // is read for this request, since the cache key is the catalog and not the
  // words. The map's own area narrows the list, never the pins it draws.
  const mapRows =
    query || filters.difficulty || filters.need
      ? await listGlobalDiveSiteMapRows(db, { query: query || undefined, ...filters })
      : await cachedCatalogMapRows(catalog.mapRevision);

  const shopAnchor = shopMapAnchor(shop);

  const catalogPins = compactCatalogPins(mapRows);

  return (
    <StaffPage width="full">
      <div>
        <ShopPageHeader
          title={t("diveSites.catalog.title")}
          description={t("diveSites.catalog.description")}
          descriptionIsCaption
        />
        <SiteLibraryViews
          shopSlug={shopSlug}
          current="catalog"
          carry={{ q: query, difficulty: filters.difficulty, need: filters.need }}
          t={t}
        />
      </div>
      <SiteToolbar
        base={back}
        view="catalog"
        query={query}
        filters={filters}
        t={t}
        diverT={diverT}
      />
      <CatalogMapLayout
        viewportStorageKey={`${shop.id}:catalog`}
        shopAnchor={shopAnchor}
        pins={catalogPins}
        catalogPageHref={catalogPageHref}
        openSiteLabel={t("diveSites.map.openSite")}
        loadDetails={catalogPinDetailsAction.bind(null, shopSlug)}
        detailWords={{
          loading: t("diveSites.map.loadingDetails"),
          unavailable: t("diveSites.map.detailsUnavailable"),
        }}
        clusterLabel={t("diveSites.map.clusterLabel")}
        zoomHint={t("diveSites.map.zoomHint")}
        followLabel={t("diveSites.list.followMap")}
        areaCount={t("diveSites.list.areaCount", { count: catalog.total })}
        scoped={Boolean(filters.area)}
        baseHref={withoutArea}
      >
        {catalog.templates.length === 0 ? (
          <EmptyState
            title={t("diveSites.list.noMatchHeading")}
            body={t("diveSites.list.noMatchFilteredBody")}
            action={
              narrowed || query ? (
                <Link
                  href={siteListHref(back, { view: "catalog" })}
                  scroll={false}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("diveSites.list.clearFilters")}
                </Link>
              ) : null
            }
            className="mt-4"
          />
        ) : null}
        <ul className="space-y-1">
          {catalog.templates.map(({ template, version }) => (
            <LedgerRow
              key={template.id}
              id={`template-row-${template.id}`}
              href={hrefFor({
                page: requestedPage > 1 ? requestedPage : undefined,
                template: template.slug,
              })}
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
