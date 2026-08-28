import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/ledger";
import {
  countStaffReviewGroups,
  getShopReviewAggregate,
  listShopReviewsForStaff,
  MAX_BULK_PUBLISH,
  REVIEW_MODERATION_REASONS,
  type ReviewModerationReason,
  type StaffReview,
} from "@/db/reviews";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { publicSchedulePath } from "@/lib/public-routes";
import { ratingIsWithheld, reviewsToRepublishForRating } from "@/lib/reviews";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import {
  type BulkPublishCopy,
  PublishAllButton,
  PublishAllProvider,
  PublishAllStatus,
} from "./_components/ReviewBulkPublish";
import { type ReviewGroup, ReviewLedgerRow } from "./_components/ReviewLedgerRow";
import {
  type ReviewRowCopy,
  ReviewRowProvider,
  ReviewRowUndoToast,
} from "./_components/ReviewRowActions";
import { ReviewsAggregateLine } from "./_components/ReviewsAggregateLine";

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
 * place and report beside themselves (`ReviewRowActions`, `PublishAllStatus`),
 * so the map, the `?published=` count it had to defend against tampering, and
 * the page banner they fed are all gone with the redirects that wrote them.
 * The one banner left is `ratingWithheld`, which is a fact about the page
 * rather than the outcome of a tap.
 */

/**
 * **Reviews is a worklist first** (ADR 20260827-people-not-lists, decision 3;
 * the language is 20260827-clearwater-surface-language).
 *
 * Three groups in the order the work runs: what is waiting on a read, then the
 * published record, then what the shop took down. The group header owns the
 * state word and the count for every row beneath it, so no row wears a status
 * pill; the four stat tiles that used to sit above the list collapsed into the
 * one aggregate line under the title, and the "All / Waiting on you" filter
 * chips retired with them — the groups *are* the filter, and a filtered list
 * cannot show a staffer that publishing a review moved it somewhere.
 *
 * **The suppression floor's arithmetic is untouched.** A hidden review still
 * counts against the share that decides whether DiveDay publishes this shop's
 * rating (ADR 20260813-review-moderation-has-a-floor); only where that fact
 * renders has moved. And "Hidden" stays the honest word: a review the shop
 * declined to publish is not deleted — a shop cannot delete words it did not
 * write — so the soft-delete vocabulary ban does not reach this page.
 */
