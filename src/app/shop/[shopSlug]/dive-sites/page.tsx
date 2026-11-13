import type { Metadata } from "next";
import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AddPanel } from "@/components/AddPanel";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import type { MapPin } from "@/components/map/SiteMap";
import { shopMapAnchor } from "@/components/map/shop-map-anchor";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { buttonClass } from "@/components/ui/button";
import type { NoticeTone } from "@/components/ui/tone";
import {
  countGlobalDiveSiteTemplates,
  currentGlobalDiveSiteVersions,
  diveSiteLibrarySize,
  groupSiteLibrary,
  listDiveSiteMapRows,
  listDiveSitesPage,
} from "@/db/dive-sites";
import { parseSiteFilters, siteListHref } from "@/features/dive-sites";
import { requireShopSurface } from "@/features/session";
import { staffDiveSiteDepthText } from "@/i18n/depth-labels";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { addPanelCloseHref, addPanelHref, addPanelOpen } from "@/lib/add-panel";
import { canEditDiveSites } from "@/lib/authz";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { CatalogView } from "./_components/CatalogView";
import { NewSitePanel } from "./_components/NewSitePanel";
import { SiteLibraryLayout } from "./_components/SiteLibraryLayout";
import { SiteLibraryLedger } from "./_components/SiteLibraryLedger";
import { SiteLibraryViews } from "./_components/SiteLibraryViews";
import { SiteToolbar } from "./_components/SiteToolbar";
import { catalogPageMetadata } from "./dive-site-page-metadata";

/** `?notice=` codes this page redirects back to itself with. Read through
 * `noticeFromParam`, never a bare `NOTICES[notice]` — the param is
 * attacker-supplied (src/lib/staff-notices.ts). */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  deleted: { tone: "success", key: "diveSites.list.siteDeletedNotice" },
};

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ view?: string; template?: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  return catalogPageMetadata(shopSlug, await searchParams);
}

