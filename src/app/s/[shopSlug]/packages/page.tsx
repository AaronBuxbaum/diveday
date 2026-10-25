import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listPackagesOnSale } from "@/db/dive-packages";
import { shopBySlugCached } from "@/db/shops-cached";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestTranslator } from "@/i18n/request";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicPackagesPath, publicSchedulePath } from "@/lib/public-routes";
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
    robots: shopSearchListingRobots(shop),
    openGraph: { ...openGraphSite, title, description, url: canonical },
  };
}

/**
 * The shop's prepaid dive packages, bought online (ADR
 * 20260822-a-package-is-entitlements-not-money). Reached from the public nav,
 * which offers the tab only while something here is on sale. A shop with
 * nothing on sale still answers the URL, with a quiet line and a door to the
 * schedule: a link a diver was sent, or a package that just sold out, used to
 * land on a 404 (UX review 2026-10-10, item 18).
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
  // Switched off on the Features page: no price list, like any other page a
  // shop does not offer.
  if (!shop?.divePackagesEnabled) notFound();
  const packages = await listPackagesOnSale(db, shop.id);

  const { locale, t } = await requestTranslator(shop.defaultLocale);
  if (packages.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader title={t("packages.title")} />
        <EmptyState
          title={t("packages.none")}
          action={
            <Link
              href={publicSchedulePath(shop.slug)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("common.backToSchedule")}
            </Link>
          }
        />
      </main>
    );
  }
  const currency = toShopCurrency(shop.currency);
  const money = (cents: number) => formatMoneyScanned(cents, currency, locale);
  const scopeText = (scope: (typeof packages)[number]["scope"]) =>
    scope === "all" ? t("packages.scopeAll") : t("packages.scopeFunDives");
  const sharedScope = packages.every((pkg) => pkg.scope === packages[0]?.scope)
    ? (packages[0]?.scope ?? null)
    : null;
  const offers: PackageOffer[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    priceText: money(pkg.priceCents),
    facts: [
      t("packages.dives", { count: pkg.diveCount }),
      t("packages.perDive", { amount: money(Math.round(pkg.priceCents / pkg.diveCount)) }),
      // Whether the card runs out is part of a few-hundred-dollar decision, so it is said
      // either way (third UX review, item 28).
      pkg.validUntil
        ? t("packages.useBy", { date: formatCalendarDate(pkg.validUntil, locale) })
        : t("packages.noExpiry"),
      // What it covers, on the card only when the cards differ; said once in
      // the intro when every card says the same (visual review 2026-10-24, B39).
      ...(sharedScope ? [] : [scopeText(pkg.scope)]),
    ],
    // A dive is one tank (H-123): said on the card, where the $200 is decided.
    tankNote: t("packages.diveIsATank"),
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* No eyebrow: the public nav already marks Packages current, as it
          does Courses. */}
      {/* What a package is, said once above the first card: the sentence
          lived only in the meta description (third UX review, item 28). */}
      <ShopPageHeader
        title={t("packages.title")}
        description={
          sharedScope
            ? t("packages.introWithScope", {
                intro: t("packages.intro"),
                scope: scopeText(sharedScope),
              })
            : t("packages.intro")
        }
      />
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
