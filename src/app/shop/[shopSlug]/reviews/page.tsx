import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { StarRating } from "@/components/StarRating";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import {
  countReviewsAwaitingModeration,
  getShopReviewAggregate,
  listShopReviewsForStaff,
} from "@/db/reviews";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { setReviewPublishedAction } from "./actions";

export const metadata: Metadata = {
  title: "Reviews — DiveDay",
};

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICES: Record<string, { tone: "success" | "danger"; key: StaffMessageKey }> = {
  published: { tone: "success", key: "reviews.notice.published" },
  hidden: { tone: "success", key: "reviews.notice.hidden" },
  error: { tone: "danger", key: "reviews.notice.error" },
};

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; after?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, after } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const [reviewPage, aggregate, waitingCount] = await Promise.all([
    listShopReviewsForStaff(db, session.user.shopId, { cursor: after }),
    getShopReviewAggregate(db, session.user.shopId),
    countReviewsAwaitingModeration(db, session.user.shopId),
  ]);
  const { reviews, nextCursor, total } = reviewPage;
  const banner = notice ? NOTICES[notice] : undefined;
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const timezone = shop?.timezone ?? "UTC";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("reviews.eyebrow")}
        title={t("reviews.title")}
        description={t("reviews.description")}
        actions={
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("reviews.viewPublicPage")}
          </Link>
        }
      />

      {banner ? (
        <div className="mb-6">
          <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
            {t(banner.key)}
          </ShopNotice>
        </div>
      ) : null}

      <section aria-label={t("reviews.overviewLabel")} className="mb-8 grid gap-3 sm:grid-cols-3">
        <ShopStat
          label={t("reviews.publicRating")}
          value={aggregate.average === null ? "—" : aggregate.average.toFixed(1)}
          detail={
            aggregate.count === 0
              ? t("reviews.noneYet")
              : t("reviews.acrossCount", { count: aggregate.count })
          }
          tone="primary"
        />
        <ShopStat
          label={t("reviews.published")}
          value={aggregate.count}
          detail={t("reviews.publishedDetail")}
        />
        <ShopStat
          label={t("reviews.waitingOnYou")}
          value={waitingCount}
          detail={t("reviews.waitingDetail")}
          tone={waitingCount > 0 ? "primary" : undefined}
        />
      </section>

      {total === 0 ? (
        <EmptyState>
          <h2 className="font-medium">{t("reviews.emptyHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{t("reviews.emptyDetail")}</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-start"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StarRating rating={review.rating} />
                  <Badge tone={review.isPublished ? "success" : "neutral"}>
                    {review.isPublished ? t("reviews.published") : t("reviews.waitingOnYou")}
                  </Badge>
                </div>
                {review.comment ? (
                  <p className="mt-2 text-base text-pretty">{review.comment}</p>
                ) : (
                  <p className="mt-2 text-sm text-muted italic">{t("reviews.ratingOnly")}</p>
                )}
                <p className="mt-2 text-sm text-muted">
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
              </div>
              <form action={setReviewPublishedAction} className="shrink-0">
                <input type="hidden" name="reviewId" value={review.id} />
                <input type="hidden" name="publish" value={String(!review.isPublished)} />
                <SubmitButton
                  pendingLabel={t("reviews.saving")}
                  className={buttonClass(
                    review.isPublished
                      ? { variant: "secondary", className: "text-foreground" }
                      : {},
                  )}
                >
                  {review.isPublished ? t("reviews.hide") : t("reviews.publish")}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      {nextCursor || after ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {nextCursor ? (
            <Link
              href={`/shop/${shopSlug}/reviews?after=${encodeURIComponent(nextCursor)}`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("reviews.showMoreReviews")}
            </Link>
          ) : null}
          {after ? (
            <Link
              href={`/shop/${shopSlug}/reviews`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("reviews.backToTop")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
