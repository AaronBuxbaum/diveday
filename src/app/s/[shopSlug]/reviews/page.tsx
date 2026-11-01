import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ReviewLedger } from "@/components/ShopReviews";
import { StarRating } from "@/components/StarRating";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { getDb } from "@/db/client";
import {
  getShopRatingDistribution,
  getShopReviewAggregate,
  listPublishedShopReviewsPage,
} from "@/db/reviews";
import { shopBySlugCached } from "@/db/shops-cached";
import { requestTranslator } from "@/i18n/request";
import { cachedFormatter } from "@/lib/intl-cache";
import { publicReviewsPath, publicSchedulePath } from "@/lib/public-routes";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return { title: "Reviews — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = t("reviews.allDescription");
  const canonical = publicReviewsPath(shop.slug);
  return {
    title: `${t("reviews.allTitle")} — ${shop.name}`,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop),
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
  const shop = await shopBySlugCached(shopSlug);
  // Off, the archive is not there at all (ADR 20261005-optional-shop-features).
  if (!shop?.reviewsEnabled) notFound();

  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const [aggregate, reviewPage, distribution] = await Promise.all([
    getShopReviewAggregate(db, shop.id),
    listPublishedShopReviewsPage(db, shop.id, {
      page: Number.parseInt(page ?? "", 10),
    }),
    getShopRatingDistribution(db, shop.id),
  ]);
  const base = publicReviewsPath(shop.slug);
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);
  const timezone = shop.timezone ?? "UTC";
  const average = aggregate.average;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10 print:py-3">
      {/* Keep the description in metadata; repeating it below the title adds
          no information. */}
      {/* The eyebrow is the single way back to the schedule (principle 10). */}
      <ShopPageHeader
        eyebrow={t("reviews.sectionTitle")}
        eyebrowHref={publicSchedulePath(shop.slug)}
        title={t("reviews.allTitle")}
      />

      <section aria-label={t("reviews.sectionTitle")}>
        {/* Show the aggregate once, with the stars, average and count together
            (ADR 20260827-clearwater-surface-language, decisions 8 and 11). */}
        {average !== null ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <StarRating
              rating={Math.round(average)}
              label={t("reviews.ratingOption", { rating: Math.round(average) })}
              tone="accent"
              className="text-base"
            />
            <span className="text-base font-semibold text-foreground tabular-nums">
              {cachedFormatter("num", Intl.NumberFormat, locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(average)}
            </span>
            {/* Keep rating and written-review counts distinct. */}
            <span className="tabular-nums">
              {reviewPage.total > 0
                ? t("reviews.ratingsAndReviews", {
                    ratings: aggregate.count,
                    reviews: reviewPage.total,
                  })
                : t("reviews.ratingsCount", { count: aggregate.count })}
            </span>
          </p>
        ) : null}

        {/* Show bare ratings as counted rows; the paged ledger below contains
            written reviews. Counts carry the data (principle 6); bars are
            decorative and hidden from assistive technology. */}
        {average !== null ? (
          <ul className="mt-4 flex max-w-sm flex-col gap-1.5">
            {/* Render only ratings present in the distribution. */}
            {[5, 4, 3, 2, 1].map((rating) => {
              const ratingCount = distribution.get(rating) ?? 0;
              if (ratingCount === 0) return null;
              return (
                <li key={rating} className="flex items-center gap-3 text-sm tabular-nums">
                  {/* Expose a localized rating name; the numeral and star are
                      visual presentation. */}
                  <span className="sr-only">{t("reviews.ratingOption", { rating })}</span>
                  <span className="w-6 text-end" aria-hidden="true">
                    {rating}
                    {/* i18n-exempt: the star dingbat is a symbol, identical in every language */}
                    <span>★</span>
                  </span>
                  <ProgressBar
                    aria-hidden="true"
                    className="h-[5px] flex-1"
                    segments={[
                      {
                        key: "share",
                        fraction: aggregate.count > 0 ? ratingCount / aggregate.count : 0,
                        className: "bg-muted",
                      },
                    ]}
                  />
                  <span className="w-8 text-muted">{ratingCount}</span>
                </li>
              );
            })}
          </ul>
        ) : null}

        {/* Empty only when there are no ratings or written reviews. */}
        {reviewPage.total === 0 && average === null ? (
          <EmptyState title={t("reviews.allEmptyHeading")} className="mt-4" />
        ) : null}
        {reviewPage.total > 0 ? (
          <ReviewLedger
            reviews={reviewPage.reviews}
            locale={locale}
            timezone={timezone}
            t={t}
            showTrip={false}
          />
        ) : null}
      </section>

      {/* Shared pager owns its layout and omits itself on a single page. */}
      <Pager
        page={reviewPage.page}
        pageCount={reviewPage.pageCount}
        href={pageHref}
        words={{
          label: t("reviews.paginationLabel"),
          previous: t("reviews.previousPage"),
          next: t("reviews.nextPage"),
          position: (page, pageCount) => t("reviews.pagePosition", { page, pageCount }),
        }}
      />
    </main>
  );
}
