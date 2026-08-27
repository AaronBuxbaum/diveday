import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { StarRating } from "@/components/StarRating";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/FilterChips";
import {
  countReviewsAwaitingModeration,
  getShopReviewAggregate,
  listShopReviewsForStaff,
  REVIEW_MODERATION_REASONS,
  type ReviewModerationReason,
} from "@/db/reviews";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { publicSchedulePath } from "@/lib/public-routes";
import { ratingIsWithheld, reviewsToRepublishForRating } from "@/lib/reviews";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import {
  type BulkPublishCopy,
  PublishSelectedButton,
  PublishSelectedStatus,
  ReviewSelectCheckbox,
  ReviewSelectionProvider,
} from "./_components/ReviewBulkPublish";
import { ReviewRowActions, type ReviewRowCopy } from "./_components/ReviewRowActions";

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
/**
 * The reason codes as words. `src/db` returns codes and this picks the
 * sentences, the same division every other domain code on this page follows
 * (ADR 20260731-domain-layer-copy-leaks).
 */
const REVIEW_REASON_KEYS: Record<ReviewModerationReason, StaffMessageKey> = {
  abusive: "reviews.hideReason.abusive",
  names_a_person: "reviews.hideReason.namesAPerson",
  wrong_subject: "reviews.hideReason.wrongSubject",
  spam: "reviews.hideReason.spam",
  other: "reviews.hideReason.other",
};