export default async function DiveSitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    /** `1`: the new-site panel is open (`NewSitePanel`). */
    add?: string;
    notice?: string;
    q?: string;
    page?: string;
    view?: string;
    template?: string;
    difficulty?: string;
    need?: string;
    /** `south,west,north,east`: only sites inside the map's rectangle. */
    area?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const search = await searchParams;
  const { notice, q, page, view, template } = search;
  const surface = await requireShopSurface(shopSlug);
  const { db, shop } = surface;
  const libraryPath = shopPath(shopSlug, "dive-sites");
  const adding = addPanelOpen(search.add);
  const addHref = addPanelHref(libraryPath);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // A template's field guide is diver copy, so the catalog preview reads it
  // through the diver bundle -- in the staffer's own language, same locale.
  const diverT = diverTranslator(locale);

  // Editing the library, and so importing from DiveDay's catalog, is owner and
  // manager work (`canEditDiveSites`, read off the session for what is drawn;
  // every action re-asks the database): a crew member reads the sites and
  // schedules trips at them, and is never shown a door that is not theirs.
  const mayEdit = canEditDiveSites(surface.session.user.roles);
  const requestedPage = Number.parseInt(page ?? "", 10);
  const query = q?.trim() ? q.trim() : "";
  const filters = parseSiteFilters(search);
  // The published site catalog is one route and a `?view=catalog` switch
  // (ADR 20260803-not-ready-is-a-view / 20260806-dive-site-catalog-is-a-view),
  // and it answers the same search and chips the library does.
  if (view === "catalog" && mayEdit) {
    return (
      <CatalogView
        shopSlug={shopSlug}
        shop={shop}
        db={db}
        t={t}
        diverT={diverT}
        page={page}
        slug={template}
        query={query}
        filters={filters}
      />
    );
  }

  // A non-numeric or missing `?page=` reads as page 1 rather than NaN.
  const narrowed = Boolean(filters.difficulty || filters.need || filters.area);
  const [sitePage, librarySize, catalogSize, mapRows] = await Promise.all([
    listDiveSitesPage(
      db,
      shop.id,
      { query: query || undefined, ...filters },
      { page: Number.isFinite(requestedPage) ? requestedPage : 1 },
    ),
    // Shop-wide, never page- or search-scoped. It answers one question — does
    // this shop have a library yet? — which is what separates the day-one
    // empty state from a search that simply matched nothing.
    diveSiteLibrarySize(db, shop.id),
    // The catalog door's number, over the whole published catalog — never the
    // `total` of a page nobody has fetched yet (ADR 20260827-the-shops-shelves).
    mayEdit ? countGlobalDiveSiteTemplates(db) : Promise.resolve(0),
    // The pins answer the search and chips the list does; the map's own area is
    // what it draws, so it never narrows them.
    listDiveSiteMapRows(db, shop.id, {
      query: query || undefined,
      difficulty: filters.difficulty,
      need: filters.need,
    }),
  ]);
  const sites = sitePage.rows;
  const banner = noticeFromParam(notice, NOTICES);
  // Looked up for exactly the imported sites on this page, not read off the
  // whole published catalog — that catalog pages now, and indexing one page of
  // it would quietly drop the "newer version published" badge for every site
  // sourced from a template past it.
  const currentTemplateVersion = await currentGlobalDiveSiteVersions(
    db,
    sites.map((site) => site.sourceTemplateId).filter((id): id is string => Boolean(id)),
  );

  const shopAnchor = shopMapAnchor(shop);

  const pins: MapPin[] = mapRows
    .filter(
      (site): site is typeof site & { latitude: number; longitude: number } =>
        site.latitude != null && site.longitude != null,
    )
    .map((site) => ({
      id: site.id,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      details: [
        staffDiveSiteDepthText(t, site, shop.depthUnit),
        diveSiteDifficultyLabel(site.difficultyLevel, diverT),
      ].filter((detail): detail is string => Boolean(detail)),
      description: site.description,
      href: `/shop/${shopSlug}/dive-sites/${site.id}`,
      hrefLabel: t("diveSites.map.openSite"),
      tone:
        site.difficultyLevel === "advanced"
          ? "warning"
          : site.difficultyLevel === "beginner"
            ? "primary"
            : "default",
    }));

  /** This page's URL with the search kept and only `page` swapped. */
  const pageHref = (target: number) =>
    siteListHref(libraryPath, { q: query, ...filters, page: target });
  /** Every choice but the map's area: what the map switch builds on. */
  const withoutArea = siteListHref(libraryPath, { q: query, ...filters, area: undefined });
  const clearFiltersHref = siteListHref(libraryPath, { q: query });
  const catalogHref = `/shop/${shopSlug}/dive-sites?view=catalog`;

  return (
    <StaffPage width="full">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        title={t("diveSites.list.title")}
        // An empty library gets no header action: the empty card below is
        // already the whole page, and it carries both doors. Two identical
        // primaries on one screen is what principle 8 forbids — so the card
        // owns them until there is a library to act on.
        //
        actions={
          !mayEdit || librarySize === 0 || adding ? undefined : (
            <Link href={addHref} className={buttonClass()}>
              {t("diveSites.list.createSite")}
            </Link>
          )
        }
      />

      {librarySize > 0 && catalogSize > 0 ? (
        <SiteLibraryViews
          shopSlug={shopSlug}
          current="library"
          carry={{ q: query, difficulty: filters.difficulty, need: filters.need }}
          t={t}
        />
      ) : null}

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      <AddPanel
        open={adding && mayEdit}
        title={t("diveSites.new.title")}
        description={t("diveSites.new.description")}
        closeHref={addPanelCloseHref(libraryPath, search)}
        closeLabel={t("shared.addPanel.close")}
      >
        <NewSitePanel surface={surface} shopSlug={shopSlug} t={t} locale={locale} />
      </AddPanel>

      {/* Unconditional once there is anything to search: a library that hid
        its search box below some size would teach staff to scroll. Hidden only
        when the library is empty, where the empty state has the one thing to do. */}
      {librarySize > 0 ? (
        <SiteToolbar base={libraryPath} query={query} filters={filters} t={t} diverT={diverT} />
      ) : null}

      {librarySize === 0 ? (
        <EmptyState
          title={query ? t("diveSites.list.noMatchHeading") : t("diveSites.list.emptyHeading")}
          body={t("diveSites.list.emptyBody")}
          action={
            !mayEdit || query || librarySize > 0 || adding ? null : (
              // The only place these two doors exist on an empty library: the
              // header drops its actions when the library is empty precisely so
              // this card owns them, and a shop reading "start with a site your
              // crew knows well" can start from that sentence.
              // Same pair, same order as the header's: the primary last. A
              // fragment, not a row of its own: the card's action row already
              // is one, with its own gap under the body.
              <>
                <Link
                  href={catalogHref}
                  scroll={false}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("diveSites.list.browseTemplates")}
                </Link>
                <Link href={addHref} className={buttonClass()}>
                  {t("diveSites.list.createSite")}
                </Link>
              </>
            )
          }
          className="mt-4"
        />
      ) : (
        <SiteLibraryLayout
          viewportStorageKey={`${shop.id}:library`}
          shopAnchor={shopAnchor}
          pins={pins}
          clusterLabel={t("diveSites.map.clusterLabel")}
          followLabel={t("diveSites.list.followMap")}
          areaCount={t("diveSites.list.areaCount", { count: sitePage.total })}
          scoped={Boolean(filters.area)}
          baseHref={withoutArea}
        >
          {sites.length === 0 ? (
            <EmptyState
              title={t("diveSites.list.noMatchHeading")}
              body={t(narrowed ? "diveSites.list.noMatchFilteredBody" : "diveSites.list.emptyBody")}
              action={
                narrowed ? (
                  <Link
                    href={clearFiltersHref}
                    scroll={false}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("diveSites.list.clearFilters")}
                  </Link>
                ) : null
              }
              className="mt-4"
            />
          ) : (
            <>
              <SiteLibraryLedger
                groups={groupSiteLibrary(sites)}
                shopSlug={shopSlug}
                t={t}
                diverT={diverT}
                depthUnit={shop.depthUnit}
                currentTemplateVersion={currentTemplateVersion}
              />

              <Pager
                page={sitePage.page}
                pageCount={sitePage.pageCount}
                href={pageHref}
                total={t("diveSites.list.pagination.total", { count: sitePage.total })}
                words={staffPagerWords(t)}
              />
            </>
          )}
        </SiteLibraryLayout>
      )}
    </StaffPage>
  );
}
