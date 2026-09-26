import Link from "next/link";
import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { StarRating } from "@/components/StarRating";
import { buttonClass, tapTargetLineClass } from "@/components/ui/button";
import { LedgerRow, ledgerRowBoxClass } from "@/components/ui/ledger";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
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
        <h2
          id="shop-reviews"
          className={`font-brand-display ${SECTION_TITLE_CLASS} tracking-tight`}
        >
          {t("reviews.sectionTitle")}
        </h2>
        {/* A 44px door on the words' 20px line: the target bleeds above and
            below, and the baseline row stays the heading's height. Spelled
            as the storefront's other text doors are, so all draw one ring. */}
        <span className={tapTargetLineClass}>
          <Link
            href={publicReviewsPath(shopSlug)}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("reviews.allTitle")}
          </Link>
        </span>
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
 * **The shelf, as a skeleton** — heading, the all-reviews door, and
 * `ReviewLedger`'s two rows (design principle 1), for the storefront's
 * `<Suspense>` fallback while the published reviews stream in.
 *
 * **Every bar is its line's own box** (pixel-craft class 11, K-368). The bars
 * were under the real line boxes, so a row was 97px against 113 loaded at
 * 1280 and the page below dropped about 36px when the reviews landed (104px
 * at 390). The numbers are read off the shelf and must move with it:
 *   - `h-7`: the heading's `text-lg` line;
 *   - `h-6`: the stars' line, which is the row's 16px/24px strut (the 16px
 *     star box stands on its baseline inside it);
 *   - `mt-1.5` and `h-6`: the quote's `text-base` line, two of them below
 *     `sm`, where a diver's sentence wraps;
 *   - `mt-1.5` and `h-5`: the meta's `text-sm` line;
 *   - `py-4`: `LedgerRow`'s `xl` inset, and the ledger row's box.
 */
export function ShopReviewsSkeleton({ className = "" }: { className?: string }) {
  return (
    <section aria-hidden="true" className={`animate-pulse ${className}`.trim()}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="h-7 w-40 rounded bg-surface-sunken" />
        <div className="h-5 w-24 rounded bg-surface-sunken" />
      </div>
      <div className="mt-4 flex flex-col">
        {[0, 1].map((row) => (
          <div key={row} className={`py-4 ${ledgerRowBoxClass}`}>
            <div className="h-6 w-24 rounded bg-surface-sunken" />
            <div className="mt-1.5">
              <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-6" width="w-80 max-w-full" />
            </div>
            <div className="mt-1.5 h-5 w-56 max-w-full rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
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
        // 16px, the room a diver's words have always stood in here, and the
        // room its loading skeletons draw.
        <LedgerRow key={review.id} pad="xl">
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
