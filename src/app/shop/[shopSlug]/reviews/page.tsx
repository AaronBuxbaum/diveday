import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { StarRating } from "@/components/StarRating";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
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
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
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
  searchParams: Promise<{ notice?: string; undo?: string; after?: string; filter?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, undo, after, filter } = await searchParams;
  const onlyWaiting = filter === "waiting";
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const locale = await requestLocale(shop?.defaultLocale);
  const timezone = shop?.timezone ?? "UTC";
  // The current calendar month in the shop's own timezone — "this month" means
  // the same thing here as it does on the reports page (src/lib/zoned.ts).
  const nowWall = utcToWallTime(nowDate(), timezone);
  const monthStart = wallTimeToUtc(
    { year: nowWall.year, month: nowWall.month, day: 1, hour: 0, minute: 0 },
    timezone,
  );
  const [reviewPage, aggregate, monthAggregate, waitingCount] = await Promise.all([
    listShopReviewsForStaff(db, session.user.shopId, { cursor: after, onlyWaiting }),
    getShopReviewAggregate(db, session.user.shopId),
    getShopReviewAggregate(db, session.user.shopId, { since: monthStart }),
    countReviewsAwaitingModeration(db, session.user.shopId),
  ]);
  const { reviews, nextCursor, total } = reviewPage;
  const banner = noticeFromParam(notice, NOTICES);
  const t = staffTranslator(locale);
  const base = `/shop/${shopSlug}/reviews`;
  const filterSuffix = onlyWaiting ? "&filter=waiting" : "";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "undo"]} />
      <ShopPageHeader
        eyebrow={t("reviews.eyebrow")}
        title={t("reviews.title")}
        description={t("reviews.description")}
        actions={
          <Link
            href={`/shop/${shopSlug}/schedule`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("reviews.viewPublicPage")}
          </Link>
        }
      />

      {notice === "hidden" && undo ? (
        <UndoToast
          message={t("reviews.notice.hiddenToast")}
          action={setReviewPublishedAction}
          fields={{ reviewId: undo, publish: "true" }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <section aria-label={t("reviews.overviewLabel")} className="mb-2 grid gap-3 sm:grid-cols-3">
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
        <Link href={`${base}?filter=waiting`} className="block rounded-2xl">
          <ShopStat
            label={t("reviews.waitingOnYou")}
            value={waitingCount}
            detail={t("reviews.waitingDetail")}
            tone={waitingCount > 0 ? "primary" : undefined}
          />
        </Link>
      </section>

      {monthAggregate.count > 0 && monthAggregate.average !== null ? (
        <p className="mb-6 text-sm text-muted">
          {t("reviews.thisMonthStat", {
            rating: monthAggregate.average.toFixed(1),
            count: monthAggregate.count,
          })}
        </p>
      ) : (
        <div className="mb-6" />
      )}

      <nav aria-label={t("reviews.filterLabel")} className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={base}
          className={buttonClass({ variant: onlyWaiting ? "secondary" : "primary", size: "sm" })}
        >
          {t("reviews.filter.all")}
        </Link>
        <Link
          href={`${base}?filter=waiting`}
          className={buttonClass({ variant: onlyWaiting ? "primary" : "secondary", size: "sm" })}
        >
          {t("reviews.filter.waiting", { count: waitingCount })}
        </Link>
      </nav>

      {total === 0 ? (
        <EmptyState>
          <h2 className="font-medium">
            {onlyWaiting ? t("reviews.emptyWaitingHeading") : t("reviews.emptyHeading")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {onlyWaiting ? t("reviews.emptyWaitingDetail") : t("reviews.emptyDetail")}
          </p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => {
            // A published 5★ review is the shop's best news on this page —
            // the one place besides `EarnedMoment` itself that borrows its
            // coral accent, matching its classes rather than reusing the
            // section component (this is a repeatable list row, not a
            // page-level hero — see the component's own "rationed" note).
            const standout = review.isPublished && review.rating === 5;
            return (
              <li
                key={review.id}
                className={`flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-start ${
                  standout ? "border-accent/40 bg-accent/10" : "border-border bg-surface"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StarRating rating={review.rating} />
                    <Badge tone={review.isPublished ? "success" : "neutral"}>
                      {review.isPublished ? t("reviews.published") : t("reviews.waitingOnYou")}
                    </Badge>
                    {standout ? (
                      <span className="text-xs font-semibold text-primary">
                        {t("reviews.standout")}
                      </span>
                    ) : null}
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
            );
          })}
        </ul>
      )}

      {nextCursor || after ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {nextCursor ? (
            <Link
              href={`${base}?after=${encodeURIComponent(nextCursor)}${filterSuffix}`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("reviews.showMoreReviews")}
            </Link>
          ) : null}
          {after ? (
            <Link
              href={onlyWaiting ? `${base}?filter=waiting` : base}
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
