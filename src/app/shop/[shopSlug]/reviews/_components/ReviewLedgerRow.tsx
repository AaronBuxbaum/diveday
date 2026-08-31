import Link from "next/link";
import { StarRating } from "@/components/StarRating";
import { Badge } from "@/components/ui/badge";
import { LedgerRow } from "@/components/ui/ledger";
import type { ReviewModerationReason, StaffReview } from "@/db/reviews";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { ReviewRowActions, type ReviewRowCopy } from "./ReviewRowActions";

/**
 * **One review, in whichever group it belongs to** (ADR
 * 20260827-people-not-lists, decision 3; the language is
 * 20260827-clearwater-surface-language).
 *
 * One shape for all three groups, because a staffer meets the same row
 * wherever they are on this page: the stars, the words, the meta line, the
 * acts. What changes between groups is **weight, not anatomy** — a review
 * waiting on a read carries its words at reading size, and one already ruled
 * on carries them quietly at record size. Both keep the complete words
 * readable: moderation state changes their weight, not whether a staffer can
 * read the review.
 *
 * **No state badge.** "Published" / "Hidden" / "Waiting on you" used to ride
 * every row as a pill; it is the one fact every row in a group shares, so it
 * belongs to the group header and nowhere else. `Badge` survives here for the
 * genuinely exceptional thing — a shop's own standout pick — which is what a
 * pill is for.
 *
 * The `#review-<id>` fragment is a contract with two callers, not decoration:
 * Today's row and the close-out both deep-link a single waiting review by it
 * (`src/db/today.ts`). It sits on the row's content block rather than on the
 * `<li>` because `LedgerRow` owns the element and the hairline it carries; the
 * browser scrolls to whatever the fragment names either way.
 */

/** The reason codes as words — `src/db` returns codes, the UI picks sentences. */
export type ReviewReasonWords = Record<ReviewModerationReason, StaffMessageKey>;

export type ReviewGroup = "waiting" | "published" | "hidden";

export function ReviewLedgerRow({
  review,
  group,
  shopSlug,
  locale,
  timezone,
  t,
  reasonKeys,
  reasons,
  copy,
}: {
  review: StaffReview;
  group: ReviewGroup;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
  reasonKeys: ReviewReasonWords;
  reasons: readonly { value: string; label: string }[];
  copy: ReviewRowCopy;
}) {
  const waiting = group === "waiting";
  return (
    <LedgerRow
      as="li"
      stacked
      className="py-3"
      trailing={
        <ReviewRowActions
          reviewId={review.id}
          isPublished={review.isPublished}
          isHidden={review.isHidden}
          isStandout={review.isStandout}
          /* A bare rating has no words to feature, so there is nothing to
             mark — the same condition this bar has always carried. */
          canStandout={review.isPublished && Boolean(review.comment)}
          reasons={reasons}
          copy={copy}
        />
      }
    >
      <div id={`review-${review.id}`} className="min-w-0 scroll-mt-24">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <StarRating
            rating={review.rating}
            label={t("reviews.rating", { rating: review.rating })}
            className="shrink-0"
          />
          {review.isStandout && review.isPublished ? (
            <Badge tone="primary" size="sm" className="shrink-0">
              {t("reviews.standout")}
            </Badge>
          ) : null}
        </div>
        {review.comment ? (
          <p
            className={
              waiting
                ? "mt-1 break-words text-base text-pretty"
                : "mt-1 break-words text-sm text-muted text-pretty"
            }
          >
            {review.comment}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted italic">{t("reviews.ratingOnly")}</p>
        )}
        <p className="mt-1 text-xs text-muted">
          {t.rich("reviews.reviewMeta", {
            diverName: review.diverName,
            tripTitle: review.tripTitle,
            date: formatShortDate(review.divedAt, locale, timezone),
            diver: (chunks) => (
              <Link
                href={`/shop/${shopSlug}/divers/${review.personId}`}
                className="font-medium text-primary hover:underline"
              >
                {chunks}
              </Link>
            ),
            trip: (chunks) => (
              <Link
                href={`/shop/${shopSlug}/trips/${review.tripId}`}
                className="font-medium text-primary hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
        {/* The case the shop stated when it took this one down. It is the row's
            reason for being in the Hidden group at all, so it renders in full
            rather than being clipped with the words above it. */}
        {review.isHidden && review.hiddenReason ? (
          <p className="mt-1 text-xs text-muted">
            {review.hiddenReasonNote
              ? t("reviews.hiddenReasonWithNote", {
                  reason: t(reasonKeys[review.hiddenReason]),
                  note: review.hiddenReasonNote,
                })
              : t("reviews.hiddenReason", { reason: t(reasonKeys[review.hiddenReason]) })}
            {review.hiddenAt && review.hiddenBy
              ? ` · ${t("reviews.hiddenMeta", {
                  date: formatDateTimeTz(review.hiddenAt, locale, timezone),
                  name: review.hiddenBy,
                })}`
              : null}
          </p>
        ) : null}
      </div>
    </LedgerRow>
  );
}
