import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { buttonClass } from "@/components/ui/button";
import { SearchField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";
import {
  countGlobalDiveSiteTemplates,
  currentGlobalDiveSiteVersions,
  diveSiteLibrarySize,
  groupSiteLibrary,
  listDiveSitesPage,
  shopSearchAnchor,
} from "@/db/dive-sites";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { timeZoneAnchor } from "@/lib/timezones";
import { CatalogView } from "./_components/CatalogView";
import { SiteLibraryLayout } from "./_components/SiteLibraryLayout";
import { SiteLibraryLedger } from "./_components/SiteLibraryLedger";

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

export const metadata: Metadata = { title: "Dive sites — DiveDay" };

export default async function DiveSitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    q?: string;
    page?: string;
    view?: string;
    template?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { notice, q, page, view, template } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // A template's field guide is diver copy, so the catalog preview reads it
  // through the diver bundle -- in the staffer's own language, same locale.
  const diverT = diverTranslator(locale);

  // The published site catalog re-sorts nothing of the library's own evidence
  // — it is DiveDay's own dataset — but it was reachable from exactly two
  // buttons on this page and nowhere else, so it earns the same treatment as
  // Not ready (ADR 20260803-not-ready-is-a-view / 20260806-dive-site-catalog-is-a-view):
  // one route, a `?view=` switch, and a 308 from the URL it used to own.
  if (view === "catalog") {
    return (
      <CatalogView
        shopSlug={shopSlug}
        shop={shop}
        db={db}
        t={t}
        diverT={diverT}
        page={page}
        slug={template}
      />
    );
  }

  // A non-numeric or missing `?page=` reads as page 1 rather than NaN.
  const requestedPage = Number.parseInt(page ?? "", 10);
  const query = q?.trim() ?? "";
  const [sitePage, librarySize, catalogSize, rawAnchor] = await Promise.all([
    listDiveSitesPage(
      db,
      shop.id,
      { query: query || undefined },
      { page: Number.isFinite(requestedPage) ? requestedPage : 1 },
    ),
    // Shop-wide, never page- or search-scoped. It answers one question — does
    // this shop have a library yet? — which is what separates the day-one
    // empty state from a search that simply matched nothing.
    diveSiteLibrarySize(db, shop.id),
    // The tail door's number, over the whole published catalog — never the
    // `total` of a page nobody has fetched yet (ADR 20260827-the-shops-shelves).
    countGlobalDiveSiteTemplates(db),
    shopSearchAnchor(db, shop.id),
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

  const anchorCoords = rawAnchor ?? timeZoneAnchor(shop.timezone);
  const shopAnchor: ShopAnchor | null = anchorCoords
    ? {
        latitude: anchorCoords.latitude,
        longitude: anchorCoords.longitude,
        name: shop.name,
      }
    : null;

  const pins: MapPin[] = sites
    .filter(
      (site): site is typeof site & { forecastLatitude: number; forecastLongitude: number } =>
        site.forecastLatitude != null && site.forecastLongitude != null,
    )
    .map((site) => ({
      id: site.id,
      name: site.name,
      latitude: site.forecastLatitude,
      longitude: site.forecastLongitude,
      subtitle: site.locationName,
      href: `/shop/${shopSlug}/dive-sites/${site.id}`,
      tone:
        site.difficultyLevel === "advanced"
          ? "warning"
          : site.difficultyLevel === "beginner"
            ? "primary"
            : "default",
    }));

  /** This page's URL with the search kept and only `page` swapped. */
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (target > 1) search.set("page", String(target));
    const encoded = search.toString();
    return encoded ? `/shop/${shopSlug}/dive-sites?${encoded}` : `/shop/${shopSlug}/dive-sites`;
  };
  const catalogHref = `/shop/${shopSlug}/dive-sites?view=catalog`;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={shopPath(shopSlug, "settings")}
        title={t("diveSites.list.title")}
        // An empty library gets no header action: the empty card below is
        // already the whole page, and it carries both doors. Two identical
        // primaries on one screen is what principle 8 forbids — so the card
        // owns them until there is a library to act on.
        //
        // One action, not two: the catalog's "Browse templates" secondary
        // retired the day the ledger grew its own tail door (ADR
        // 20260827-the-shops-shelves), which is where a shop looking for a site
        // it has not written yet is already looking.
        actions={
          librarySize === 0 ? undefined : (
            <Link href={`/shop/${shopSlug}/dive-sites/new`} className={buttonClass()}>
              {t("diveSites.list.createSite")}
            </Link>
          )
        }
      />

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      {/* Unconditional once there is anything to search: a library that hid
        its search box below some size would teach staff to scroll, and the
        one shop that grows past a screenful is exactly the one that never
        learned the box exists. Hidden only when the library is empty, where
        the empty state has the single thing to do. */}
      {librarySize > 0 ? (
        <QueryForm
          aria-label={t("diveSites.list.searchAriaLabel")}
          // A toolbar, not a card: the one search box every staff list wears
          // (`SearchField`), and beside it only the way back out. The bordered
          // band with a "Find a site" caption and a Search button that stood
          // here was the third grammar for the same control in the app.
          className="mb-6 flex items-center gap-2"
        >
          <SearchField
            id="site-search"
            name="q"
            label={t("diveSites.list.searchLabel")}
            defaultValue={query}
            placeholder={t("diveSites.list.searchPlaceholder")}
            className="w-full min-w-0 sm:w-80"
          />
          {query ? (
            // The drawn cross every remove control shares (the crew row's
            // unassign, the builder's crew chip), through the shared
            // `size: "icon"` box rather than a hand-spelled square — 48px,
            // the same construction as the report navigator's arrows, the
            // mark at the field's 16px. The words survive as the accessible
            // name, so nothing is lost to a screen reader or to the e2e spec
            // that clicks it by name.
            <Link
              href={`/shop/${shopSlug}/dive-sites`}
              scroll={false}
              aria-label={t("diveSites.list.searchClear")}
              title={t("diveSites.list.searchClear")}
              className={buttonClass({ variant: "ghost", size: "icon" })}
            >
              <DiveDayIcon name="close" className="size-4" />
            </Link>
          ) : null}
        </QueryForm>
      ) : null}

      {sites.length === 0 ? (
        <EmptyState
          title={query ? t("diveSites.list.noMatchHeading") : t("diveSites.list.emptyHeading")}
          body={t("diveSites.list.emptyBody")}
          action={
            query || librarySize > 0 ? null : (
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
                <Link href={`/shop/${shopSlug}/dive-sites/new`} className={buttonClass()}>
                  {t("diveSites.list.createSite")}
                </Link>
              </>
            )
          }
          className="mt-4"
        />
      ) : (
        <SiteLibraryLayout shopAnchor={shopAnchor} pins={pins} empty={sites.length === 0}>
          <SiteLibraryLedger
            groups={groupSiteLibrary(sites)}
            shopSlug={shopSlug}
            t={t}
            diverT={diverT}
            depthUnit={shop.depthUnit}
            currentTemplateVersion={currentTemplateVersion}
            // The tail door renders only when there is something behind it. A
            // catalog DiveDay has not published into yet would otherwise offer a
            // shop a page of nothing at the foot of its own library.
            catalog={catalogSize > 0 ? { href: catalogHref, count: catalogSize } : null}
          />

          <Pager
            page={sitePage.page}
            pageCount={sitePage.pageCount}
            href={pageHref}
            total={t("diveSites.list.pagination.total", { count: sitePage.total })}
            words={staffPagerWords(t)}
          />
        </SiteLibraryLayout>
      )}
    </main>
  );
}
