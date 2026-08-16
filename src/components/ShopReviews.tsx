import Link from "next/link";
import { StarRating } from "@/components/StarRating";
import { SectionCard } from "@/components/ui/card";
import type { PublicReview } from "@/db/reviews";
import type { DiverTranslator } from "@/i18n/messages";
import { formatShortDate } from "@/lib/format";
import { publicReviewsPath } from "@/lib/public-routes";
import type { ReviewAggregate } from "@/lib/reviews";

/**
 * The shop's published reviews on its public schedule. Rendered only when
 * something is actually published — an empty "no reviews yet" panel on a new
 * shop's page reads as a warning, not as neutral.
 *
 * Every string here comes from the caller's localized dictionary. Diver-written
 * comments are rendered as plain React text children, never as markup.
 */
export function ShopReviews({
  aggregate,
  reviews,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  aggregate: ReviewAggregate;
  reviews: PublicReview[];
  shopSlug: string;
  locale: string;
  timezone: string;
  t: DiverTranslator;
}) {
  if (aggregate.average === null || aggregate.count === 0) return null;
  // ICU picks the singular/plural form, so "1 review" vs "2 reviews" (and the
  // Spanish equivalents) is the translator's decision, not a ternary here.
  const roundedAverage = Math.round(aggregate.average);

  return (
    <section aria-labelledby="shop-reviews" className="mt-10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="shop-reviews" className="text-lg font-semibold">
          {t("reviews.sectionTitle")}
        </h2>
        <p className="flex items-center gap-2 text-sm text-muted">
          <StarRating
            rating={roundedAverage}
            label={t("reviews.ratingOption", { rating: roundedAverage })}
          />
          <span className="tabular-nums">
            {t("reviews.average", { average: aggregate.average.toFixed(1) })} ·{" "}
            <Link href={publicReviewsPath(shopSlug)} className="hover:underline">
              {t("reviews.count", { count: aggregate.count })}
            </Link>
          </span>
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">{t("reviews.verifiedNote")}</p>
      <ReviewCards reviews={reviews} locale={locale} timezone={timezone} t={t} preview />
    </section>
  );
}

/** Shared public cards; the archive intentionally omits the trip title. */
export function ReviewCards({
  reviews,
  locale,
  timezone,
  t,
  showTrip = true,
  preview = false,
}: {
  reviews: PublicReview[];
  locale: string;
  timezone: string;
  t: DiverTranslator;
  showTrip?: boolean;
  /** Keep the schedule compact on a phone while showing the full 2x2 preview on wide screens. */
  preview?: boolean;
}) {
  if (reviews.length === 0) return null;
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {reviews.map((review, index) => (
        <SectionCard
          as="li"
          key={review.id}
          className={preview && index >= 3 ? "hidden sm:block" : undefined}
        >
          <StarRating
            rating={review.rating}
            label={t("reviews.ratingOption", { rating: review.rating })}
            className="text-sm"
          />
          {review.comment ? <p className="mt-2 text-base text-pretty">{review.comment}</p> : null}
          <p className="mt-3 text-sm text-muted">
            {review.reviewer || t("reviews.anonymousReviewer")}
            {showTrip ? ` · ${review.tripTitle}` : null} ·{" "}
            {formatShortDate(review.divedAt, locale, timezone)}
          </p>
        </SectionCard>
      ))}
    </ul>
  );
}
