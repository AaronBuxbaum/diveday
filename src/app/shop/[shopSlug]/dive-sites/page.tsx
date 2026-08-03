import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listDiveSites, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
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
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const [sites, templates] = await Promise.all([
    listDiveSites(db, shop.id),
    listGlobalDiveSiteTemplates(db),
  ]);
  const currentTemplateVersion = new Map(
    templates.map(({ template, version }) => [template.id, version.version]),
  );

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

      {/* Three tiles reading 0 / 0 / 0 teach a day-one shop nothing it doesn't
          already know from the empty list below, and they push the one thing
          that helps — the way to add a site — below the fold. The overview
          returns the moment there is anything to count. */}
      {sites.length === 0 ? null : (
        <section
          aria-label={t("diveSites.list.overviewAriaLabel")}
          className="mb-8 grid gap-3 sm:grid-cols-3"
        >
          <ShopStat
            label={t("diveSites.list.savedSites")}
            value={sites.length}
            detail={t("diveSites.list.savedSitesDetail")}
            tone="primary"
          />
          <ShopStat
            label={t("diveSites.list.withForecastPoints")}
            value={
              sites.filter(
                (site) => site.forecastLatitude !== null && site.forecastLongitude !== null,
              ).length
            }
            detail={t("diveSites.list.withForecastPointsDetail")}
            tone="success"
          />
          <ShopStat
            label={t("diveSites.list.fromTemplates")}
            value={sites.filter((site) => site.sourceTemplateId).length}
            detail={t("diveSites.list.fromTemplatesDetail")}
          />
        </section>
      )}

      {notice === "archived" ? (
        <div className="mt-4">
          <ShopNotice>{t("diveSites.list.siteArchivedNotice")}</ShopNotice>
        </div>
      ) : null}

      {sites.length === 0 ? (
        // Both header actions again, inside the card: on an empty catalog the
        // header is the only place they exist, and a shop reading "start with a
        // site your crew knows well" should be able to start from that sentence.
        <EmptyState className="mt-4">
          <h2 className="font-semibold">{t("diveSites.list.emptyHeading")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {t("diveSites.list.emptyBody")}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
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
          </div>
        </EmptyState>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                <p className="mt-1 text-sm text-muted">{site.locationName ?? "Location to add"}</p>
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
                      {site.minimumCertificationLevel.replaceAll("_", " ")}
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
    </main>
  );
}
