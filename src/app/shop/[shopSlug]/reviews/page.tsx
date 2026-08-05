import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
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
  MAX_BULK_PUBLISH,
} from "@/db/reviews";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import {
  PublishSelectedButton,
  ReviewSelectCheckbox,
  ReviewSelectionProvider,
} from "./_components/ReviewBulkPublish";
import { setReviewPublishedAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Reviews — DiveDay",
};

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICES: Record<string, { tone: "success" | "danger"; key: StaffMessageKey }> = {
  published: { tone: "success", key: "reviews.notice.published" },
  hidden: { tone: "success", key: "reviews.notice.hidden" },
  none_selected: { tone: "danger", key: "reviews.notice.noneSelected" },
  error: { tone: "danger", key: "reviews.notice.error" },
};

/**
 * How many a "Publish selected" actually released, read back off the redirect.
 * Parsed and clamped rather than echoed: `?published=` is as attacker-craftable
 * as `?notice=`, and a hostile link must not be able to paint its own number
 * into a success banner.
 */
function publishedCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_BULK_PUBLISH);
}

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    undo?: string;
    page?: string;
    filter?: string;
    published?: string;
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, undo, page, filter, published } = await searchParams;
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
    // A non-numeric or missing `?page=` reads as page 1; the query clamps it
    // into range so a bookmarked page past the end lands on the last real one.
    listShopReviewsForStaff(db, session.user.shopId, {
      page: Number.parseInt(page ?? "", 10),
      onlyWaiting,
    }),
    getShopReviewAggregate(db, session.user.shopId),
    getShopReviewAggregate(db, session.user.shopId, { since: monthStart }),
    countReviewsAwaitingModeration(db, session.user.shopId),
  ]);
  const { reviews, total } = reviewPage;
  const banner = noticeFromParam(notice, NOTICES);
  const t = staffTranslator(locale);
  // Three of these belong to the "Publish selected" button; the other two come
  // from a per-review toggle far down the list and keep the page banner.
  const bulkStatus =
    notice === "published_many"
      ? {
          tone: "success" as const,
          text: t("reviews.notice.publishedMany", { count: publishedCount(published) }),
        }
      : (notice === "none_selected" || notice === "error") && banner
        ? { tone: banner.tone, text: t(banner.key) }
        : undefined;
  const pageBanner = bulkStatus ? undefined : banner;
  const base = `/shop/${shopSlug}/reviews`;
  /** This page's URL with the tab kept and only `page` swapped. */
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (onlyWaiting) query.set("filter", "waiting");
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `${base}?${search}` : base;
  };
  // The bulk control acts on exactly the rows that carry a tick box, so it is
  // counted off the same page of reviews rather than off `waitingCount` (which
  // counts the whole shop, including reviews on a page this one has not
  // reached) — staff can never be offered a button that acts on nothing here.
  const pendingOnPage = reviews.filter((review) => !review.isPublished).length;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* `published` travels with `notice=published_many` and is stripped with
          it, so a reload never re-reads a count whose banner has already gone. */}
      <FlashParams params={["notice", "undo", "published"]} />
      <ShopPageHeader
        eyebrow={t("reviews.eyebrow")}
        title={t("reviews.title")}
        description={t("reviews.description")}
        actions={
          <Link
            href={publicSchedulePath(shopSlug)}
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
      ) : pageBanner ? (
        <StaffNoticeBanner tone={pageBanner.tone}>{t(pageBanner.key)}</StaffNoticeBanner>
      ) : null}

      <section aria-label={t("reviews.overviewLabel")} className="mb-2 grid gap-3 sm:grid-cols-3">
        <ShopStat
          label={t("reviews.publicRating")}
          value={aggregate.average === null ? "—" : aggregate.average.toFixed(1)}
          detail={aggregate.count === 0 ? t("reviews.noneYet") : t("reviews.fromPublished")}
          tone="primary"
        />
        <ShopStat
          label={t("reviews.published")}
          value={aggregate.count}
          detail={t("reviews.publishedDetail")}
        />
        {/* A stat, not a control. It used to be wrapped in an unstyled `<Link>`
            to the same place the "Waiting on you" filter chip below already
            goes — an invisible second door to one destination, which is the
            drift docs/design/principles.md #8 exists to stop. The chip is the
            honest one: it looks like what it is and shows which filter is on. */}
        <ShopStat
          label={t("reviews.waitingOnYou")}
          value={waitingCount}
          detail={t("reviews.waitingDetail")}
          tone={waitingCount > 0 ? "primary" : undefined}
        />
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

      <ReviewSelectionProvider>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <nav aria-label={t("reviews.filterLabel")} className="flex flex-wrap items-center gap-2">
            <Link
              href={base}
              className={buttonClass({
                variant: onlyWaiting ? "secondary" : "primary",
                size: "sm",
              })}
            >
              {t("reviews.filter.all")}
            </Link>
            <Link
              href={`${base}?filter=waiting`}
              className={buttonClass({
                variant: onlyWaiting ? "primary" : "secondary",
                size: "sm",
              })}
            >
              {t("reviews.filter.waiting")}
            </Link>
          </nav>
          {/* Bulk publish, on exactly the same terms as the roster's bulk waiver
              send: shown only when this page actually holds something it can
              act on, so it is never a dead control. Unpublishing stays a
              per-review act — see publishReviewsAction. */}
          {pendingOnPage > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">{t("reviews.tickThenPublish")}</span>
              <PublishSelectedButton
                status={bulkStatus}
                label={t("reviews.publishSelected")}
                pendingLabel={t("reviews.saving")}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "text-foreground",
                })}
              />
            </div>
          ) : null}
        </div>

        {total === 0 ? (
          <EmptyState>
            <h2 className="font-medium">
              {onlyWaiting ? t("reviews.emptyWaitingHeading") : t("reviews.emptyHeading")}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              {onlyWaiting ? t("reviews.emptyWaitingDetail") : t("reviews.emptyDetail")}
            </p>
            {/* Nothing here yet is not something staff can fix by clicking — a
                review arrives when a diver opens the recap after a trip sails,
                and no setting turns that on. What *is* theirs to set is where a
                happy diver goes next, so that is the door: the review link the
                recap offers after a strong rating. The "waiting" filter's own
                empty state already has its way out (the All chip above it). */}
            {onlyWaiting ? null : (
              <>
                <p className="mx-auto mt-4 max-w-md text-sm text-muted">
                  {t("reviews.emptyReviewLinkBody")}
                </p>
                <Link
                  href={`/shop/${shopSlug}/settings#review-link`}
                  className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
                >
                  {t("reviews.emptyReviewLinkAction")}
                </Link>
              </>
            )}
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
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    {review.isPublished ? null : (
                      <ReviewSelectCheckbox
                        reviewId={review.id}
                        ariaLabel={t("reviews.selectToPublishAriaLabel", {
                          name: review.diverName,
                        })}
                      />
                    )}
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
      </ReviewSelectionProvider>

      <Pager
        page={reviewPage.page}
        pageCount={reviewPage.pageCount}
        href={pageHref}
        total={t("reviews.pagination.total", { count: total })}
        t={t}
        className="mt-4"
      />
    </main>
  );
}
