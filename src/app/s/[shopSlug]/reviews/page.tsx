import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ReviewLedger } from "@/components/ShopReviews";
import { StarRating } from "@/components/StarRating";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopReviewAggregate, listPublishedShopReviewsPage } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
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
      {/* No standing description under the title. `reviews.allDescription`
          said "read what divers who were on the boat said about their day" —
          which is the page's own name plus the verification claim the aggregate
          line below already carries, and it is still the metadata description
          where a search result genuinely needs the sentence. */}
      <ShopPageHeader
        eyebrow={t("reviews.sectionTitle")}
        eyebrowHref={publicSchedulePath(shop.slug)}
        title={t("reviews.allTitle")}
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
        {/* **The aggregate, exactly once** (ADR
            20260827-clearwater-surface-language, decision 8): the stars, the
            figure, the count and the claim that makes the number mean anything,
            on one line — where it used to be a star row, a second line
            repeating the average and count, and a third line for the claim. The
            fill is `--accent` because this is a public page and a filled rating
            star is data ink (decision 11). */}
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
            <span className="tabular-nums">
              {t("reviews.count", { count: aggregate.count })} · {t("reviews.verifiedNote")}
            </span>
          </p>
        ) : null}

        {reviewPage.total === 0 ? (
          <EmptyState title={t("reviews.allEmptyHeading")} className="mt-4" />
        ) : (
          <ReviewLedger
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
