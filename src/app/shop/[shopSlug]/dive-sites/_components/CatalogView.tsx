import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import { getDb } from "@/db/client";
import {
  getGlobalDiveSiteTemplate,
  listGlobalDiveSiteTemplates,
  shopSearchAnchor,
} from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import type { DiverTranslator } from "@/i18n/messages";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { joinFacts } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { timeZoneAnchor } from "@/lib/timezones";
import { importDiveSiteTemplateAction } from "../actions";
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
  t,
  diverT,
  page,
  slug,
}: {
  shopSlug: string;
  t: StaffTranslator;
  diverT: DiverTranslator;
  page?: string;
  /** A template to open in full before deciding — `?view=catalog&template=<slug>`. */
  slug?: string;
}) {
  const back = shopPath(shopSlug, "dive-sites");
  const catalogHref = `${back}?view=catalog`;
  const activeSession = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, activeSession.user.shopId);
  const locationIsProvided = !!(shop.addressStreet && shop.addressLocality);

  if (!locationIsProvided) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
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
      </main>
    );
  }

  const [catalog, rawAnchor] = await Promise.all([
    listGlobalDiveSiteTemplates(db, {
      page: Number.parseInt(page ?? "", 10),
      shop,
    }),
    shopSearchAnchor(db, shop.id),
  ]);
  const pageHref = (target: number) => (target > 1 ? `${catalogHref}&page=${target}` : catalogHref);

  const previewSlug = slug?.trim();
  const preview = previewSlug ? await getGlobalDiveSiteTemplate(db, previewSlug, shop) : null;
  if (previewSlug && preview) {
    return (
      <TemplatePreview
        template={preview}
        backHref={catalogHref}
        importAction={importDiveSiteTemplateAction}
        t={t}
        diverT={diverT}
        depthUnit={shop.depthUnit}
      />
    );
  }

  const anchorCoords = rawAnchor ?? timeZoneAnchor(shop.timezone);
  const shopAnchor: ShopAnchor | null = anchorCoords
    ? {
        latitude: anchorCoords.latitude,
        longitude: anchorCoords.longitude,
        name: shop.name,
      }
    : null;

  const catalogPins: MapPin[] = catalog.templates
    .filter(
      (entry) =>
        entry.version.briefing.forecastLatitude != null &&
        entry.version.briefing.forecastLongitude != null,
    )
    .map(({ template, version }) => ({
      id: template.id,
      name: version.briefing.name,
      latitude: version.briefing.forecastLatitude as number,
      longitude: version.briefing.forecastLongitude as number,
      subtitle: version.briefing.locationName,
      href: `${catalogHref}&template=${encodeURIComponent(template.slug)}`,
      tone: "primary",
    }));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div>
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
          eyebrowHref={back}
          title={t("diveSites.catalog.title")}
          description={t("diveSites.catalog.description")}
          descriptionIsCaption
        />
      </div>
      <CatalogMapLayout shopAnchor={shopAnchor} pins={catalogPins}>
        <ul className="space-y-1">
          {catalog.templates.map(({ template, version }) => (
            <li id={`template-row-${template.id}`} key={template.id}>
              <LedgerRow
                href={`${catalogHref}&template=${encodeURIComponent(template.slug)}`}
                linkLabel={version.briefing.name}
                stacked
                pad="lg"
                trailing={
                  <form action={importDiveSiteTemplateAction}>
                    <input type="hidden" name="templateId" value={template.id} />
                    <SubmitButton
                      pendingLabel={t("diveSites.catalog.importing")}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("diveSites.catalog.importToLibrary")}
                    </SubmitButton>
                  </form>
                }
              >
                <div className="min-w-0">
                  <p className="font-medium">{version.briefing.name}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {joinFacts([
                      version.briefing.locationName,
                      t("diveSites.catalog.templateVersion", { version: version.version }),
                    ])}
                  </p>
                  {version.briefing.description ? (
                    <p className="mt-1 text-sm text-muted">{version.briefing.description}</p>
                  ) : null}
                </div>
              </LedgerRow>
            </li>
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
    </main>
  );
}
