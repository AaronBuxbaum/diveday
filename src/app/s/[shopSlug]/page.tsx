import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { submitInquiryAction } from "@/app/actions/inquiry";
import { DateRequestForm } from "@/components/DateRequestForm";
import { EmptyState } from "@/components/EmptyState";
import { JsonLd } from "@/components/JsonLd";
import { ShopReviews } from "@/components/ShopReviews";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { type AppDb, getDb } from "@/db/client";
import { tripRequirementSummaries } from "@/db/readiness";
import { getShopReviewAggregate, listPublishedShopReviews } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import {
  countShopTrips,
  pagedUpcomingTripsWithCounts,
  tripDiveSiteSummaries,
  upcomingScheduleRange,
} from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { dateRequestCopy } from "@/i18n/date-request-copy";
import type { DiverTranslator } from "@/i18n/messages";
import { tripRequirementMarkers } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import { addMonths, type MonthRef, monthKey, monthLabel, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import {
  formatDayParts,
  formatMoneyScanned,
  formatShortDate,
  formatTime,
  formatTimeRange,
} from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { publicCoursePath, publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import {
  decodeCursorStack,
  encodeCursorStack,
  popCursor,
  pushCursor,
} from "@/lib/schedule-pagination";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { scheduleJsonLd } from "@/lib/structured-data";
import { capacityLabel, isFull, pinnedNextDeparture } from "@/lib/trips";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { FindMyBookingForm } from "./_components/FindMyBookingForm";
import { LastMinuteListForm } from "./_components/LastMinuteListForm";
import { ScheduleFilters } from "./_components/ScheduleFilters";

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

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
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) return { title: "Schedule — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = shop.description ?? shop.tagline ?? t("schedule.diverDescription");
  return {
    title: `Dive schedule — ${shop.name}`,
    description,
    alternates: { canonical: publicSchedulePath(shop.slug) },
    robots: shopSearchListingRobots(shop.searchListingOptOutAt),
    openGraph: {
      ...openGraphSite,
      title: `Dive schedule — ${shop.name}`,
      description,
      url: publicSchedulePath(shop.slug),
      ...(shop.logoUrl ? { images: [{ url: shop.logoUrl, alt: `${shop.name} logo` }] } : {}),
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
    hasSpace?: string;
    tripType?: string;
  }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { month, after, back, embed, hasSpace, tripType } = await searchParams;
  const hasSpaceFilter = hasSpace === "1";
  const tripTypeFilter = tripType === "fun_dive" || tripType === "course" ? tripType : undefined;
  // Embed mode is the compact, chrome-light surface a shop pastes into its own
  // website (docs ADR 20260726-schedule-embed) — never for staff, who always
  // arrive signed in and never via a third-party iframe.
  const isEmbed = embed === "1";
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
  // The view a diver has built — month, embed mode, and both list filters —
  // must survive every link that re-renders this page. A pager or month arrow
  // that drops `hasSpace` quietly hands back the full unfiltered list with
  // the checkbox reset, with nothing saying why.
  const withViewParams = (params: URLSearchParams) => {
    if (month) params.set("month", month);
    if (isEmbed) params.set("embed", "1");
    if (hasSpaceFilter) params.set("hasSpace", "1");
    if (tripTypeFilter) params.set("tripType", tripTypeFilter);
    return params;
  };
  /** The same filters as `withViewParams`, for links that already carry their own `?month=`. */
  const filterSuffix = `${hasSpaceFilter ? "&hasSpace=1" : ""}${
    tripTypeFilter ? `&tripType=${tripTypeFilter}` : ""
  }`;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
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

  // Shop-local month boundaries, in UTC, for a given calendar month.
  const monthBoundsUtc = (ref: MonthRef) => {
    const monthStart = wallTimeToUtc(
      { year: ref.year, month: ref.month, day: 1, hour: 0, minute: 0 },
      tz,
    );
    const nextRef = addMonths(ref, 1);
    const monthEnd = wallTimeToUtc(
      { year: nextRef.year, month: nextRef.month, day: 1, hour: 0, minute: 0 },
      tz,
    );
    return { monthStart, monthEnd };
  };

  // When the diver has explicitly paged to a month on the rail, bound the
  // trip list to that month — the label above the list and the list itself
  // must never disagree.
  const explicitMonth = parseMonthKey(month);
  const listMonthBounds = explicitMonth ? monthBoundsUtc(explicitMonth) : null;

  // The review aggregate and published-review list stream in separately
  // (below, via <ScheduleReviewsSection>) rather than joining this batch —
  // reviews are a slower, independent read the shell and trip list never
  // needed to wait behind (docs task 119 follow-up: streaming the schedule).
  const [range, { trips: upcoming, nextCursor }] = await Promise.all([
    upcomingScheduleRange(db, shop.id, now, { publicOnly: true }),
    pagedUpcomingTripsWithCounts(db, shop.id, {
      cursor: after,
      now,
      ...listMonthBounds,
      hasSpace: hasSpaceFilter ? true : undefined,
      tripType: tripTypeFilter,
      publicOnly: true,
    }),
  ]);
  // The widget shows a window; the page shows the schedule. Sliced here rather
  // than asked for in the query so the two surfaces read the same list and can
  // never disagree about what is next (issue #805).
  const listedTrips = isEmbed ? upcoming.slice(0, EMBED_TRIP_LIMIT) : upcoming;
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
  /**
   * **Has this shop ever run a departure** — which is not what `hasUpcoming`
   * asks.
   *
   * `upcomingScheduleRange` is scheduled, public, and ahead of now, so it goes
   * false for a shop between seasons with three hundred departures behind it,
   * and for one whose whole board is currently private. The deal list below
   * stands down on that signal, and standing it down for those two shops is
   * backwards: an off-season visitor is exactly the person worth telling when a
   * boat needs to fill seats at a discount. The count only runs in the rare
   * case the cheap signal already says no.
   */
  const everHadDeparture = hasUpcoming || (await countShopTrips(db, shop.id)) > 0;
  // Where each departure on this page actually goes. One read for the page,
  // not one per card — and read off the *dives* rather than `trips.dive_site_id`
  // (dive one's site, copied onto the trip row), so a two-site day names both
  // and a day whose open tank is the first one still names the site it visits.
  const diveSitesByTrip = await tripDiveSiteSummaries(
    db,
    shop.id,
    upcoming.map((trip) => trip.id),
  );

  // What each departure asks of anybody — the trip's own gate folded with every
  // site it visits, one read for the page. A property of the *trip*, so it is
  // safe on an anonymous page: it says nothing about any reader, and the map
  // holds only the departures that demand something (issue #695).
  const requirementsByTrip = await tripRequirementSummaries(
    db,
    shop.id,
    upcoming.map((trip) => trip.id),
  );

  // The pinned quick link to the soonest departure with room — rendered only
  // when that answer is *not* already the agenda's own first row, i.e. when
  // the soonest boats are full and the bookable one is buried mid-list
  // (`pinnedNextDeparture`; principle 9 — the pin used to restate the first
  // row card-for-card two hundred pixels above it). Only on the default
  // (unbounded) view — once a diver has paged the calendar to a specific
  // month, `upcoming` is bounded to it and its first trip is no longer
  // necessarily the shop's actual next departure.
  const nextDeparture = !explicitMonth ? pinnedNextDeparture(upcoming) : null;

  // The month rail: one row of "where am I / step a month" instead of the
  // full month grid this page used to open with. The grid duplicated every
  // departure already listed below it (once as an unreadable chip on a phone),
  // spent the whole first screen on empty cells, and stacked a second
  // navigation system on top of the list's own pager — a shop-operator's
  // month-planning view imposed on a diver who thinks in "this weekend."
  // What the grid actually did for a diver — jump the list to a month —
  // survives here as the same `?month=` links with the same accessible names.
  const ordinal = (ref: MonthRef) => ref.year * 12 + (ref.month - 1);
  const monthOf = (date: Date): MonthRef => {
    const wall = utcToWallTime(date, tz);
    return { year: wall.year, month: wall.month };
  };
  const todayWall = utcToWallTime(now, tz);
  const firstTripMonth = range.first ? monthOf(range.first) : null;
  const lastTripMonth = range.last ? monthOf(range.last) : null;
  const currentMonth: MonthRef = explicitMonth ??
    firstTripMonth ?? { year: todayWall.year, month: todayWall.month };
  const prev = addMonths(currentMonth, -1);
  const next = addMonths(currentMonth, 1);
  const prevMonthKey =
    firstTripMonth && ordinal(prev) >= ordinal(firstTripMonth) ? monthKey(prev) : null;
  const nextMonthKey =
    lastTripMonth && ordinal(next) <= ordinal(lastTripMonth) ? monthKey(next) : null;

  // Structured data describes the canonical standalone page only — see
  // generateMetadata above. The graph's `aggregateRating` and `review` items
  // both need the review fetch, which streams in with the reviews section
  // below (<ScheduleReviewsSection>) rather than blocking here — it renders
  // the JsonLd script tag alongside the reviews it describes. Reviews only
  // ever come from that page's own top-level call: they're the same rows
  // `<ShopReviews>` renders directly beneath it, never threaded into a
  // per-trip Event's organizer.
  const showReviews = !isEmbed;

  return (
    <main
      className={
        isEmbed
          ? "w-full flex-1 px-3 py-4"
          : "mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
      }
    >
      {/* One breath of masthead, not five: the old eyebrow / display title /
          description / timezone-line / hero-card stack pushed the first
          departure most of a screen down on a phone, all of it saying "this is
          a schedule" — which the list below already proves. The h1 stays (it
          is the page's name, for readers and search alike) but at reading
          size, and the description and timezone sentence share one muted
          paragraph beneath it. The visual lead of the page is the next
          departure itself — the fact a diver arrives for (principle 10). */}
      {isEmbed ? null : (
        <header className="mb-6">
          <div className="flex items-start gap-4">
            {shop.logoUrl ? (
              // biome-ignore lint/performance/noImgElement: dynamic user-uploaded logo
              <img
                src={shop.logoUrl}
                alt=""
                className="size-16 shrink-0 rounded-2xl border border-border bg-surface object-cover shadow-xs"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight">{t("schedule.title")}</h1>
              {shop.tagline ? (
                <p className="mt-0.5 text-base font-medium text-foreground/90">{shop.tagline}</p>
              ) : null}
              <p className="mt-1 max-w-2xl text-sm text-muted">
                {shop.description ?? t("schedule.diverDescription")}
                {(() => {
                  // Whose morning is "7:30 AM"? A diver comparing boats from
                  // another timezone reads these times against their own clock
                  // unless something says otherwise (review finding I18N-L2).
                  // Stated once, above everything that shows a time. Anchored to
                  // the first departure on the page, because a zone's *name*
                  // moves with daylight saving and a schedule read in March may
                  // be listing July boats.
                  const zoneAnchor = upcoming[0]?.startsAt ?? range.first;
                  if (!zoneAnchor) return null;
                  return (
                    <>
                      {" "}
                      {t("schedule.timesInZone", {
                        shop: shop.name,
                        zone: timeZoneLabel(zoneAnchor, locale, tz),
                      })}
                    </>
                  );
                })()}
              </p>
            </div>
          </div>
        </header>
      )}
      {/* **The timezone sentence moved to the footer**, it did not go. It is
          the same list of times and a remote booker misreading them is the
          same mistake wherever it is framed — but as the *opening line* of a
          widget on the shop's own website it was the first thing a visitor
          read, above any departure, and a local visitor would not get anything
          wrong without it (principles.md §4; issue #805). Below the
          departures, whoever needs it still finds it beside what it
          qualifies. */}

      {nextDeparture ? (
        <Link
          href={`${publicTripPath(shopSlug, nextDeparture.id)}${isEmbed ? "?embed=1" : ""}#book`}
          className="group card-scale-hint mb-10 flex flex-col gap-4 rounded-3xl border border-primary/25 bg-primary/5 p-6 shadow-sm hover:border-primary/50 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
              {t("schedule.nextDeparture.eyebrow")}
            </p>
            {/* The departure time is the hero figure — the one datum a
                returning diver came to check — with the date reading as its
                caption. Two lines, not one truncated one: on a phone a single
                line spent itself on the date and cut the trip's name (dock
                test; principle 10). */}
            <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
              {formatTime(nextDeparture.startsAt, locale, shop.timezone)}
              <span className="ml-2 text-lg font-medium text-muted">
                {formatShortDate(nextDeparture.startsAt, locale, shop.timezone)}
              </span>
            </p>
            <p className="mt-1 line-clamp-2 text-lg font-medium group-hover:text-primary">
              {nextDeparture.title}
            </p>
          </div>
          <Badge tone="primary" tabularNums className="shrink-0 self-start sm:self-center">
            {(() => {
              const label = capacityLabel(nextDeparture);
              return label.kind === "full"
                ? t("fallback.full")
                : t("fallback.spotsLeft", { count: label.remaining });
            })()}
          </Badge>
        </Link>
      ) : null}

      {hasUpcoming && !isEmbed && (prevMonthKey || nextMonthKey || explicitMonth) ? (
        // A labeled region rather than a `<nav>` landmark, matching the month
        // grid it replaced: the embed widget promises "no page chrome" as
        // literally zero navigation landmarks inside the iframe
        // (e2e/schedule-embed.spec.ts), and two month arrows don't merit one.
        <section
          aria-label={t("schedule.monthNav")}
          className="mb-4 flex flex-wrap items-center gap-2"
        >
          {/* The arrows sit beside the label they page, not floated to the
              far edge of the viewport — a control detached from its object is
              a control the reader has to go looking for (principle 10; the
              lone `›` at the right margin read as a stray glyph on a phone). */}
          <p className="text-base font-semibold">{monthLabel(currentMonth, locale)}</p>
          {prevMonthKey ? (
            <Link
              href={`${publicSchedulePath(shopSlug)}?month=${prevMonthKey}${isEmbed ? "&embed=1" : ""}${filterSuffix}`}
              aria-label={t("schedule.previousMonth")}
              scroll={false}
              className={buttonClass({
                variant: "ghost",
                size: "sm",
                className: "min-w-11 text-base",
              })}
            >
              <DiveDayIcon name="chevron-left" className="size-4" />
            </Link>
          ) : null}
          {nextMonthKey ? (
            <Link
              href={`${publicSchedulePath(shopSlug)}?month=${nextMonthKey}${isEmbed ? "&embed=1" : ""}${filterSuffix}`}
              aria-label={t("schedule.nextMonth")}
              scroll={false}
              className={buttonClass({
                variant: "ghost",
                size: "sm",
                className: "min-w-11 text-base",
              })}
            >
              <DiveDayIcon name="chevron-right" className="size-4" />
            </Link>
          ) : null}
        </section>
      ) : null}

      {/* No filters in the frame. A month pager and a "has space" checkbox are
          page furniture inside a 900px window whose whole job is "here is
          what's next" — and every control in there is one more thing competing
          with the shop's own page around it (issue #805). */}
      {hasUpcoming && !isEmbed ? (
        // Server-fed, same house pattern as the roster search in
        // AddDiverSection.tsx: the URL carries the filters and the list below
        // re-renders filtered. Changing a filter submits the form itself —
        // there is no Apply button for anyone (ADR
        // 20260812-javascript-is-required).
        <ScheduleFilters
          embed={isEmbed}
          month={month ?? null}
          tripTypeFilter={tripTypeFilter ?? null}
          hasSpaceFilter={hasSpaceFilter}
          copy={{
            tripType: t("schedule.filters.tripType"),
            allTrips: t("schedule.filters.allTrips"),
            funDive: t("schedule.filters.funDive"),
            course: t("schedule.filters.course"),
            hasSpace: t("schedule.filters.hasSpace"),
          }}
        />
      ) : null}

      {!hasUpcoming ? (
        <EmptyState
          title={t("schedule.noTrips")}
          body={t(
            shop.contactPhone || shop.contactEmail
              ? "schedule.noTripsPublic"
              : "schedule.noTripsPublicNoPhone",
          )}
        />
      ) : upcoming.length === 0 ? (
        <EmptyState
          title={
            hasSpaceFilter || tripTypeFilter
              ? t("schedule.filters.noMatches")
              : t("schedule.noTripsMonth")
          }
        />
      ) : (
        <ul className="flex flex-col" aria-label={t("schedule.tripListLabel")}>
          {(() => {
            // "Two-tank trip" (task 6) gets its plain-language explanation
            // once, on the first card that says it — every later trip
            // sharing that shape stays as it was, so a long list doesn't
            // repeat the same aside a dozen times.
            let twoTankHintShown = false;
            // The list reads as an agenda: one quiet day rule per shop-local
            // day, cards beneath it carrying only their time. Presentational
            // (`role="presentation"` + `aria-hidden`) because each card's own
            // stretched-link label already speaks its full date and time — a
            // screen reader loses nothing, and the announced item count stays
            // the number of bookable departures.
            let lastDayIso: string | null = null;
            const tripCard = (trip: (typeof upcoming)[number]) => {
              const full = isFull(trip);
              const capacityLabelValue = capacityLabel(trip);
              // Low inventory (1-2 spots) gets its own worded badge, matching
              // the urgency the booking form itself already switches to
              // ("Book the last spot") — never color alone (WCAG 1.4.1).
              const remaining =
                capacityLabelValue.kind === "left" ? capacityLabelValue.remaining : 0;
              const lowInventory = capacityLabelValue.kind === "left" && remaining <= 2;
              const capacityText =
                capacityLabelValue.kind === "full"
                  ? t("fallback.full")
                  : lowInventory
                    ? t("schedule.spotsLeftUrgent", { count: remaining })
                    : t("fallback.spotsLeft", { count: remaining });
              const showTwoTankHint = trip.plannedDives === 2 && !twoTankHintShown;
              if (showTwoTankHint) twoTankHintShown = true;
              // Every site this departure visits, and how many tanks are still
              // open — so a two-tank card can never say "Dive site · Molasses
              // Reef" beside a trip page that shows two dives.
              const diveSites = diveSitesByTrip.get(trip.id) ?? {
                sites: [],
                undecidedDives: 0,
              };
              // Course sessions are left out for the same reason the trip page
              // leaves them out: a course states its own admission rule on its
              // own page, and its itinerary's gate is deliberately not a
              // booking gate (src/lib/trip-admission.ts), so repeating the
              // site's demand here would read as a bar on the very students
              // the course exists to create.
              const requirement = trip.course ? null : (requirementsByTrip.get(trip.id) ?? null);
              const requirementMarkers = requirement ? tripRequirementMarkers(t, requirement) : [];
              const tripHref = `${publicTripPath(shopSlug, trip.id)}${isEmbed ? "?embed=1" : ""}`;
              return (
                <li key={trip.id}>
                  {/* A "stretched link" row: the whole row navigates to the
                    trip via an invisible overlay anchor, while the course
                    title keeps its own real link into the course page
                    (task 1) — two <a> tags can never nest, so the overlay
                    sits behind everything and the course link opts back
                    onto z-10 to stay reachable by mouse and keyboard alike.
                    The row itself is borderless — the agenda's hierarchy is
                    carried by the day blocks, type, and whitespace, and the
                    hover/focus surface tint is the tap affordance (design
                    principle 10: type and space before boxes). */}
                  <div className="group relative -mx-3 flex flex-col gap-2 rounded-xl px-3 py-4 transition-colors hover:bg-surface has-[a:focus-visible]:bg-surface sm:mx-0 sm:flex-row sm:items-start sm:gap-4 sm:px-4 sm:py-5">
                    <Link
                      href={tripHref}
                      className="absolute inset-0 z-0 rounded-xl"
                      aria-label={t("schedule.tripCardLabel", {
                        when: `${formatShortDate(trip.startsAt, locale, shop.timezone)} · ${formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}`,
                        trip: trip.title,
                        capacity: capacityText,
                      })}
                    />
                    {/* The date lives on the day rule above, so the card
                        carries only its time — wide enough for a formatted
                        range, and `whitespace-nowrap` so it never breaks at
                        the ordinary space before AM/PM and strands "PM" on
                        its own line. (The stretched link's aria-label keeps
                        the full date for screen readers.) */}
                    <div className="shrink-0 sm:w-40">
                      <p className="text-base font-semibold tabular-nums whitespace-nowrap">
                        {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold group-hover:text-primary">
                        {trip.title}
                      </h2>
                      {trip.isPrivate ? (
                        <p className="mt-0.5 text-sm font-medium text-primary">
                          {t("trip.privateCharterBadge")}
                        </p>
                      ) : null}
                      {trip.course ? (
                        <p className="mt-0.5 text-sm font-medium text-primary">
                          {t("schedule.courseSession")} ·{" "}
                          <Link
                            href={publicCoursePath(shopSlug, trip.course.slug)}
                            className="relative z-10 underline-offset-2 hover:underline focus-visible:underline"
                          >
                            {trip.course.title}
                          </Link>
                        </p>
                      ) : null}
                      {trip.description ? (
                        <p className="mt-0.5 text-sm text-muted">{trip.description}</p>
                      ) : null}
                      {trip.priceCents !== null ? (
                        <p className="mt-2 text-sm font-semibold tabular-nums">
                          {formatMoneyScanned(trip.priceCents, currency, locale)}{" "}
                          <span className="font-normal text-muted">{t("common.perDiver")}</span>
                        </p>
                      ) : null}
                      {/* Muted, not action-colored — a caption, not a link. And
                          when the title already names every site and there is
                          no undecided-dive note to carry, the line is the title
                          restated and stays off the card (principle 9). */}
                      {diveSites.sites.length > 0 &&
                      !(
                        diveSites.undecidedDives === 0 &&
                        diveSites.sites.every((site) =>
                          trip.title.toLowerCase().includes(site.name.toLowerCase()),
                        )
                      ) ? (
                        <p className="mt-2 text-sm text-muted">
                          {diveSites.sites.length === 1
                            ? t("schedule.diveSite")
                            : t("schedule.diveSites")}{" "}
                          ·{" "}
                          {cachedListFormat(locale, { type: "conjunction" }).format(
                            diveSites.sites.map((site) => site.name),
                          )}
                          {/* The other half of the count: a two-tank day with
                              one site is a published plan ("second tank at the
                              dock"), not a discrepancy — but only if it says so. */}
                          {diveSites.undecidedDives > 0 ? (
                            <span className="font-normal text-muted">
                              {" · "}
                              {t("schedule.moreDivesToConfirm", {
                                count: diveSites.undecidedDives,
                              })}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {/* **What this departure asks of anybody.** The gate was
                          modelled, enforced at booking, and rendered as prose on
                          the trip page — and the list showed none of it, so a
                          diver had to open all fifteen cards to learn which they
                          could book, and shops typed the requirement into the
                          free-text description by hand instead. That copy cannot
                          be translated, and nothing reconciled it with the gate
                          the form actually enforces (issue #695).

                          Same label-then-values shape as the sites line above,
                          because without a lead "Night · Deep" reads as a
                          description of the diving rather than a bar on it. A
                          departure that demands nothing renders nothing: "no
                          card needed" would appear on almost every reef charter
                          in the product, and is the absence of a rule dressed as
                          a rule. */}
                      {requirementMarkers.length > 0 ? (
                        <p className="mt-2 text-sm text-muted">
                          {requirementMarkers.length === 1
                            ? t("schedule.certification")
                            : t("schedule.certifications")}
                          {" · "}
                          {requirementMarkers.join(" · ")}
                        </p>
                      ) : null}
                      {/* The dive plan in words only when the sites line above
                          isn't already carrying it — a card that lists two
                          sites (or "1 more dive to be confirmed") has said how
                          many dives there are, and restating "Two-tank trip"
                          under every card was the same fact chanted down the
                          list (design/principles.md #9). */}
                      {diveSites.sites.length === 0 && !trip.course ? (
                        <p className="mt-2 text-sm text-muted">
                          {trip.plannedDives === 2 ? (
                            <>
                              {t("schedule.twoTank")}
                              {showTwoTankHint ? (
                                // text-muted at text-sm, not the old
                                // text-xs/80 — that measured 3.49:1, under AA.
                                <span className="block">{t("schedule.twoTankHint")}</span>
                              ) : null}
                            </>
                          ) : (
                            t("schedule.diveCount", { count: trip.plannedDives })
                          )}
                        </p>
                      ) : null}
                    </div>
                    {/* The badge is spent on the states that need a decision
                        now — full, or nearly — and routine availability reads
                        as the quiet fact it is (principle 9: counts are facts,
                        not alerts; a pill on every row means nothing on any).
                        The chevron is the row's one at-rest tap cue: without a
                        border, a phone row — where hover doesn't exist — read
                        as a text listing rather than a pressable thing. */}
                    <div className="flex shrink-0 items-center gap-2">
                      {full || lowInventory ? (
                        <Badge tone={full ? "neutral" : "warning"} tabularNums>
                          {capacityText}
                        </Badge>
                      ) : (
                        <p className="text-sm text-muted tabular-nums">{capacityText}</p>
                      )}
                      <DiveDayIcon
                        name="chevron-right"
                        className="size-4 text-muted transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </div>
                </li>
              );
            };
            return listedTrips.flatMap((trip) => {
              const dayIso = toDateInputValue(utcToWallTime(trip.startsAt, tz));
              // The day header is a calendar block — big day numeral, weekday
              // and month as its caps — because the question a diver scans
              // this list with is "which day can I go?", and a numeral you
              // can catch mid-scroll answers it faster than a sentence-case
              // date in small caps. Sticky, so mid-list the reader always
              // knows which day the rows under their thumb belong to.
              const dayParts = formatDayParts(trip.startsAt, locale, shop.timezone);
              const dayRule =
                dayIso === lastDayIso ? null : (
                  <li
                    key={`day-${dayIso}`}
                    role="presentation"
                    aria-hidden="true"
                    className="sticky top-0 z-20 mt-8 flex items-center gap-3 bg-background pt-2 pb-3 first:mt-0"
                  >
                    <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
                      {dayParts.day}
                    </span>
                    <span className="flex flex-col justify-center leading-tight">
                      <span className="text-xs font-bold tracking-[0.18em] uppercase">
                        {dayParts.weekday}
                      </span>
                      <span className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
                        {dayParts.month}
                      </span>
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </li>
                );
              lastDayIso = dayIso;
              return dayRule ? [dayRule, tripCard(trip)] : [tripCard(trip)];
            });
          })()}
        </ul>
      )}
      {/* No pager in the frame either. "Show later departures" is the same
          nested navigation the fixed height caused — a second page loaded
          inside somebody else's site — and the widget already offers the way
          out to the real schedule below (issue #805). */}
      {!isEmbed && (nextCursor || after || explicitMonth) ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {(() => {
            const backStack = decodeCursorStack(back);
            const previous = popCursor(backStack);
            if (!previous) return null;
            const params = new URLSearchParams();
            if (previous.after) params.set("after", previous.after);
            if (previous.stack.length > 0) params.set("back", encodeCursorStack(previous.stack));
            withViewParams(params);
            const query = params.toString();
            return (
              <Link
                href={`${publicSchedulePath(shopSlug)}${query ? `?${query}` : ""}`}
                scroll={false}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("schedule.showEarlier")}
              </Link>
            );
          })()}
          {nextCursor ? (
            <Link
              href={(() => {
                const params = new URLSearchParams();
                params.set("after", nextCursor);
                const nextStack = pushCursor(decodeCursorStack(back), after);
                if (nextStack.length > 0) params.set("back", encodeCursorStack(nextStack));
                withViewParams(params);
                return `${publicSchedulePath(shopSlug)}?${params.toString()}`;
              })()}
              scroll={false}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("schedule.showLater")}
            </Link>
          ) : null}
          {after || explicitMonth ? (
            <Link
              href={(() => {
                // The whole point of this link is "start from the shop's next
                // departure", so it keeps the filters but deliberately drops
                // both the cursor and any month bound.
                const params = new URLSearchParams();
                if (isEmbed) params.set("embed", "1");
                if (hasSpaceFilter) params.set("hasSpace", "1");
                if (tripTypeFilter) params.set("tripType", tripTypeFilter);
                const query = params.toString();
                return `${publicSchedulePath(shopSlug)}${query ? `?${query}` : ""}`;
              })()}
              scroll={false}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("schedule.backToNext")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {/* The embed widget stays compact/booking-focused (docs ADR
          20260726-schedule-embed); this is a full-page-only surface. */}
      {/* Reviews are a full-page, diver-facing signal: the embed stays a
          compact booking widget (docs ADR 20260726-schedule-embed), and staff
          moderate from /shop/[shopSlug]/reviews rather than reading them here.
          The aggregate + published-review queries stream in behind the shell
          and trip list instead of gating them (docs task 119 follow-up:
          streaming the schedule); the section also carries the page's
          structured-data script tag, since its aggregateRating needs the
          same fetch. */}
      {showReviews ? (
        <Suspense fallback={<ScheduleReviewsSkeleton />}>
          <ScheduleReviewsSection
            db={db}
            shop={shop}
            upcoming={upcoming}
            origin={publicAppUrl()}
            locale={locale}
            tz={tz}
            t={t}
          />
        </Suspense>
      ) : null}
      {/* The two Client Components on this page that read copy, under one
          provider — the diver bundle then crosses to the browser once, for the
          namespaces those two need and no more.

          The date request is the answer to the question this page raises and
          could not previously answer: the schedule shows the dates that exist
          and stops, so a diver who wants a two-tank on the Saturday nobody
          scheduled had nowhere to go. It is deliberately *not* the wait list
          above it — that one says "tell me when a seat frees on a departure
          that exists", and this one says "please create a departure". Full page
          only, like every other non-booking surface here: the embed stays a
          compact booking widget (docs ADR 20260726-schedule-embed). */}
      {!isEmbed ? (
        <DiverIntlProvider
          locale={locale}
          timeZone={tz}
          // `course` is where the diver-facing certification-level words live
          // (`DIVER_CERTIFICATION_LEVEL_KEYS`), shared with the public course
          // pages — `DiveDeclarationFields` inside the deal-list form reads them.
          namespaces={["lastMinute", "findMyBooking", "inquiry", "common", "course"]}
        >
          {/* The deal list stands down for a shop that has never had a
              departure. It asks a diver to be told when a boat needs to fill
              seats at a discount, and points them at "that trip's own page" —
              on a shop with no boats it collects addresses it will never mail,
              about trips that do not exist (issue #710). `everHadDeparture`,
              not `hasUpcoming`: see above. */}
          {everHadDeparture ? <LastMinuteListForm shopSlug={shopSlug} /> : null}
          {/* Same gate, same reason: a shop that has never had a departure
              cannot have a real booking to recover (issue #723). */}
          {everHadDeparture ? <FindMyBookingForm shopSlug={shopSlug} /> : null}
          {/* Not gated on `contactEmail`. The request lands in
              `course_inquiries` and staff read it at /shop/<slug>/requests, so
              the shop's email is only needed for the notification — which
              `submitInquiryAction` already skips when there is none. Guarding
              the form on it switched off the one conversion a shop with
              nothing on the books can still make (issue #710). */}
          {/* On the public schedule, the footer four rows below already
              carries the shop's email and phone, so omitting them here prevents
              duplicate contact lines on the same screen (issue #777). */}
          <DateRequestForm
            submitRequest={submitInquiryAction.bind(null, shopSlug, null)}
            askInterest
            sectionId="request-a-date"
            contactEmail={null}
            contactPhone={null}
            collapsible
            copy={dateRequestCopy(t, "dive")}
          />
        </DiverIntlProvider>
      ) : null}
      {/* Human-discovery footer, embed mode only — a single small line, not a
          banner, so the widget stays compact and booking-focused (docs ADR
          20260726-schedule-embed). A relative href resolves against the
          iframe's own document (this page's origin), not the parent page, so
          it reaches the DiveDay homepage regardless of what site framed it. */}
      {isEmbed ? (
        <div className="mt-8 flex flex-col items-center gap-2 border-t border-border pt-6">
          {/* **The way out of the frame.** The widget shows the next few
              departures; everything else is one tap away on a real page, which
              is a better answer than a scrollbar inside somebody else's site.
              `target="_blank"` for the same reason the DiveDay link below has
              it — a schedule opened *inside* a 900px frame is the nested scroll
              this change exists to remove (issue #805). */}
          <Link
            href={publicSchedulePath(shopSlug)}
            target="_blank"
            rel="noopener"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("schedule.embedSeeFullSchedule")}
          </Link>
          {zoneNote ? <p className="text-xs text-muted">{zoneNote}</p> : null}
        </div>
      ) : null}
      {isEmbed ? (
        <p className="mt-4 text-center text-xs text-muted">
          <Link
            href={`/?${new URLSearchParams({
              utm_source: "embed",
              utm_medium: "widget",
              utm_campaign: shopSlug,
            }).toString()}`}
            target="_blank"
            rel="noopener"
            className="hover:underline"
          >
            {t("schedule.poweredByDiveDay")}
          </Link>
        </p>
      ) : null}
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
  upcoming,
  origin,
  locale,
  tz,
  t,
}: {
  db: AppDb;
  shop: NonNullable<Awaited<ReturnType<typeof getShopBySlug>>>;
  upcoming: Awaited<ReturnType<typeof pagedUpcomingTripsWithCounts>>["trips"];
  origin: string | null;
  locale: string;
  tz: string;
  t: DiverTranslator;
}) {
  const [reviewAggregate, reviews] = await Promise.all([
    getShopReviewAggregate(db, shop.id),
    listPublishedShopReviews(db, shop.id),
  ]);
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
      priceCents: trip.priceCents,
      diveSiteName: trip.diveSite?.name ?? null,
      conditionsHold: trip.conditionsHold,
    })),
    origin,
    reviewAggregate,
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
  );
  return (
    <>
      <JsonLd data={structuredData} />
      <ShopReviews
        aggregate={reviewAggregate}
        reviews={reviews}
        shopSlug={shop.slug}
        locale={locale}
        timezone={tz}
        t={t}
      />
    </>
  );
}

/** Shaped like `ShopReviews`'s heading + rating line + review cards (design principle 1). */
function ScheduleReviewsSkeleton() {
  return (
    <section aria-hidden="true" className="mt-10 animate-pulse">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="h-6 w-40 rounded bg-surface-sunken" />
        <div className="h-4 w-28 rounded bg-surface-sunken" />
      </div>
      <div className="mt-1 h-4 w-72 max-w-full rounded bg-surface-sunken" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
        ))}
      </div>
    </section>
  );
}
