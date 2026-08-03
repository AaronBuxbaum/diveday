import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  diveSiteLibraryStats,
  listDiveSitesPage,
  listGlobalDiveSiteTemplates,
} from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireStaffSession } from "@/lib/session";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Dive sites — DiveDay" };

export default async function DiveSitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; q?: string; page?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, q, page } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const query = q?.trim() ?? "";
  // A non-numeric or missing `?page=` reads as page 1 rather than NaN.
  const requestedPage = Number.parseInt(page ?? "", 10);
  const [sitePage, stats, templates] = await Promise.all([
    listDiveSitesPage(
      db,
      shop.id,
      { query: query || undefined },
      { page: Number.isFinite(requestedPage) ? requestedPage : 1 },
    ),
    // Shop-wide, never page-scoped: the counters describe the library, and a
    // search must not make a shop look like it lost half its sites.
    diveSiteLibraryStats(db, shop.id),
    listGlobalDiveSiteTemplates(db),
  ]);
  const sites = sitePage.rows;
  const currentTemplateVersion = new Map(
    templates.map(({ template, version }) => [template.id, version.version]),
  );

  /** This page's URL with the search kept and only `page` swapped. */
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (target > 1) search.set("page", String(target));
    const encoded = search.toString();
    return encoded ? `/shop/${shopSlug}/dive-sites?${encoded}` : `/shop/${shopSlug}/dive-sites`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("diveSites.catalogEyebrow")}
        title={t("diveSites.list.title")}
        description={t("diveSites.list.description")}
        actions={
          <>
            <Link
              href={`/shop/${shopSlug}/dive-sites/new`}
              className={buttonClass({ className: "rounded-xl" })}
            >
              <span aria-hidden="true">+</span> {t("diveSites.list.createSite")}
            </Link>
            <Link
              href={`/shop/${shopSlug}/dive-sites/catalog`}
              className={buttonClass({ variant: "secondary", className: "rounded-xl" })}
            >
              {t("diveSites.list.browseTemplates")}
            </Link>
          </>
        }
      />

      <section
        aria-label={t("diveSites.list.overviewAriaLabel")}
        className="mb-8 grid gap-3 sm:grid-cols-3"
      >
        <ShopStat
          label={t("diveSites.list.savedSites")}
          value={stats.total}
          detail={t("diveSites.list.savedSitesDetail")}
          tone="primary"
        />
        <ShopStat
          label={t("diveSites.list.withForecastPoints")}
          value={stats.withForecastPoints}
          detail={t("diveSites.list.withForecastPointsDetail")}
          tone="success"
        />
        <ShopStat
          label={t("diveSites.list.fromTemplates")}
          value={stats.fromTemplates}
          detail={t("diveSites.list.fromTemplatesDetail")}
        />
      </section>

      {/* Unconditional once there is anything to search: a library that hid
        its search box below some size would teach staff to scroll, and the
        one shop that grows past a screenful is exactly the one that never
        learned the box exists. Hidden only when the library is empty, where
        the empty state has the single thing to do. */}
      {stats.total > 0 ? (
        <FieldGrid
          as="form"
          aria-label={t("diveSites.list.searchAriaLabel")}
          columns={2}
          className="mb-6 rounded-lg border border-border bg-surface p-4"
        >
          <Field label={t("diveSites.list.searchLabel")}>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("diveSites.list.searchPlaceholder")}
              maxLength={120}
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <button type="submit" className={buttonClass({ size: "sm" })}>
              {t("diveSites.list.searchApply")}
            </button>
            {query ? (
              <Link
                href={`/shop/${shopSlug}/dive-sites`}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "text-foreground",
                })}
              >
                {t("diveSites.list.searchClear")}
              </Link>
            ) : null}
          </FieldActions>
        </FieldGrid>
      ) : null}

      {notice === "archived" ? (
        <div className="mt-4">
          <ShopNotice>{t("diveSites.list.siteArchivedNotice")}</ShopNotice>
        </div>
      ) : null}

      {sites.length === 0 ? (
        <EmptyState className="mt-4">
          <h2 className="font-semibold">
            {query ? t("diveSites.list.noMatchHeading") : t("diveSites.list.emptyHeading")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {query ? t("diveSites.list.noMatchBody") : t("diveSites.list.emptyBody")}
          </p>
        </EmptyState>
      ) : (
        <ul
          aria-label={t("diveSites.list.gridAriaLabel")}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/shop/${shopSlug}/dive-sites/${site.id}`}
                className="group block h-full rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface-sunken"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold group-hover:text-primary">{site.name}</h2>
                  <span
                    aria-hidden="true"
                    className="text-primary transition-transform group-hover:translate-x-1"
                  >
                    →
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {site.locationName || t("diveSites.list.locationToAdd")}
                </p>
                {site.sourceTemplateVersion ? (
                  <p className="mt-2 text-xs font-medium text-primary">
                    {(currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? 0) >
                    site.sourceTemplateVersion
                      ? t("diveSites.list.templateUpdateReady", {
                          version: currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? "",
                        })
                      : t("diveSites.list.diveDayTemplateVersion", {
                          version: site.sourceTemplateVersion,
                        })}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {site.minimumCertificationLevel ? (
                    <Badge tone="primary" size="sm">
                      {t(CERTIFICATION_LEVEL_KEYS[site.minimumCertificationLevel])}
                    </Badge>
                  ) : null}
                  {site.requiresNitrox ? (
                    <Badge tone="warning" size="sm">
                      {t("diveSites.list.nitroxBadge")}
                    </Badge>
                  ) : null}
                  {site.requiredSpecialties.length > 0 ? (
                    <Badge tone="neutral" size="sm">
                      {site.requiredSpecialties.length === 1
                        ? t("diveSites.list.oneRequiredSpecialty")
                        : t("diveSites.list.manyRequiredSpecialties", {
                            count: site.requiredSpecialties.length,
                          })}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-4 line-clamp-2 text-sm text-muted">
                  {site.marineLife || site.description || t("diveSites.list.addBriefingFallback")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Only when there is somewhere to go — a shop with one screenful of
        sites should not be told it is on "page 1 of 1". */}
      {sitePage.pageCount > 1 ? (
        <nav
          aria-label={t("diveSites.list.pagination.label")}
          className="mt-4 flex items-center justify-between gap-3"
        >
          {sitePage.page > 1 ? (
            <Link
              href={pageHref(sitePage.page - 1)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("diveSites.list.pagination.previous")}
            </Link>
          ) : (
            <span />
          )}
          <p className="text-sm text-muted">
            {t("diveSites.list.pagination.position", {
              page: sitePage.page,
              pageCount: sitePage.pageCount,
              total: sitePage.total,
            })}
          </p>
          {sitePage.page < sitePage.pageCount ? (
            <Link
              href={pageHref(sitePage.page + 1)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("diveSites.list.pagination.next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
