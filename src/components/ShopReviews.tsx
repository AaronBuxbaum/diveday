import Link from "next/link";
import { StarRating } from "@/components/StarRating";
import { LedgerRow } from "@/components/ui/ledger";
import type { PublicReview } from "@/db/reviews";
import type { DiverTranslator } from "@/i18n/messages";
import { formatShortDate } from "@/lib/format";
import { publicReviewsPath } from "@/lib/public-routes";
import type { ReviewAggregate } from "@/lib/reviews";

/** How many quotes the storefront's shelf carries before it hands over to the archive. */
const SHELF_QUOTES = 2;

/**
 * **The reviews shelf on the shopfront** (ADR
 * 20260827-clearwater-surface-language, decision 8). Rendered only when
 * something is actually published — an empty "no reviews yet" panel on a new
 * shop's page reads as a warning rather than as neutral.
 *
 * **The aggregate is said once, and it is said in the hero**, not here. This
 * band used to open with the stars, the average and the count, two hundred
 * pixels below a masthead that said nothing about the shop at all; the
 * recomposition puts the rating line where the shop's identity is and leaves
 * the shelf the one thing a figure cannot do — quote two divers, and open the
 * door to the rest.
 *
 * Diver-written comments render as plain React text children, never as markup,
 * and every string here comes from the caller's localized dictionary.
 */
export function ShopReviews({
  aggregate,
  reviews,
  shopSlug,
  locale,
  timezone,
  className = "",
  t,
}: {
  aggregate: ReviewAggregate;
  reviews: PublicReview[];
  shopSlug: string;
  locale: string;
  timezone: string;
  /** The page's rhythm, carried inside — a shelf that renders nothing leaves no gap. */
  className?: string;
  t: DiverTranslator;
}) {
  if (aggregate.average === null || aggregate.count === 0) return null;

  return (
    <section aria-labelledby="shop-reviews" className={className || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="shop-reviews" className="font-brand-display text-lg font-semibold tracking-tight">
          {t("reviews.sectionTitle")}
        </h2>
        <Link
          href={publicReviewsPath(shopSlug)}
          className="text-sm font-medium text-primary hover:underline focus-visible:underline"
        >
          {t("reviews.allTitle")}
        </Link>
      </div>
      <ReviewLedger
        reviews={reviews.slice(0, SHELF_QUOTES)}
        locale={locale}
        timezone={timezone}
        t={t}
      />
    </section>
  );
}

/**
 * Published reviews as the open ledger (ADR
 * 20260827-clearwater-surface-language, decision 2): hairline rows on the page
 * background rather than a two-up grid of bordered cards. Shared by the
 * shopfront's shelf and by the archive, which deliberately omits the trip
 * title.
 *
 * The star fill is `--accent` here — data ink under decision 11's budget, one
 * appearance however many rows are lit, and public pages only.
 */
export function ReviewLedger({
  reviews,
  locale,
  timezone,
  t,
  showTrip = true,
}: {
  reviews: PublicReview[];
  locale: string;
  timezone: string;
  t: DiverTranslator;
  showTrip?: boolean;
}) {
  if (reviews.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-col">
      {reviews.map((review) => (
        <LedgerRow key={review.id} className="py-4">
          <StarRating
            rating={review.rating}
            label={t("reviews.ratingOption", { rating: review.rating })}
            tone="accent"
            className="text-sm"
          />
          {review.comment ? <p className="mt-1.5 text-base text-pretty">{review.comment}</p> : null}
          <p className="mt-1.5 text-sm text-muted">
            {review.reviewer || t("reviews.anonymousReviewer")}
            {showTrip ? ` · ${review.tripTitle}` : null} ·{" "}
            {formatShortDate(review.divedAt, locale, timezone)}
          </p>
        </LedgerRow>
      ))}
    </ul>
  );
}
