import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "@/components/EmptyState";
import { JsonLd } from "@/components/JsonLd";
import { ShopReviews, ShopReviewsSkeleton } from "@/components/ShopReviews";
import { sectionCardClass } from "@/components/ui/card";
import { FilterChips } from "@/components/ui/FilterChips";
import { ITEM_TITLE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { type AppDb, getDb } from "@/db/client";
import { listPublishedShopReviews } from "@/db/reviews";
import { shopBySlugCached } from "@/db/shops-cached";
import { listRunningPublicSeries, type pagedUpcomingTripsWithCounts } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import type { DiverTranslator } from "@/i18n/messages";
import { requestTranslator } from "@/i18n/request";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import { parseBrandBadges } from "@/lib/brand";
import { monthLabel, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { DECLARABLE_CERTIFICATION_LEVELS } from "@/lib/dive-declaration";
import { formatTime } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { connectionForRoute } from "@/lib/observability/render-connection";
import {
  publicAvailabilityPath,
  publicCoursesPath,
  publicSchedulePath,
  publicTripPath,
} from "@/lib/public-routes";
import type { ReviewAggregate } from "@/lib/reviews";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { absoluteUrl, scheduleJsonLd } from "@/lib/structured-data";
import { CoursesShelf } from "./_components/CoursesShelf";
import { DayJumpStrip } from "./_components/DayJumpStrip";
import { EmbedFooter } from "./_components/EmbedFooter";
import { identityBand, monthRailSides } from "./_components/identity-band";
import { MonthRail } from "./_components/MonthRail";
import { SHOP_MAIN_CLASS } from "./_components/shop-main";
import { MonthSightingsSection } from "./_components/MonthSightingsShelf";
import { MoreWaysRows } from "./_components/MoreWaysRows";
import { NextBoatCard } from "./_components/NextBoatCard";
import { OffSeasonPanel } from "./_components/OffSeasonPanel";
import { OurYearSection } from "./_components/OurYear";
import { PromotedDateAsk, seriesHorizonLines, viewsBoardsEnd } from "./_components/PromotedDateAsk";
import { ScheduleFilters } from "./_components/ScheduleFilters";
import { SchedulePagerRow } from "./_components/SchedulePagerRow";
import { ShopfrontHero } from "./_components/ShopfrontHero";
import { ShopPhotoStrip } from "./_components/ShopPhotoStrip";
import { readSchedulePage } from "./_components/schedule-reads";
import { seatPriceLabel, shelfCourseCards, weekLedgerRows } from "./_components/schedule-rows";
import {
  aboveStatedLevelIds,
  type ScheduleView,
  scheduleDayWords,
  scheduleFilterCopy,
  scheduleMonthBounds,
  scheduleMonthRail,
  scheduleNextBoat,
  scheduleOffSeason,
  schedulePagerHrefs,
  scheduleSeatState,
  scheduleViewLinks,
} from "./_components/schedule-view";
import { WeekLedger } from "./_components/WeekLedger";

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * **One gap between the storefront's sections** (pixel-craft class 4, K-176).
 * Each section spaced itself with its own `mt-*`, and the week opened 40px
 * under the band where the shelves, the boats, the reviews, the three asks
 * and the off-season ask opened 48px under theirs: "Schedule" stood 8px
 * closer to the panels above it than any other heading to its neighbour.
 * Spelled once, and the route's `loading.tsx` opens its week at the same
 * 48px.
 */
const SECTION_GAP = "mt-12";

/**
 * Per-shop title, description, and canonical URL. The embed surface points its
 * canonical at the standalone page: the same departures rendered at two URLs is
 * exactly the duplication a canonical exists to resolve (docs ADR
 * 20260729-booking-page-structured-data).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return { title: "Schedule — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = shop.description ?? shop.tagline ?? t("schedule.diverDescription");
  return {
    title: `Dive schedule — ${shop.name}`,
    description,
    alternates: { canonical: publicSchedulePath(shop.slug) },
    robots: shopSearchListingRobots(shop),
    openGraph: {
      ...openGraphSite,
      title: `Dive schedule — ${shop.name}`,
      description,
      url: publicSchedulePath(shop.slug),
    },
  };
}

/**
 * The public, canonical, embeddable dive schedule — a day-grouped agenda of
 * upcoming departures with a month rail above it, reviews, and the
 * last-minute-deal signup, and the root of a shop's diver namespace. Every visitor sees this exact page, signed in or not: the staff
 * operations board (KPI tiles, add/move/copy/remove) lives at
 * `/shop/[shopSlug]/schedule/board` instead (Lens 17 — this route used to be
 * four products crammed onto one, including a staff branch that could never
 * coexist with the diver-facing content it shared a component tree with; see
 * docs/product/features/story-backlog.md and the archive it supersedes).
 *
 * It used to live at `/shop/[shopSlug]/schedule`, a public page inside the
 * staff namespace held open by an allowlist; that URL now 308s here (ADR
 * 20260803-public-shop-namespace).
 */
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    month?: string;
    after?: string;
    /** The stack of every earlier page's cursor, oldest first — how
     * "Previous page" (task 17) finds its way back without a backward
     * keyset query. See src/lib/schedule-pagination.ts. */
    back?: string;
    embed?: string;
    /** `host` when the loader drew the credit on the host page — see `public/embed.js`. */
    credit?: string;
    hasSpace?: string;
    tripType?: string;
    canDive?: string;
    hideAbove?: string;
    /** One of the shop's own words for a kind of day (ADR 20260904-reef-all-the-way-down). */
    lens?: string;
  }>;
}) {
  await connectionForRoute("/s/[shopSlug]"); // live data — render per request, not at build
  const { shopSlug } = await params;
  const { month, after, back, embed, hasSpace, tripType, canDive, hideAbove, credit, lens } =
    await searchParams;
  const hasSpaceFilter = hasSpace === "1";
  const tripTypeFilter = tripType === "fun_dive" || tripType === "course" ? tripType : undefined;
  // **A stated preference, never a gate** (issue #696). It marks the list and
  // nothing else: `src/lib/trip-admission.ts` and `src/lib/readiness.ts` are
  // untouched by it, a diver who says "Rescue" here and books an Advanced
  // charter still meets the ordinary admission check, and the answer is not
  // persisted anywhere or prefilled into the booking form — a casual filter tap
  // must never become evidence a readiness engine reasons about (ADRs
  // 20260814-self-declared-cards, 20260820-attested-at-booking-verified-at-boarding).
  const canDiveFilter = DECLARABLE_CERTIFICATION_LEVELS.find((level) => level === canDive);
  const hideAboveFilter = Boolean(canDiveFilter) && hideAbove === "1";
  // Embed mode is the compact, chrome-light surface a shop pastes into its own
  // website (docs ADR 20260726-schedule-embed) — never for staff, who always
  // arrive signed in and never via a third-party iframe.
  const isEmbed = embed === "1";
  const hostCarriesCredit = credit === "host";
  /**
   * **How many departures the widget shows before it hands over.**
   *
   * The recommended snippet frames this page at 900px tall; the full list
   * rendered **2,734px** into it, so a shop's own website got a scrollbar
   * inside a scrollbar and showed about a third of the schedule — worst on a
   * phone, where a visitor swiping over the frame cannot tell which thing they
   * are scrolling and momentum hands off unpredictably between the two
   * (issue #805).
   *
   * A frame cannot guess the right height, because the height *is* however many
   * departures a shop runs — 900px is right for a quiet shop and wrong for a
   * busy one, and busy is the shop that most wants the widget. So the widget
   * stops trying to be the schedule and becomes a window onto it: the next few
   * departures and one link to the real page.
   *
   * Six because that is roughly a week for a shop running a boat a day, and it
   * fits the frame at both widths the snippet allows.
   */
  const EMBED_TRIP_LIMIT = 4;
  const db = await getDb();
  // The same row `generateMetadata` above already read: one query for both
  // (issue #1737).
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) {
    notFound();
  }

  // The page is served in pieces: the list is one keyset page — nothing loads
  // every trip at once, so a shop with hundreds of departures on the books
  // stays quick.
  const tz = shop.timezone;
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const currency = toShopCurrency(shop.currency);
  const now = nowDate();

  // When the diver has explicitly paged to a month on the rail, bound the trip list to that month —
  // the label above the list and the list itself must never disagree.
  const explicitMonth = parseMonthKey(month);
  const listMonthBounds = explicitMonth ? scheduleMonthBounds(explicitMonth, tz) : null;

  const {
    lenses,
    activeLens,
    range,
    upcoming,
    nextCursor,
    reviewAggregate,
    activeCourses,
    boats,
    everHadDeparture,
    diveSitesByTrip,
    requirementsByTrip,
    shelfNextStarts,
  } = await readSchedulePage(db, shop, {
    isEmbed,
    lens,
    after,
    now,
    listMonthBounds,
    hasSpaceFilter,
    tripTypeFilter,
  });
  const view: ScheduleView = {
    shopSlug,
    month,
    isEmbed,
    hasSpaceFilter,
    tripTypeFilter,
    canDiveFilter,
    hideAboveFilter,
    activeLens,
  };
  const { filterSuffix, lensHref } = scheduleViewLinks(view);

  // The widget shows a window; the page shows the schedule. Sliced here rather
  // than asked for in the query so the two surfaces read the same list and can
  // never disagree about what is next (issue #805).
  // Declared below, once the composed requirements are known — hiding has to
  // happen before the embed slice, or an embed showing three departures could
  // show fewer than three for no visible reason.
  // The zone the times below are in, for the widget's footer. Anchored on a
  // real departure so a shop that switches to summer time reads correctly
  // either side of the change, falling back to the range's first.
  const zoneAnchor = upcoming[0]?.startsAt ?? range.first;
  const zoneNote =
    isEmbed && zoneAnchor
      ? t("schedule.timesInZoneFooter", {
          shop: shop.name,
          zone: timeZoneLabel(zoneAnchor, locale, tz),
        })
      : null;
  const hasUpcoming = range.first !== null;

  const { quiet, quietLine } = scheduleOffSeason({
    isEmbed,
    now,
    range,
    reopensOn: shop.reopensOn,
    locale,
    tz,
    t,
  });

  const aboveStatedLevel = aboveStatedLevelIds(upcoming, requirementsByTrip, canDiveFilter);

  const visibleUpcoming = hideAboveFilter
    ? upcoming.filter((trip) => !aboveStatedLevel.has(trip.id))
    : upcoming;
  const listedTrips = isEmbed ? visibleUpcoming.slice(0, EMBED_TRIP_LIMIT) : visibleUpcoming;

  const { nextBoat, filteredView, skippedBoats, firstSkippedBoat } = scheduleNextBoat({
    visibleUpcoming,
    isEmbed,
    explicitMonth,
    after,
    hasSpaceFilter,
    tripTypeFilter,
    hideAboveFilter,
    activeLens,
  });
  const { identityPanels, panelsBeside, nextBoatFlat } = identityBand(
    quiet.quiet,
    !!nextBoat,
    shop,
  );

  const { currentMonth, lastTripMonth, prevMonthKey, nextMonthKey } = scheduleMonthRail({
    range,
    explicitMonth,
    now,
    tz,
  });

  // The board's last month says which runs keep going (`PromotedDateAsk`).
  const settled = explicitMonth !== null || !nextCursor;
  const atBoardsEnd =
    !isEmbed && !quiet.quiet && viewsBoardsEnd(currentMonth, lastTripMonth, settled);
  const runningLines = atBoardsEnd
    ? seriesHorizonLines(t, locale, await listRunningPublicSeries(db, shop.id, now))
    : [];

  // Structured data describes the canonical standalone page only — see
  // generateMetadata above. The graph's `aggregateRating` and `review` items
  // both need the review fetch, which streams in with the reviews section
  // below (<ScheduleReviewsSection>) rather than blocking here — it renders
  // the JsonLd script tag alongside the reviews it describes. Reviews only
  // ever come from that page's own top-level call: they're the same rows
  // `<ShopReviews>` renders directly beneath it, never threaded into a
  // per-trip Event's organizer.
  const showReviews = !isEmbed;

  const { dayKeyOf, whenWord } = scheduleDayWords(now, locale, tz);

  const weekRows = weekLedgerRows({
    listedTrips,
    lenses,
    diveSitesByTrip,
    requirementsByTrip,
    aboveStatedLevel,
    dayKeyOf,
    shopSlug,
    isEmbed,
    timezone: shop.timezone,
    currency,
    locale,
    t,
  });
  /**
   * **The one gate for the week's list.** The list, or the state standing in
   * for it, is chosen on this name, and the pager row under it reads the same
   * name for its margin: the list hands its last row's room back below itself
   * and only a row under the list takes it back in. Two spellings of the
   * condition would disagree the day a state is added to one of them.
   */
  const showsWeekLedger = hasUpcoming && visibleUpcoming.length > 0;
  const pager = schedulePagerHrefs({ view, after, back, nextCursor });

  const shelfCourses = shelfCourseCards({
    activeCourses,
    shelfNextStarts,
    shop,
    shopSlug,
    currency,
    locale,
    t,
  });

  return (
    <main
      className={
        isEmbed
          ? "w-full flex-1 px-3 py-4"
          : SHOP_MAIN_CLASS
      }
    >
      {/* **The shop leads, not the word "Schedule"** (ADR
          20260827-clearwater-surface-language, decision 8). This was an h1
          reading "Schedule" over a DiveDay sentence about finding your next day
          on the water — identical on every shop in the product — with the
          shop's conservation claims in a bordered card beneath it. The identity
          band and the next boat now share one vertical reading flow, so the
          bookable object sits right under the shop's own words. Neither renders
          inside the frame, where the widget stays the list-first window onto the
          schedule that issue #805 made it. */}
      {isEmbed ? null : (
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
          {/* The logo is the nav's mark (B16), never a tile beside the hero. */}
          {/* **The next boat beside the shop, from `lg` up.** Stacked, the
              photograph, its name band and the next-boat card filled the whole
              first screen of a 1280×900 window, and the schedule a diver came
              for started 1,220px down. Side by side the card sits level with
              the photograph and the schedule starts on the first screen. A
              phone keeps the stack: one column is all it has. */}
          <div
            className={`min-w-0 flex-1 ${
              panelsBeside
                ? "lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6"
                : ""
            }`}
          >
            <ShopfrontHero
              beside={panelsBeside}
              name={shop.name}
              tagline={shop.tagline}
              description={shop.description}
              aggregate={reviewAggregate}
              heroImage={
                shop.brandHeroImageUrl
                  ? { url: shop.brandHeroImageUrl, alt: shop.brandHeroImageAlt ?? "" }
                  : null
              }
              badges={parseBrandBadges(shop.brandBadges)}
              establishedYear={shop.establishedYear}
              locale={locale}
              t={t}
            />
            {/* **One row, not a column of narrow cards.** Each of these panels
                held `max-w-md` of its own, so on a 1152px page they stacked
                down the left third and left the other two-thirds empty — three
                boxes reading as three unrelated things with nothing beside
                them. They are one band: the same three facts, laid out as a row
                at `md` and up and as the old stack on a phone. `grid-flow-col`
                with `auto-cols-fr` rather than a fixed `grid-cols-3`, because
                how many of them render is a fact about the shop's day — no
                live boat — and the row has to read at one, two or three. Order
                is the reading order it has always been: the quiet, the boat
                that is out, the next one with space. */}
            {identityPanels > 0 ? (
              <div
                className={`mt-6 grid gap-4 md:auto-cols-fr md:grid-flow-col ${
                  panelsBeside ? "lg:mt-0 lg:grid-flow-row" : ""
                }`}
              >
                {/* **The quiet, before the boat** (N-45). A shop with nothing on
                    the water for a month leads with that fact rather than with a
                    departure seven weeks out, which a visitor would otherwise have
                    to date-subtract for themselves. It replaces the schedule's
                    terminal empty state below rather than joining it, and the
                    page's one primary becomes the composer's own submit — the
                    arrangement `NextBoatCard` has always promised for a page with
                    no bookable boat. */}
                {quiet.quiet ? (
                  <OffSeasonPanel heading={t("schedule.offSeason.heading")} line={quietLine} />
                ) : null}
                {nextBoat ? (
                  <NextBoatCard
                    href={`${publicTripPath(shopSlug, nextBoat.id)}#book`}
                    when={whenWord(nextBoat.startsAt)}
                    time={formatTime(nextBoat.startsAt, locale, shop.timezone)}
                    title={nextBoat.title}
                    description={nextBoat.description}
                    spots={scheduleSeatState(t, nextBoat).text}
                    price={seatPriceLabel(nextBoat, currency, locale)}
                    skipped={skippedBoats}
                    firstSkippedTime={
                      firstSkippedBoat
                        ? formatTime(firstSkippedBoat.startsAt, locale, shop.timezone)
                        : undefined
                    }
                    filtered={filteredView}
                    flat={nextBoatFlat}
                    t={t}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* The shop's photo strip, between who the shop is and its boats. Not
          in the frame, which stays the list-first window onto the schedule. */}
      {!isEmbed && shop.shopfrontPhotoUrls.length > 0 ? (
        <div className="mt-8">
          <ShopPhotoStrip urls={shop.shopfrontPhotoUrls} label={t("schedule.shopPhotos")} />
        </div>
      ) : null}

      {/* **The board itself, and nothing where there is no board** (N-45).
          A shop with nothing public on the books renders no "Schedule"
          heading, no timezone line and no dashed box: the off-season card
          above has already said what there is to say, and a section heading
          over nothing is the page apologising. The frame keeps its own
          terminal state (see the empty state inside). */}
      {hasUpcoming || isEmbed ? (
        <div className={isEmbed ? undefined : SECTION_GAP}>
          {isEmbed ? null : (
            <div className="mb-4">
              <h2 className={`font-brand-display ${SECTION_TITLE_CLASS}`}>{t("schedule.title")}</h2>
              {/* Whose morning is "7:30 AM"? A diver comparing boats from another
                  timezone reads these times against their own clock unless
                  something says otherwise (review finding I18N-L2) — so it is
                  said once, with the times it qualifies rather than in a masthead
                  two sections above them. Anchored to a real departure, because a
                  zone's *name* moves with daylight saving and a schedule read in
                  March may be listing July boats. */}
              {(() => {
                const anchor = upcoming[0]?.startsAt ?? range.first;
                if (!anchor) return null;
                return (
                  <p className="mt-1 text-sm text-muted">
                    {t("schedule.timesInZone", {
                      shop: shop.name,
                      zone: timeZoneLabel(anchor, locale, tz),
                    })}
                  </p>
                );
              })()}
            </div>
          )}

          {/* The week's days, one tap from each (UX audit #18), over the same
              days the list below runs (B18). */}
          {showsWeekLedger && !isEmbed ? (
            <DayJumpStrip rows={weekRows} label={t("schedule.jumpToDay")} />
          ) : null}

          {/* **One filter row** (visual review 2026-10-24, B18): the lens
              chips (ADR 20260904-reef-all-the-way-down, decision 2), the "More
              filters" disclosure, and the month link at the row's end, all
              inside the filter form, which must stay directly before the list:
              `e2e/schedule-filters.spec.ts` and `e2e/trip-admission.spec.ts`
              address the departures as `form + ul`. None of it renders in the
              frame (issue #805): `FilterChips` is a `<nav>` landmark and
              `?embed=1` promises the host page none. The URL carries the
              filters and the list re-renders server-side (ADR
              20260812-javascript-is-required). */}
          {hasUpcoming && !isEmbed ? (
            <ScheduleFilters
              embed={isEmbed}
              month={month ?? null}
              lens={activeLens?.slug ?? null}
              tripTypeFilter={tripTypeFilter ?? null}
              hasSpaceFilter={hasSpaceFilter}
              canDiveFilter={canDiveFilter ?? null}
              hideAboveFilter={hideAboveFilter}
              copy={scheduleFilterCopy(t)}
              chips={
                lenses.length > 0 ? (
                  <FilterChips
                    label={t("schedule.lenses.railLabel")}
                    chips={[
                      {
                        key: "all",
                        href: lensHref(null),
                        active: !activeLens,
                        label: t("schedule.lenses.all"),
                      },
                      // The shop's own word, verbatim and untranslated.
                      ...lenses.map((entry) => ({
                        key: entry.slug,
                        href: lensHref(entry.slug),
                        active: activeLens?.id === entry.id,
                        label: entry.name,
                      })),
                    ]}
                  />
                ) : null
              }
              monthRail={
                prevMonthKey || nextMonthKey || explicitMonth ? (
                  <MonthRail
                    aria-label={t("schedule.monthNav")}
                    month={monthLabel(currentMonth, locale)}
                    className=""
                    {...monthRailSides(shopSlug, prevMonthKey, nextMonthKey, filterSuffix, t)}
                  />
                ) : null
              }
            />
          ) : null}

          {/* **The terminal state, now only inside the frame.** On the page
              itself an empty board is the off-season card above plus the
              composer below it (N-45) — a heading, a dashed box and a "check
              back soon" underneath that card would be the same news three times,
              and the middle one is the sentence that reads as a shop which has
              stopped. The widget keeps it: `?embed=1` renders neither of those
              two, and a blank iframe on a shop's own website says nothing at
              all. The list itself renders on `showsWeekLedger`, the name the
              pager row's margin below reads too. */}
          {showsWeekLedger ? (
            <WeekLedger
              rows={weekRows}
              listLabel={t("schedule.tripListLabel")}
              stickyTop={isEmbed ? "top-0" : "top-(--chrome-h)"}
            />
          ) : hasUpcoming ? (
            <EmptyState
              title={filteredView ? t("schedule.filters.noMatches") : t("schedule.noTripsMonth")}
            />
          ) : isEmbed ? (
            <EmptyState
              title={t("schedule.noTrips")}
              body={t(
                shop.contactPhone || shop.contactEmail
                  ? "schedule.noTripsPublic"
                  : "schedule.noTripsPublicNoPhone",
              )}
            />
          ) : null}
        </div>
      ) : null}
      {/* No pager in the frame either. "Show later departures" is the same
          nested navigation the fixed height caused — a second page loaded
          inside somebody else's site — and the widget already offers the way
          out to the real schedule below (issue #805). Under the week's list
          the row takes `WEEK_LEDGER_FOLLOWER_CLASS`: the list hands its last
          row's 16px (20px) of hover room back below itself, and this row
          takes it into its margin, so it still sits 20px under that row's
          box. Under an empty state (a month or a filter with nothing in it)
          no room is handed back. */}
      {!isEmbed && (nextCursor || after || explicitMonth) ? (
        <SchedulePagerRow
          pager={pager}
          showsBackToNext={Boolean(after || explicitMonth)}
          followsWeekLedger={showsWeekLedger}
          t={t}
        />
      ) : null}
      <PromotedDateAsk
        t={t}
        shopSlug={shopSlug}
        locale={locale}
        timeZone={tz}
        quiet={quiet.quiet}
        dateRequestsEnabled={shop.dateRequestsEnabled}
        runningLines={runningLines}
        className={SECTION_GAP}
      />
      {/* **The shelves.** What the shop teaches, then what divers said about
          it — the two things a diver weighs after the boats and before the
          three asks below. Neither renders inside the frame, which stays the
          compact booking widget (docs ADR 20260726-schedule-embed). The courses
          shelf renders on any shop with an active course, including one with no
          departures at all: a course-led shop with an empty board is a real
          day-zero shape, and the shelf is the only thing on that page with
          something to sell. */}
      {isEmbed ? null : (
        <CoursesShelf
          courses={shelfCourses}
          allCoursesHref={publicCoursesPath(shopSlug)}
          className={SECTION_GAP}
          t={t}
        />
      )}
      {/* The boats, by name and seats (Harbor — ADR 20260901-diveday-reimagined:
          the storefront is the shop's website, and a shop's site always names
          its hulls). Only when the shop has any: an empty fleet is not a section. */}
      {isEmbed || boats.length === 0 ? null : (
        <section aria-labelledby="boats-heading" className={SECTION_GAP}>
          <h2 id="boats-heading" className={`font-brand-display ${SECTION_TITLE_CLASS}`}>
            {t("schedule.boatsHeading")}
          </h2>
          {/* The course shelf's columns and gutter, so the boat cards stand
              under the course cards' edges (K-227). */}
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boats.map((boat) => (
              // The card itself, not a hand-rolled copy at `px-5 py-4`: its
              // words started 4px in from every other card's on a phone.
              <li
                key={boat.id}
                className={sectionCardClass({
                  className: "flex min-h-14 flex-col justify-center gap-1",
                })}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`font-brand-display ${ITEM_TITLE_CLASS} tracking-tight`}>
                    {boat.name}
                  </span>
                  <span className="shrink-0 text-sm text-muted tabular-nums">
                    {t("schedule.boatSeats", { count: boat.capacity })}
                  </span>
                </div>
                {/* The shop's own sentence, or nothing: never DiveDay filler. */}
                {boat.description ? (
                  <p className="text-sm text-muted text-pretty">{boat.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {isEmbed ? null : <MonthSightingsSection shop={shop} tz={tz} locale={locale} t={t} />}
      {/* Reviews are a full-page, diver-facing signal: the embed stays a compact booking widget
          (docs ADR 20260726-schedule-embed), and staff moderate from /shop/[shopSlug]/reviews
          rather than reading them here. The published-review list streams in behind the shell and
          trip list instead of gating them (docs task 119 follow-up: streaming the schedule); the
          section also carries the page's structured-data script tag, since its `review` items
          come from the same fetch. The aggregate is already in hand — it belongs to the hero now,
          and is handed down here rather than read a second time. */}
      {showReviews ? (
        <Suspense fallback={<ShopReviewsSkeleton className={SECTION_GAP} />}>
          <ScheduleReviewsSection
            db={db}
            shop={shop}
            aggregate={reviewAggregate}
            upcoming={upcoming}
            origin={publicAppUrl()}
            locale={locale}
            tz={tz}
            t={t}
          />
        </Suspense>
      ) : null}
      {/* **The three asks under the board, as one object.**

          Everything here answers the same question — "the schedule above did
          not have what I need" — so they are one group of rows rather than
          three cards stacked down the page. They had drifted into three: three
          top margins, three heading sizes (one of them as loud as this page's
          `h1`, one not a heading element at all), and no chevron on any of
          them, since `display: flex` on a `<summary>` suppresses the UA's own
          triangle. A reader arriving at the bottom of the schedule saw three
          unrelated boxes of empty space and no sign that any of them opened.

          Ordered by how close each one is to the schedule the reader has just
          read past: ask for a date that is not on the board, then be told when
          a seat goes cheap, then — a different errand entirely — recover the
          link to a booking already made.

          The Client Components on this page that read copy sit under one
          provider, so the diver bundle crosses to the browser once, for the
          namespaces those components need and no more. */}
      {/* The group stands down entirely when nothing is left in it: a shop
          that has never run a departure offers neither the deal list nor the
          find-my-link door, and on a quiet board the date request has moved
          above — which between them can empty the list under the heading. */}
      {!isEmbed && (everHadDeparture || (!quiet.quiet && shop.dateRequestsEnabled)) ? (
        <section aria-labelledby="more-ways-heading" className={SECTION_GAP}>
          <h2 id="more-ways-heading" className={`font-brand-display ${SECTION_TITLE_CLASS}`}>
            {t("schedule.moreWaysHeading")}
          </h2>
          <DiverIntlProvider
            locale={locale}
            timeZone={tz}
            // `course` is where the diver-facing certification-level words live
            // (`DIVER_CERTIFICATION_LEVEL_KEYS`), shared with the public course
            // pages — `DiveDeclarationFields` inside the deal-list form reads them.
            namespaces={["lastMinute", "findMyBooking", "inquiry", "common", "course"]}
          >
            <MoreWaysRows
              shopSlug={shopSlug}
              quiet={quiet.quiet}
              promotedAsk={runningLines.length > 0}
              switches={shop}
              everHadDeparture={everHadDeparture}
              t={t}
            />
          </DiverIntlProvider>
        </section>
      ) : null}
      {/* "Our year": the shop's own year in counts, last, and only with its yes. */}
      {!isEmbed && shop.publicYearEnabled ? (
        <Suspense fallback={null}>
          <OurYearSection shop={shop} locale={locale} t={t} className={SECTION_GAP} />
        </Suspense>
      ) : null}
      {/* Human-discovery footer, embed mode only. */}
      <EmbedFooter
        isEmbed={isEmbed}
        hostCarriesCredit={hostCarriesCredit}
        shopSlug={shopSlug}
        zoneNote={zoneNote}
        t={t}
      />
    </main>
  );
}

/**
 * The review aggregate and published-review list, isolated behind its
 * `<Suspense>` boundary above — the slowest of the page's independent reads,
 * now free to stream in behind the shell and trip list rather than gate them.
 * Also carries the page's structured-data script tag: its `aggregateRating`
 * and `review` items both come from this same fetch, so one read serves all
 * three rather than three.
 */
async function ScheduleReviewsSection({
  db,
  shop,
  aggregate,
  upcoming,
  origin,
  locale,
  tz,
  t,
}: {
  db: AppDb;
  shop: NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>;
  /** Read once, at the top of the page, for the hero's rating line. */
  aggregate: ReviewAggregate;
  upcoming: Awaited<ReturnType<typeof pagedUpcomingTripsWithCounts>>["trips"];
  origin: string | null;
  locale: string;
  tz: string;
  t: DiverTranslator;
}) {
  // Off, no review is listed and none rides in the structured data; the
  // schedule's own events still do.
  const reviews = shop.reviewsEnabled ? await listPublishedShopReviews(db, shop.id) : [];
  const structuredData = scheduleJsonLd(
    shop,
    upcoming.map((trip) => ({
      id: trip.id,
      title: trip.title,
      description: trip.description,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      booked: trip.booked,
      priceCents: perDiverBookingPriceCents(trip, trip.course),
      diveSiteName: trip.diveSite?.name ?? null,
      conditionsHold: trip.conditionsHold,
    })),
    origin,
    aggregate,
    reviews.flatMap((review) =>
      review.comment
        ? [
            {
              reviewer: review.reviewer,
              rating: review.rating,
              comment: review.comment,
              divedAt: review.divedAt,
            },
          ]
        : [],
    ),
    {
      // The agent-facing availability document (issue #1427) — named only
      // while the shop is listed; an opted-out shop's document is a 404, and
      // a graph that pointed at one would be publishing a broken link.
      availabilityUrl: shop.searchListingOptOutAt
        ? null
        : absoluteUrl(origin, publicAvailabilityPath(shop.slug)),
    },
  );
  return (
    <>
      <JsonLd data={structuredData} />
      <ShopReviews
        className={SECTION_GAP}
        aggregate={aggregate}
        reviews={reviews}
        shopSlug={shop.slug}
        locale={locale}
        timezone={tz}
        t={t}
      />
    </>
  );
}
