import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ReviewCards } from "@/components/ShopReviews";
import { StarRating } from "@/components/StarRating";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopReviewAggregate, listPublishedShopReviewsPage } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import { requestTranslator } from "@/i18n/request";
import { publicReviewsPath, publicSchedulePath } from "@/lib/public-routes";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) return { title: "Reviews — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = t("reviews.allDescription");
  const canonical = publicReviewsPath(shop.slug);
  return {
    title: `${t("reviews.allTitle")} — ${shop.name}`,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop.searchListingOptOutAt),
    openGraph: {
      ...openGraphSite,
      title: `${t("reviews.allTitle")} — ${shop.name}`,
      description,
      url: canonical,
    },
  };
}

/** The public archive of written reviews, without trip names. */
export default async function PublicReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await connection();
  const { shopSlug } = await params;
  const { page } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const [aggregate, reviewPage] = await Promise.all([
    getShopReviewAggregate(db, shop.id),
    listPublishedShopReviewsPage(db, shop.id, {
      page: Number.parseInt(page ?? "", 10),
    }),
  ]);
  const base = publicReviewsPath(shop.slug);
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);
  const timezone = shop.timezone ?? "UTC";
  const average = aggregate.average;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("reviews.sectionTitle")}
        eyebrowHref={publicSchedulePath(shop.slug)}
        title={t("reviews.allTitle")}
        description={t("reviews.allDescription")}
        actions={
          <Link
            href={publicSchedulePath(shop.slug)}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("reviews.backToSchedule")}
          </Link>
        }
      />

      <section aria-label={t("reviews.sectionTitle")}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {average !== null ? (
            <StarRating
              rating={Math.round(average)}
              label={t("reviews.ratingOption", { rating: Math.round(average) })}
            />
          ) : null}
          <span className="tabular-nums">
            {average !== null ? `${t("reviews.average", { average: average.toFixed(1) })} · ` : ""}
            {t("reviews.count", { count: aggregate.count })}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">{t("reviews.verifiedNote")}</p>

        {reviewPage.total === 0 ? (
          <EmptyState title={t("reviews.allEmptyHeading")} />
        ) : (
          <ReviewCards
            reviews={reviewPage.reviews}
            locale={locale}
            timezone={timezone}
            t={t}
            showTrip={false}
          />
        )}
      </section>

      {reviewPage.pageCount > 1 ? (
        <nav
          aria-label={t("reviews.paginationLabel")}
          className="mt-6 flex items-center justify-between gap-3"
        >
          {reviewPage.page > 1 ? (
            <Link
              href={pageHref(reviewPage.page - 1)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("reviews.previousPage")}
            </Link>
          ) : (
            <span />
          )}
          <p className="text-sm text-muted">
            {t("reviews.pagePosition", {
              page: reviewPage.page,
              pageCount: reviewPage.pageCount,
            })}
          </p>
          {reviewPage.page < reviewPage.pageCount ? (
            <Link
              href={pageHref(reviewPage.page + 1)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("reviews.nextPage")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