/*
 * **This page has no `?notice=` map any more, and nothing here redirects.**
 *
 * Every outcome on this list used to arrive as a query parameter on a fresh
 * navigation — publish, hide, standout, bulk publish and their four refusals —
 * which meant a full-page bounce per tap and a staffer working down a queue
 * being thrown back to the top of it each time. The controls now settle in
 * place and report beside themselves (`ReviewRowActions`,
 * `PublishSelectedStatus`), so the map, the `?published=` count it had to
 * defend against tampering, and the page banner they fed are all gone with the
 * redirects that wrote them. The one banner left is `ratingWithheld`, which is
 * a fact about the page rather than the outcome of a tap.
 */

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    page?: string;
    filter?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { page, filter } = await searchParams;
  const onlyWaiting = filter === "waiting";
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const timezone = shop.timezone ?? "UTC";
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
  // Whether DiveDay has stopped publishing this shop's rating as a
  // machine-readable claim. Not the same as "the rating is unrepresentative":
  // a shop with no reviews at all is also not representative and has nothing
  // to be told about (src/lib/reviews.ts).
  const ratingWithheld = ratingIsWithheld(aggregate);
  const t = staffTranslator(locale);
  const base = shopPath(shopSlug, "reviews");
  /**
   * The words every row's action bar reports with, translated once for the
   * whole page rather than per row — a staff client component cannot
   * translate, so it takes them as props (ADR 20260730-staff-copy-localization).
   */
  const rowCopy: ReviewRowCopy = {
    publish: t("reviews.publish"),
    saving: t("reviews.saving"),
    hide: t("reviews.hide"),
    hideConfirm: t("reviews.hideConfirm"),
    hideReasonLabel: t("reviews.hideReasonLabel"),
    hideReasonPlaceholder: t("reviews.hideReasonPlaceholder"),
    hideNoteLabel: t("reviews.hideNoteLabel"),
    markStandout: t("reviews.markStandout"),
    removeStandout: t("reviews.removeStandout"),
    hiddenToast: t("reviews.notice.hiddenToast"),
    undo: t("shared.undoToast.undo"),
    undoPending: t("shared.undoToast.pendingLabel"),
    published: t("reviews.notice.published"),
    standout: t("reviews.notice.standout"),
    standoutRemoved: t("reviews.notice.standoutRemoved"),
    reasonRequired: t("reviews.notice.reasonRequired"),
    noteRequired: t("reviews.notice.noteRequired"),
    noteTooLong: t("reviews.notice.noteTooLong"),
    error: t("reviews.notice.error"),
  };
  /** The reason list, worded once for every row's picker. */
  const hideReasons = REVIEW_MODERATION_REASONS.map((reason) => ({
    value: reason,
    label: t(REVIEW_REASON_KEYS[reason]),
  }));
  /**
   * `t.raw`, not `t`: these carry a `{count}` whose value is only known on the
   * client, after the action answers. Formatting them here would look for an
   * argument that by definition is not there yet (src/i18n/fill.ts).
   */
  const bulkCopy: BulkPublishCopy = {
    publishedManyOne: t.raw("reviews.notice.publishedManyOne"),
    publishedManyOther: t.raw("reviews.notice.publishedManyOther"),
    noneSelected: t("reviews.notice.noneSelected"),
    error: t("reviews.notice.error"),
  };
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
  // Hidden reviews stay unpublished, but are deliberately not waiting for a
  // first read and therefore do not belong in this bulk-release action.
  const pendingOnPage = reviews.filter((review) => !review.isPublished && !review.isHidden).length;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.reviews)}
        title={t("reviews.title")}
        description={t("reviews.description")}
        actions={
          <Link
            href={publicSchedulePath(shopSlug)}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "secondary" })}
          >
            {t("reviews.viewPublicPage")}
          </Link>
        }
      />

      <section
        aria-label={t("reviews.overviewLabel")}
        className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
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
        {/* The number that decides whether the rating beside it is being
            published at all, and until now the one fact this page kept to
            itself — a shop could hide its way out of search results and read
            "4.9" here the whole time. Warning-toned only when it has actually
            cost the shop something; a hidden review is a normal thing to have. */}
        <ShopStat
          label={t("reviews.hiddenStat")}
          value={aggregate.suppressedCount}
          detail={t("reviews.hiddenStatDetail")}
          tone={ratingWithheld ? "warning" : undefined}
        />
      </section>

      {/* Sits under the stats because it explains two of them together: the
          rating that is still showing and the hidden count that stopped it
          being published. Addressed at the situation, never at the shop —
          the common case here is a small shop that removed real spam. */}
      {ratingWithheld ? (
        <StaffNoticeBanner tone="warning">
          {t("reviews.ratingWithheld", { count: reviewsToRepublishForRating(aggregate) })}
        </StaffNoticeBanner>
      ) : null}

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

      <ReviewSelectionProvider
        showingWaitingOnly={onlyWaiting}
        scope={`${onlyWaiting ? "waiting" : "all"}:${reviewPage.page}`}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/* A filter is a view of the list, not the page's action — these
              used to be two buttons with the active one wearing primary
              weight, a chip idiom of this page's own invention. The shared
              FilterChips is the one vocabulary for narrowing a staff list
              (the divers roster wears the same row). */}
          <FilterChips
            label={t("reviews.filterLabel")}
            chips={[
              { key: "all", href: base, active: !onlyWaiting, label: t("reviews.filter.all") },
              {
                key: "waiting",
                href: `${base}?filter=waiting`,
                active: onlyWaiting,
                label: t("reviews.filter.waiting"),
              },
            ]}
          />
          {/* Bulk publish, on exactly the same terms as the roster's bulk waiver
              send: shown only when this page actually holds something it can
              act on, so it is never a dead control. Unpublishing stays a
              per-review act — see publishReviewsAction. */}
          {pendingOnPage > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <PublishSelectedButton
                label={t("reviews.publishSelected")}
                pendingLabel={t("reviews.saving")}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                })}
              />
            </div>
          ) : null}
          {/* A bulk publish is the one outcome with no single control to sit
              beside: what changed is N rows across the list, not one button.
              So it lands on the list's own header row — directly above the
              rows that changed, and where the button that ran it lives when
              there is anything left to run.

              Deliberately *outside* the `pendingOnPage > 0` branch above.
              Clearing the last waiting review removes that branch, and with it
              the only place the confirmation could have rendered — a
              publish-everything pass would have answered with silence, which
              is the bug this whole change exists to remove, wearing a
              different hat.

              The state behind it lives in `ReviewSelectionProvider` for that
              same reason — see its comment. */}
          <PublishSelectedStatus copy={bulkCopy} className="basis-full" />
        </div>

        {total === 0 ? (
          <EmptyState
            title={onlyWaiting ? t("reviews.emptyWaitingHeading") : t("reviews.emptyHeading")}
            body={onlyWaiting ? t("reviews.emptyWaitingDetail") : t("reviews.emptyDetail")}
            /* Nothing here yet is not something staff can fix by clicking — a
               review arrives when a diver opens the recap after a trip sails,
               and no setting turns that on. What *is* theirs to set is where a
               happy diver goes next, so that is the door: the review link the
               recap offers after a strong rating. The "waiting" filter's own
               empty state already has its way out (the All chip above it). */
            action={
              onlyWaiting ? null : (
                <div className="flex flex-col items-center gap-2">
                  <p className="max-w-md text-sm text-muted">{t("reviews.emptyReviewLinkBody")}</p>
                  <Link
                    href={`/shop/${shopSlug}/settings#review-link`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {t("reviews.emptyReviewLinkAction")}
                  </Link>
                </div>
              )
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => {
              const standout = review.isPublished && review.isStandout;
              return (
                <li
                  key={review.id}
                  // A refused hide comes back with `#review-<id>`, so the row
                  // that argued is the one the browser lands on. Today's
                  // `reviews:pending` row aims at the same fragment when it is
                  // the only review waiting (`src/db/today.ts`), so this
                  // spelling is a contract with two callers, not one.
                  // Published five-star rows carry the earned-moment tone, so
                  // this dynamic list row is not a neutral SectionCard.
                  id={`review-${review.id}`}
                  className={`flex flex-col gap-3 rounded-2xl border p-5 ${
                    standout ? "border-accent/40 bg-accent/10" : "border-border bg-surface"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    {!review.isPublished && !review.isHidden ? (
                      <ReviewSelectCheckbox
                        reviewId={review.id}
                        ariaLabel={t("reviews.selectToPublishAriaLabel", {
                          name: review.diverName,
                        })}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StarRating
                          rating={review.rating}
                          label={t("reviews.rating", { rating: review.rating })}
                        />
                        <Badge
                          tone={
                            review.isPublished ? "success" : review.isHidden ? "warning" : "neutral"
                          }
                        >
                          {review.isPublished
                            ? t("reviews.published")
                            : review.isHidden
                              ? t("reviews.hidden")
                              : t("reviews.waitingOnYou")}
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
                      {review.isHidden && review.hiddenReason ? (
                        <div className="mt-2 space-y-1 text-sm text-muted">
                          <p>
                            {review.hiddenReasonNote
                              ? t("reviews.hiddenReasonWithNote", {
                                  reason: t(REVIEW_REASON_KEYS[review.hiddenReason]),
                                  note: review.hiddenReasonNote,
                                })
                              : t("reviews.hiddenReason", {
                                  reason: t(REVIEW_REASON_KEYS[review.hiddenReason]),
                                })}
                          </p>
                          {review.hiddenAt && review.hiddenBy ? (
                            <p>
                              {t("reviews.hiddenMeta", {
                                date: formatDateTimeTz(review.hiddenAt, locale, timezone),
                                name: review.hiddenBy,
                              })}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {/* The row's whole action bar, as one client control: the
                      three buttons share one action so one status region can
                      outlive whichever of them the tap removes, and none of
                      them navigates any more (see `reviewRowAction`). */}
                  <ReviewRowActions
                    reviewId={review.id}
                    isPublished={review.isPublished}
                    isHidden={review.isHidden}
                    isStandout={review.isStandout}
                    /* A bare rating has no words to feature, so there is
                       nothing to mark — the same condition this bar has always
                       carried. */
                    canStandout={review.isPublished && Boolean(review.comment)}
                    reasons={hideReasons}
                    showingWaitingOnly={onlyWaiting}
                    copy={rowCopy}
                  />
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