export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { shopSlug } = await params;
  const { page } = await searchParams;
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
  const [waitingPage, moderatedPage, aggregate, monthAggregate, groups] = await Promise.all([
    // **The worklist is read whole, not paged.** It is the reason to open this
    // page, and a queue split across pages is a queue you cannot see the end
    // of. `MAX_BULK_PUBLISH` is the ceiling because it is also the ceiling on
    // what one pass may release (`src/db/reviews.ts`) — the rows on screen and
    // the rows the header act touches are the same set by construction.
    listShopReviewsForStaff(db, session.user.shopId, {
      scope: "waiting",
      limit: MAX_BULK_PUBLISH,
    }),
    // A non-numeric or missing `?page=` reads as page 1; the query clamps it
    // into range so a bookmarked page past the end lands on the last real one.
    listShopReviewsForStaff(db, session.user.shopId, {
      page: Number.parseInt(page ?? "", 10),
      scope: "moderated",
    }),
    getShopReviewAggregate(db, session.user.shopId),
    getShopReviewAggregate(db, session.user.shopId, { since: monthStart }),
    countStaffReviewGroups(db, session.user.shopId),
  ]);
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
    republish: t("reviews.republish"),
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
    error: t("reviews.notice.error"),
  };
  /** This page's URL with only `page` swapped — there are no filters left to keep. */
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);

  const published = moderatedPage.reviews.filter((review) => review.isPublished);
  const hidden = moderatedPage.reviews.filter((review) => review.isHidden);
  const waitingIds = waitingPage.reviews.map((review) => review.id);
  // Nothing to read and nothing to do: the two lists this page is made of are
  // both empty, so the page's own empty state speaks instead of three headings
  // over three absences.
  const nothingAtAll = waitingPage.total === 0 && moderatedPage.total === 0;

  const rows = (reviews: StaffReview[], group: ReviewGroup) =>
    reviews.map((review) => (
      <ReviewLedgerRow
        key={review.id}
        review={review}
        group={group}
        shopSlug={shopSlug}
        locale={locale}
        timezone={timezone}
        t={t}
        reasonKeys={REVIEW_REASON_KEYS}
        reasons={hideReasons}
        copy={rowCopy}
      />
    ));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.reviews)}
        title={t("reviews.title")}
        meta={<ReviewsAggregateLine aggregate={aggregate} month={monthAggregate} t={t} />}
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

      {/* The one thing on this page that is neither a row nor a count: the
          rating a shop can still read on its own schedule page has stopped
          being published to search engines, and nothing else would say so.
          Addressed at the situation, never at the shop — the common case is a
          small shop that removed real spam. */}
      {ratingWithheld ? (
        <StaffNoticeBanner tone="warning">
          {t("reviews.ratingWithheld", { count: reviewsToRepublishForRating(aggregate) })}
        </StaffNoticeBanner>
      ) : null}

      {nothingAtAll ? (
        <EmptyState
          title={t("reviews.emptyHeading")}
          body={t("reviews.emptyDetail")}
          /* Nothing here yet is not something staff can fix by clicking — a
             review arrives when a diver opens the recap after a trip sails,
             and no setting turns that on. What *is* theirs to set is where a
             happy diver goes next, so that is the door: the review link the
             recap offers after a strong rating. */
          action={
            <div className="flex flex-col items-center gap-2">
              <p className="max-w-md text-sm text-muted">{t("reviews.emptyReviewLinkBody")}</p>
              <Link
                href={`/shop/${shopSlug}/settings#review-link`}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("reviews.emptyReviewLinkAction")}
              </Link>
            </div>
          }
        />
      ) : (
        <PublishAllProvider>
          {/* Above the groups and rendered unconditionally: a pass that clears
              the queue takes the waiting group — and the button that ran it —
              off the page, and that is exactly the pass most worth a sentence. */}
          <PublishAllStatus copy={bulkCopy} className="mb-4" />

          {/* The same reasoning per row, and for the same reason: publishing or
              hiding a review moves its `<li>` between these three lists, which
              unmounts it. A `useActionState` inside the row was destroyed by
              the act it existed to report. */}

          {/* One rhythm between groups, the page-section spacing every staff
              surface uses — never a per-section `mt-*` that drifts. */}
          <ReviewRowProvider>
            {/* Above the lists for the same reason `PublishAllStatus` is: a
                hide takes its own row off the group, and off the page entirely
                once there are more moderated reviews than fit one. */}
            <ReviewRowUndoToast copy={rowCopy} />
            <div className="space-y-10">
              {waitingPage.reviews.length > 0 ? (
                <section aria-labelledby="reviews-waiting">
                  <div className="flex items-baseline justify-between gap-3">
                    <GroupLabel as="h2" id="reviews-waiting">
                      {t("reviews.group.waiting", { count: waitingPage.total })}
                    </GroupLabel>
                    {/* With one review waiting there is nothing a header act does
                      that the row's own Publish does not, so it does not
                      render: two buttons one tap apart, doing the same thing,
                      is the second door principle 8 exists to close. */}
                    {waitingIds.length > 1 ? (
                      <PublishAllButton
                        reviewIds={waitingIds}
                        label={t("reviews.publishAll", { count: waitingIds.length })}
                        pendingLabel={t("reviews.saving")}
                        className={buttonClass({ variant: "link", size: "sm", flush: true })}
                      />
                    ) : null}
                  </div>
                  <ul className="mt-2">{rows(waitingPage.reviews, "waiting")}</ul>
                </section>
              ) : null}

              {published.length > 0 ? (
                <section aria-labelledby="reviews-published">
                  <GroupLabel as="h2" id="reviews-published">
                    {t("reviews.group.published", { count: groups.published })}
                  </GroupLabel>
                  <ul className="mt-2">{rows(published, "published")}</ul>
                </section>
              ) : null}

              {hidden.length > 0 ? (
                <section aria-labelledby="reviews-hidden">
                  <GroupLabel as="h2" id="reviews-hidden">
                    {t("reviews.group.hidden", { count: groups.hidden })}
                  </GroupLabel>
                  <ul className="mt-2">{rows(hidden, "hidden")}</ul>
                </section>
              ) : null}
            </div>
          </ReviewRowProvider>
        </PublishAllProvider>
      )}

      <Pager
        page={moderatedPage.page}
        pageCount={moderatedPage.pageCount}
        href={pageHref}
        total={t("reviews.pagination.total", { count: moderatedPage.total })}
        t={t}
        className="mt-8"
      />
    </main>
  );
}
