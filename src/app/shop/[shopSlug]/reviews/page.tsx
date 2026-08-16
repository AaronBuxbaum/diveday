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
import { FilterChips } from "@/components/ui/FilterChips";
import { FormStatus } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  countReviewsAwaitingModeration,
  getShopReviewAggregate,
  listShopReviewsForStaff,
  MAX_BULK_PUBLISH,
  REVIEW_MODERATION_REASONS,
  type ReviewModerationReason,
} from "@/db/reviews";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { publicSchedulePath } from "@/lib/public-routes";
import { ratingIsWithheld, reviewsToRepublishForRating } from "@/lib/reviews";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import {
  PublishSelectedButton,
  ReviewSelectCheckbox,
  ReviewSelectionProvider,
} from "./_components/ReviewBulkPublish";
import { ReviewHideForm } from "./_components/ReviewHideForm";
import { setReviewPublishedAction, setReviewStandoutAction } from "./actions";

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

const NOTICES: Record<string, { tone: "success" | "danger"; key: StaffMessageKey }> = {
  published: { tone: "success", key: "reviews.notice.published" },
  hidden: { tone: "success", key: "reviews.notice.hidden" },
  "none-selected": { tone: "danger", key: "reviews.notice.noneSelected" },
  "reason-required": { tone: "danger", key: "reviews.notice.reasonRequired" },
  "note-required": { tone: "danger", key: "reviews.notice.noteRequired" },
  "note-too-long": { tone: "danger", key: "reviews.notice.noteTooLong" },
  standout: { tone: "success", key: "reviews.notice.standout" },
  "standout-removed": { tone: "success", key: "reviews.notice.standoutRemoved" },
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
  // Whether DiveDay has stopped publishing this shop's rating as a
  // machine-readable claim. Not the same as "the rating is unrepresentative":
  // a shop with no reviews at all is also not representative and has nothing
  // to be told about (src/lib/reviews.ts).
  const ratingWithheld = ratingIsWithheld(aggregate);
  const banner = noticeFromParam(notice, NOTICES);
  const t = staffTranslator(locale);
  // Three of these are the bulk control's own outcome and belong on the list
  // it changed (see the header row below); the other two come from a
  // per-review toggle and keep the page banner.
  const bulkStatus =
    notice === "published-many"
      ? {
          tone: "success" as const,
          text: t("reviews.notice.publishedMany", { count: publishedCount(published) }),
        }
      : (notice === "none-selected" || notice === "error") && banner
        ? { tone: banner.tone, text: t(banner.key) }
        : undefined;
  const pageBanner = bulkStatus ? undefined : banner;
  const base = shopPath(shopSlug, "reviews");
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
      {/* `published` travels with `notice=published-many` and is stripped with
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
            className={buttonClass({ variant: "secondary" })}
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

      <ReviewSelectionProvider>
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
              <span className="text-sm text-muted">{t("reviews.tickThenPublish")}</span>
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
              different hat. */}
          <FormStatus tone={bulkStatus?.tone} className="basis-full">
            {bulkStatus?.text}
          </FormStatus>
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
              const standout = review.isPublished && review.isStandout;
              return (
                <li
                  key={review.id}
                  // A refused hide comes back with `#review-<id>`, so the row
                  // that argued is the one the browser lands on.
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
                  <div className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
                    {!review.isHidden ? (
                      /* Hiding states a case, so it cannot be a bare button any
                       more (ADR 20260813-review-moderation-has-a-floor). The
                       picker waits behind a disclosure: the shop that opens
                       this is already sure, and the reason list is the whole
                       point — a shop that finds none of them true is telling
                       itself something. This is available before publication
                       as well: hiding a waiting review records the decision
                       and keeps it out of the public set. */
                      <details>
                        <summary
                          className={`${buttonClass({
                            variant: "secondary",
                          })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                        >
                          {t("reviews.hide")}
                        </summary>
                        <ReviewHideForm
                          reviewId={review.id}
                          action={setReviewPublishedAction}
                          reasons={REVIEW_MODERATION_REASONS.map((reason) => ({
                            value: reason,
                            label: t(REVIEW_REASON_KEYS[reason]),
                          }))}
                          reasonLabel={t("reviews.hideReasonLabel")}
                          reasonPlaceholder={t("reviews.hideReasonPlaceholder")}
                          noteLabel={t("reviews.hideNoteLabel")}
                          hideLabel={t("reviews.hideConfirm")}
                          savingLabel={t("reviews.saving")}
                        />
                      </details>
                    ) : null}
                    {!review.isPublished ? (
                      <form action={setReviewPublishedAction} className="shrink-0">
                        <input type="hidden" name="reviewId" value={review.id} />
                        <input type="hidden" name="publish" value="true" />
                        <SubmitButton pendingLabel={t("reviews.saving")} className={buttonClass()}>
                          {t("reviews.publish")}
                        </SubmitButton>
                      </form>
                    ) : null}
                    {review.isPublished && review.comment ? (
                      <form action={setReviewStandoutAction} className="shrink-0">
                        <input type="hidden" name="reviewId" value={review.id} />
                        <input
                          type="hidden"
                          name="standout"
                          value={review.isStandout ? "false" : "true"}
                        />
                        <SubmitButton
                          pendingLabel={t("reviews.saving")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {review.isStandout
                            ? t("reviews.removeStandout")
                            : t("reviews.markStandout")}
                        </SubmitButton>
                      </form>
                    ) : review.isPublished ? (
                      <p className="self-center text-sm text-muted">
                        {t("reviews.standoutWrittenOnly")}
                      </p>
                    ) : null}
                  </div>
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
