import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmbedCredit } from "@/components/EmbedCredit";
import { ReviewLedger } from "@/components/ShopReviews";
import { StarRating } from "@/components/StarRating";
import { buttonClass } from "@/components/ui/button";
import { listBoats } from "@/db/boats";
import { getDb } from "@/db/client";
import { activeCourseAgencies, listActiveCourses } from "@/db/courses";
import { getShopReviewAggregate, listPublishedShopReviewsPage } from "@/db/reviews";
import { shopBySlugCached } from "@/db/shops-cached";
import { getTripWithBooked, pagedUpcomingTripsWithCounts } from "@/db/trips";
import type { DiverTranslator } from "@/i18n/messages";
import { requestTranslator } from "@/i18n/request";
import { courseDepthFormat } from "@/i18n/unit-labels";
import { nowDate } from "@/lib/clock";
import {
  courseTotalCents,
  perDiverBookingPriceCents,
  resolveCourseContentDepths,
} from "@/lib/courses";
import { isEmbedWidget } from "@/lib/embed-routes";
import { formatMoneyScanned, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import {
  publicCoursePath,
  publicCoursesPath,
  publicReviewsPath,
  publicSchedulePath,
  publicTripPath,
} from "@/lib/public-routes";
import { capacityLabel, seatsOnSale } from "@/lib/trips";
import { EmbedHeightReporter } from "./_components/EmbedHeightReporter";

// The widget is only ever framed, so it paints inside its own shell like every
// route (ADR 20260804-instant-navigation).
export const instant = true;

/** How many diver quotes the reviews widget carries before it hands over to the archive. */
const WIDGET_QUOTES = 3;

/** How many courses the courses widget lists before it hands over to the catalog. */
const WIDGET_COURSES = 6;

/**
 * Four thin views of the shop's own content, each a fragment of a page a
 * search engine already has: never indexed as pages of their own.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * **The embed catalogue's framed widgets** (Harbor — ADR
 * 20260901-diveday-reimagined, decision 2): `grid` (trips and courses as
 * cards), `departure` (one departure as a card, for a blog post), `courses`
 * (the list) and `reviews` (what divers said, from the published archive). Each exists only to be framed by `public/embed.js` on a shop's
 * own website — the proxy marks the path an embed request, so the layout drops
 * its chrome and admits framing — and each wears whatever the host page or the
 * shop set, through the same `BrandStyle` the storefront reads. Every card's
 * one action leaves the frame for the real page (`target="_top"`), because the
 * booking and its payment never run inside someone else's iframe (ADR
 * 20260726-schedule-embed).
 */
export default async function EmbedWidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; widget: string }>;
  searchParams: Promise<{ show?: string | string[]; credit?: string | string[] }>;
}) {
  const { shopSlug, widget } = await params;
  if (!isEmbedWidget(widget)) notFound();
  const db = await getDb();
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();
  const { t, locale } = await requestTranslator(shop.defaultLocale);
  const currency = toShopCurrency(shop.currency);
  const { show, credit } = await searchParams;
  const showId = typeof show === "string" ? show : null;
  // The loader draws the crawlable credit on the host page and says so; a
  // frame hand-written without it keeps its own. One line per widget.
  const hostCarriesCredit = credit === "host";
  const boatName = new Map((await listBoats(db, shop.id)).map((boat) => [boat.id, boat.name]));
  const now = nowDate();
  const origin = publicAppUrl() ?? "";
  const tz = shop.timezone;
  // `{depth18}` markers in the shop's own course prose resolve into the shop's
  // unit before a card reads a field, the same one-shot pass the course
  // catalog makes (src/lib/courses.ts). Rendered raw, a framed summary read
  // "How to dive between {depth18n} and {depth40}…" (K-376).
  const depthFormat = courseDepthFormat(t, shop.depthUnit);
  // **One agency's ladder, as the catalog opens.** The public courses page
  // shows one agency at a time and opens on the first; a frame that printed
  // every agency's Open Water, Advanced and Rescue flat was a 60-card wall on
  // the shop's own homepage (third UX review, item 25). A named course (`show`)
  // is looked up across every agency.
  const activeCourses = async (scope: "primary" | "all") => {
    const agency = scope === "primary" ? (await activeCourseAgencies(db, shop.id))[0] : undefined;
    return (await listActiveCourses(db, shop.id, agency ? { agency } : {})).map((course) =>
      resolveCourseContentDepths(course, depthFormat),
    );
  };
  // What the diver is asked for at enrollment, fee and eLearning together,
  // the number the course page itself prints. The fee alone made "$499" here
  // and "$709" one click later (third UX review, item 22).
  const coursePrice = (course: Parameters<typeof courseTotalCents>[0]) =>
    money(courseTotalCents(course));

  const money = (cents: number | null) =>
    cents === null ? null : formatMoneyScanned(cents, currency, locale);
  // The day and the time *range*, in the trip page's own words and zone
  // (visual review 2026-10-24, B33): "Sat, Oct 24 · 1:30 PM – 5:00 PM EDT".
  const when = (startsAt: Date, endsAt: Date) =>
    `${formatShortDate(startsAt, locale, tz)} · ${formatTimeRangeTz(startsAt, endsAt, locale, tz)}`;
  // Seats on sale under the boat's certificate, never the stated capacity (#2321).
  const seats = (trip: { capacity: number; sellableCapacity: number; booked: number }) => {
    const label = capacityLabel(seatsOnSale(trip));
    if (label.kind === "full") return { text: t("fallback.full"), full: true };
    return { text: t("fallback.spotsLeft", { count: label.remaining }), full: false };
  };

  let body: React.ReactNode;
  if (widget === "reviews") {
    // **The archive's rules, framed.** Only what the public archive already
    // shows: published, moderated reviews with words, signed "Marta R."
    // (`reviewerDisplayName`), and nothing at all from a shop that switched
    // reviews off (ADR 20261005-optional-shop-features).
    const [aggregate, reviewPage] = shop.reviewsEnabled
      ? await Promise.all([
          getShopReviewAggregate(db, shop.id),
          listPublishedShopReviewsPage(db, shop.id, { limit: WIDGET_QUOTES }),
        ])
      : [null, null];
    // **Quiet below the shelf's own threshold.** The storefront's shelf renders
    // nothing until a rating is published, because an empty "no reviews yet"
    // panel reads as a warning; on someone else's page it would read worse.
    // The frame reports a height of exactly 0, and the loader folds it and
    // its credit away (`public/embed.js`, #2317).
    if (!aggregate || aggregate.average === null || aggregate.count === 0) {
      return (
        <main className="w-full">
          <EmbedHeightReporter empty />
        </main>
      );
    }
    const average = aggregate.average;
    body = (
      <section aria-label={t("reviews.sectionTitle")}>
        {/* The way out stays on the rating's line (#2502): the frame is a fixed
            height on the shop's own site, so a link wrapped to a row of its own
            pushes the last review under the fold. At a phone's width the
            counts fold under the stars instead. */}
        <div className="flex items-center justify-between gap-x-4">
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <StarRating
              rating={Math.round(average)}
              label={t("reviews.ratingOption", { rating: Math.round(average) })}
              tone="accent"
              className="text-base"
            />
            <span className="text-base font-semibold text-foreground tabular-nums">
              {cachedFormatter("num", Intl.NumberFormat, locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(average)}
            </span>
            {/* Two counts, the archive's own line: ratings and written
                reviews are not the same number (UX review 2026-10-10, item 17). */}
            <span className="tabular-nums">
              {reviewPage && reviewPage.total > 0
                ? t("reviews.ratingsAndReviews", {
                    ratings: aggregate.count,
                    reviews: reviewPage.total,
                  })
                : t("reviews.ratingsCount", { count: aggregate.count })}
            </span>
          </p>
          <Link
            href={`${origin}${publicReviewsPath(shopSlug)}`}
            target="_top"
            className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}
          >
            {t("reviews.allTitle")}
          </Link>
        </div>
        <ReviewLedger
          reviews={reviewPage?.reviews ?? []}
          // No trip titles on a third-party page: a private charter's name
          // is not the shop's to publish (the archive hides them too, and
          // `fetchPublicReviewRows` withholds it anyway, #2318).
          showTrip={false}
          locale={locale}
          timezone={tz}
          t={t}
        />
      </section>
    );
  } else if (widget === "departure") {
    const trip = showId ? await getTripWithBooked(db, shop.id, showId) : null;
    if (!trip || trip.isPrivate) notFound();
    body = (
      <DepartureCard
        title={trip.title}
        when={when(trip.startsAt, trip.endsAt)}
        site={
          [trip.diveSite?.name, trip.boatId ? boatName.get(trip.boatId) : null]
            .filter(Boolean)
            .join(" · ") || null
        }
        price={money(perDiverBookingPriceCents(trip, trip.course))}
        seats={seats(trip)}
        href={`${origin}${publicTripPath(shopSlug, trip.id)}#book`}
        waitlist={shop.waitlistEnabled}
        t={t}
      />
    );
  } else if (widget === "courses") {
    const active = await activeCourses(showId ? "all" : "primary");
    // **One course, or the catalogue** (issue #1284, completing ADR
    // 20260901-diveday-reimagined decision 2's "what it shows"). A slug that
    // names no active course is a 404 rather than a silently empty list, the
    // same call the departure card makes one branch up: a shop that unpublished
    // the course its blog post frames should see the frame say so, not show an
    // empty panel that reads as a bug in DiveDay.
    const courses = showId
      ? active.filter((course) => course.slug === showId)
      : active.slice(0, WIDGET_COURSES);
    if (showId && courses.length === 0) notFound();
    const moreCourses = !showId && active.length > courses.length;
    body = (
      <section>
        <ul className="divide-y divide-border rounded-panel border border-border bg-surface shadow-bed">
          {courses.map((course) => (
            <li
              key={course.id}
              className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-brand-display font-semibold">{course.title}</p>
                {/* Two lines on a phone, as the grid's card clamps the same
                  field: at one line every summary on a 390px frame was cut
                  to a fragment ("How to dive between…") beside a title
                  that wraps freely (K-376). From `sm` one line holds it. */}
                {course.summary ? (
                  <p className="line-clamp-2 text-sm text-muted sm:line-clamp-1">
                    {course.summary}
                  </p>
                ) : null}
                {/* How long, in the shop's own words — the course index says it,
                  and a list that dropped it was thinner than the page it stands for. */}
                {course.durationText ? (
                  <p className="text-xs text-muted">{course.durationText}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {coursePrice(course) ? (
                  <span className="font-semibold tabular-nums">{coursePrice(course)}</span>
                ) : null}
                <Link
                  href={`${origin}${publicCoursePath(shopSlug, course.slug)}`}
                  target="_top"
                  className={buttonClass({ size: "sm" })}
                >
                  {t("embed.enrol")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
        {moreCourses ? (
          <p className="mt-3 text-end">
            <Link
              href={`${origin}${publicCoursesPath(shopSlug)}`}
              target="_top"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("courses.shelf.allCourses")}
            </Link>
          </p>
        ) : null}
      </section>
    );
  } else {
    const [{ trips }, courses] = await Promise.all([
      pagedUpcomingTripsWithCounts(db, shop.id, { now, limit: 6, publicOnly: true }),
      activeCourses("primary"),
    ]);
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trips.map((trip) => (
          <DepartureCard
            key={trip.id}
            title={trip.title}
            when={when(trip.startsAt, trip.endsAt)}
            site={
              [trip.diveSite?.name, trip.boatId ? boatName.get(trip.boatId) : null]
                .filter(Boolean)
                .join(" · ") || null
            }
            price={money(perDiverBookingPriceCents(trip, trip.course))}
            seats={seats(trip)}
            href={`${origin}${publicTripPath(shopSlug, trip.id)}#book`}
            waitlist={shop.waitlistEnabled}
            t={t}
          />
        ))}
        {courses.slice(0, 3).map((course) => (
          <article
            key={course.id}
            className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4 shadow-bed"
          >
            <h2 className="font-brand-display text-base font-semibold">{course.title}</h2>
            {course.summary ? (
              <p className="line-clamp-2 text-sm text-muted">{course.summary}</p>
            ) : null}
            <div className="mt-auto flex items-center justify-between gap-3 pt-2">
              <span className="font-semibold tabular-nums">{coursePrice(course) ?? ""}</span>
              <Link
                href={`${origin}${publicCoursePath(shopSlug, course.slug)}`}
                target="_top"
                className={buttonClass({ size: "sm" })}
              >
                {t("embed.enrol")}
              </Link>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <main className="w-full p-3">
      {body}
      {hostCarriesCredit ? null : (
        <EmbedCredit href={`${origin}${publicSchedulePath(shopSlug)}`} target="_top">
          {t("shopChrome.credit")}
        </EmbedCredit>
      )}
      <EmbedHeightReporter />
    </main>
  );
}

/**
 * One departure as a card. A full boat has no Book button (visual review
 * 2026-10-24, B32): the muted "Full" says so, and when the shop keeps a wait
 * list one link goes to it on the trip page, whose wait-list form carries the
 * same `#book` anchor.
 */
function DepartureCard({
  title,
  when,
  site,
  price,
  seats,
  href,
  waitlist,
  t,
}: {
  title: string;
  when: string;
  site: string | null;
  price: string | null;
  seats: { text: string; full: boolean };
  href: string;
  /** The shop keeps a wait list, so a full boat offers to tell the diver. */
  waitlist: boolean;
  t: DiverTranslator;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4 shadow-bed">
      <h2 className="font-brand-display text-base font-semibold">{title}</h2>
      <p className="text-sm tabular-nums">{when}</p>
      {site ? <p className="text-sm text-muted">{site}</p> : null}
      <div className="mt-auto flex items-center justify-between gap-3 pt-2">
        {/* The price at the footer's own size, as a course card's price in
            the same slot of the same grid; only the seats step down. Both
            were `text-sm`, so "$95" stood 2px shorter than "$175" (K-377). */}
        <span>
          {price ? <span className="font-semibold tabular-nums">{price}</span> : null}
          <span className="text-sm">
            {price ? " · " : ""}
            <span className="text-muted">{seats.text}</span>
          </span>
        </span>
        {!seats.full ? (
          <Link href={href} target="_top" className={buttonClass({ size: "sm" })}>
            {t("embed.book")}
          </Link>
        ) : waitlist ? (
          <Link
            href={href}
            target="_top"
            className="text-sm font-medium text-primary hover:underline focus-visible:focus-ring"
          >
            {t("embed.askToBeTold")}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
