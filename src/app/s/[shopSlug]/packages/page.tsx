import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listPackagesOnSale } from "@/db/dive-packages";
import { shopBySlugCached } from "@/db/shops-cached";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestTranslator } from "@/i18n/request";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicPackagesPath } from "@/lib/public-routes";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { type PackageOffer, PackagePurchaseForm } from "./_components/PackagePurchaseForm";

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return { title: "Dive packages — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = t("packages.metaDescription", { shopName: shop.name });
  const canonical = publicPackagesPath(shop.slug);
  const title = `${t("packages.title")} — ${shop.name}`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop.searchListingOptOutAt),
    openGraph: { ...openGraphSite, title, description, url: canonical },
  };
}

/**
 * The shop's prepaid dive packages, bought online (ADR
 * 20260822-a-package-is-entitlements-not-money). Reached from the public nav,
 * which offers the tab only while something here is on sale; a shop with
 * nothing on sale has no page at all, so the URL is a 404 rather than an empty
 * shelf.
 */
export default async function PublicPackagesPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  await connection(); // the price list can change between requests
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();
  const packages = await listPackagesOnSale(db, shop.id);
  if (packages.length === 0) notFound();

  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const currency = toShopCurrency(shop.currency);
  const money = (cents: number) => formatMoneyScanned(cents, currency, locale);
  const offers: PackageOffer[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    priceText: money(pkg.priceCents),
    facts: [
      t("packages.dives", { count: pkg.diveCount }),
      t("packages.perDive", { amount: money(Math.round(pkg.priceCents / pkg.diveCount)) }),
      pkg.scope === "all" ? t("packages.scopeAll") : t("packages.scopeFunDives"),
      pkg.validUntil
        ? t("packages.useBy", { date: formatCalendarDate(pkg.validUntil, locale) })
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* No eyebrow: the public nav already marks Packages current, as it
          does Courses. */}
      <ShopPageHeader title={t("packages.title")} />
      <DiverIntlProvider
        locale={locale}
        timeZone={shop.timezone ?? "UTC"}
        namespaces={["packages", "common"]}
      >
        <PackagePurchaseForm shopSlug={shop.slug} offers={offers} />
      </DiverIntlProvider>
    </main>
  );
}
