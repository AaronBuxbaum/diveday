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
import { buttonClass } from "@/components/ui/button";
import { DisclosureRowList } from "@/components/ui/disclosure";
import { type AppDb, getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
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
import { DIVER_CERTIFICATION_LEVEL_KEYS, tripRequirementMarkers } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import { courseDepthFormat } from "@/i18n/unit-labels";
import { addMonths, type MonthRef, monthKey, monthLabel, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { parseConservationCommitments } from "@/lib/conservation-commitments";
import { courseTotalCents, resolveCourseContentDepths, resolveImageAlt } from "@/lib/courses";
import { DECLARABLE_CERTIFICATION_LEVELS } from "@/lib/dive-declaration";
import {
  formatDayParts,
  formatMoneyScanned,
  formatRelativeDay,
  formatShortDate,
  formatTime,
  formatTimeRange,
} from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import {
  publicCoursePath,
  publicCoursesPath,
  publicSchedulePath,
  publicTripPath,
} from "@/lib/public-routes";
import { certificationRank } from "@/lib/readiness";
import { EMPTY_REVIEW_AGGREGATE, type ReviewAggregate } from "@/lib/reviews";
import {
  decodeCursorStack,
  encodeCursorStack,
  popCursor,
  pushCursor,
} from "@/lib/schedule-pagination";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { scheduleJsonLd } from "@/lib/structured-data";
import { capacityLabel, nextBookableDeparture } from "@/lib/trips";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { CoursesShelf } from "./_components/CoursesShelf";
import { FindMyBookingForm } from "./_components/FindMyBookingForm";
import { LastMinuteListForm } from "./_components/LastMinuteListForm";
import { NextBoatCard } from "./_components/NextBoatCard";
import { ScheduleFilters } from "./_components/ScheduleFilters";
import { ShopfrontHero } from "./_components/ShopfrontHero";
import { WeekLedger, type WeekLedgerRow } from "./_components/WeekLedger";

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
    canDive?: string;
    hideAbove?: string;
  }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { month, after, back, embed, hasSpace, tripType, canDive, hideAbove } = await searchParams;
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
    if (canDiveFilter) params.set("canDive", canDiveFilter);
    if (hideAboveFilter) params.set("hideAbove", "1");
    return params;
  };
  /** The same filters as `withViewParams`, for links that already carry their own `?month=`. */
  const filterSuffix = `${hasSpaceFilter ? "&hasSpace=1" : ""}${
    tripTypeFilter ? `&tripType=${tripTypeFilter}` : ""
  }${canDiveFilter ? `&canDive=${canDiveFilter}` : ""}${hideAboveFilter ? "&hideAbove=1" : ""}`;
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

  // The published-review *list* still streams in separately (below, via
  // <ScheduleReviewsSection>) — it is the slower, independent read the shell
  // and trip list never needed to wait behind (docs task 119 follow-up:
  // streaming the schedule).
  //
  // The **aggregate** joined this batch when the shopfront landed: it is one
  // row, and it is now part of the identity band at the very top of the page
  // (ADR 20260827-clearwater-surface-language, decision 8), where streaming it
  // separately would either pop a rating line in under the shop's name or cost
  // a reserved gap on every shop that has no reviews at all. It is handed down
  // to the reviews section rather than read twice.
  //
  // Both, and the courses shelf, stand down inside the frame: `?embed=1`
  // renders neither the hero nor the shelves.
  const [range, { trips: upcoming, nextCursor }, reviewAggregate, activeCourses] =
    await Promise.all([
      upcomingScheduleRange(db, shop.id, now, { publicOnly: true }),
      pagedUpcomingTripsWithCounts(db, shop.id, {
        cursor: after,
        now,
        ...listMonthBounds,
        hasSpace: hasSpaceFilter ? true : undefined,
        tripType: tripTypeFilter,
        publicOnly: true,
      }),
      isEmbed ? EMPTY_REVIEW_AGGREGATE : getShopReviewAggregate(db, shop.id),
      isEmbed ? [] : listActiveCourses(db, shop.id),
    ]);
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

  // Which departures ask for more than the reader said they hold.
  //
  // The **ladder only**: `minimumCertificationLevel`, compared with
  // `certificationRank`. Specialties and nitrox are deliberately outside it —
  // asking in a filter row whether someone holds a Deep card is a form, not a
  // filter, and the level is the question a diver answers without thinking.
  // A course session is outside it too, for the same reason its requirement is
  // not rendered on the card: a course exists to create the certification, so
  // barring its own students from it reads as nonsense.
  const aboveStatedLevel = new Set(
    canDiveFilter
      ? upcoming
          .filter((trip) => {
            if (trip.course) return false;
            const required = requirementsByTrip.get(trip.id)?.minimumCertificationLevel;
            return Boolean(
              required && certificationRank(required) > certificationRank(canDiveFilter),
            );
          })
          .map((trip) => trip.id)
      : [],
  );
  const visibleUpcoming = hideAboveFilter
    ? upcoming.filter((trip) => !aboveStatedLevel.has(trip.id))
    : upcoming;
  const listedTrips = isEmbed ? visibleUpcoming.slice(0, EMBED_TRIP_LIMIT) : visibleUpcoming;

  // **The next boat out** — the storefront's one card and one primary (ADR
  // 20260827-clearwater-surface-language, decision 8). The soonest departure
  // with room, and it keeps its own row in the week below: the card is a pin,
  // not a removal.
  //
  // Only on the default view, and only outside the frame. Once a diver has
  // paged the calendar to a month or stepped the cursor, `upcoming` is bounded
  // and its first bookable trip is no longer the shop's actual next departure —
  // a card claiming otherwise would be confidently wrong. The embed is a
  // *window* onto the schedule (issue #805): a card there would eat a third of
  // a 900px frame to restate the row directly beneath it.
  const nextBoat =
    isEmbed || explicitMonth || after ? null : nextBookableDeparture(visibleUpcoming);

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

  // "Tomorrow · 7:00 AM" beats "Aug 28 · 7:00 AM" for the two days a diver is
  // most likely to be booking, and nothing else does: `Intl.RelativeTimeFormat`
  // renders anything further out as "in 5 days", which is worse than the date
  // it replaced. So the relative word covers today and tomorrow and the short
  // date covers the rest. Compared on the *shop-local calendar day*, never on a
  // millisecond difference — a 6 AM departure tomorrow is not "today" because
  // it is 14 hours away.
  const dayKeyOf = (date: Date) => toDateInputValue(utcToWallTime(date, tz));
  const nowDayKey = dayKeyOf(now);
  const tomorrowDayKey = dayKeyOf(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const whenWord = (date: Date) =>
    dayKeyOf(date) === nowDayKey || dayKeyOf(date) === tomorrowDayKey
      ? formatRelativeDay(date, now, locale, tz)
      : formatShortDate(date, locale, tz);

  // Seat state as a word plus the tone that decides whether it earns a badge.
  // Low inventory keeps the urgent wording the booking form itself switches to
  // ("Book the last spot") — never colour alone (WCAG 1.4.1).
  const seatState = (trip: { capacity: number; booked: number }) => {
    const label = capacityLabel(trip);
    if (label.kind === "full") return { text: t("fallback.full"), tone: "full" as const };
    if (label.remaining <= 2) {
      return {
        text: t("schedule.spotsLeftUrgent", { count: label.remaining }),
        tone: "low" as const,
      };
    }
    return { text: t("fallback.spotsLeft", { count: label.remaining }), tone: "quiet" as const };
  };

  // **One meta line per row.** Where it goes, what it asks of you, and — for a
  // course session — which course it belongs to. Everything the row used to
  // stack beneath its title (the shop's description, the dive-plan words and
  // their two-sentence aside) is on the trip page one tap below.
  const weekRows: WeekLedgerRow[] = listedTrips.map((trip) => {
    const diveSites = diveSitesByTrip.get(trip.id) ?? { sites: [], undecidedDives: 0 };
    // The title already naming every site with nothing left to confirm is the
    // title restated, and stays off the row (principle 9).
    const siteLineEarnsItsPlace =
      diveSites.sites.length > 0 &&
      !(
        diveSites.undecidedDives === 0 &&
        diveSites.sites.every((site) => trip.title.toLowerCase().includes(site.name.toLowerCase()))
      );
    // Course sessions are left out for the same reason the trip page leaves
    // them out: a course exists to create the certification, so repeating the
    // site's demand here would read as a bar on the very students it is for.
    const requirement = trip.course ? null : (requirementsByTrip.get(trip.id) ?? null);
    const seats = seatState(trip);
    return {
      id: trip.id,
      dayKey: dayKeyOf(trip.startsAt),
      dayParts: formatDayParts(trip.startsAt, locale, shop.timezone),
      href: `${publicTripPath(shopSlug, trip.id)}${isEmbed ? "?embed=1" : ""}`,
      linkLabel: t("schedule.tripCardLabel", {
        when: `${formatShortDate(trip.startsAt, locale, shop.timezone)} · ${formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}`,
        trip: trip.title,
        capacity: seats.text,
      }),
      timeRange: formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone),
      title: trip.title,
      course: trip.course
        ? {
            label: t("schedule.courseSession"),
            title: trip.course.title,
            href: publicCoursePath(shopSlug, trip.course.slug),
          }
        : null,
      site: siteLineEarnsItsPlace ? (
        <>
          {cachedListFormat(locale, { type: "conjunction" }).format(
            diveSites.sites.map((site) => site.name),
          )}
          {/* The other half of the count: a two-tank day with one site is a
              published plan ("second tank at the dock"), not a discrepancy —
              but only if it says so. */}
          {diveSites.undecidedDives > 0
            ? ` · ${t("schedule.moreDivesToConfirm", { count: diveSites.undecidedDives })}`
            : null}
        </>
      ) : null,
      requirements: requirement ? tripRequirementMarkers(t, requirement) : [],
      // Marked, never removed, unless the reader asked for the shorter list
      // (issue #696) — and the word is what gives the dimming a name.
      aboveLevel: aboveStatedLevel.has(trip.id) ? t("schedule.filters.aboveLevelChip") : null,
      capacityText: seats.text,
      capacityTone: seats.tone,
      price:
        trip.priceCents !== null ? formatMoneyScanned(trip.priceCents, currency, locale) : null,
    };
  });

  // The shelf takes the first three rungs in progression order; "All courses"
  // is the rest. `{depth18}` markers resolve into the shop's own unit before
  // anything reads a field, the same one-shot pass the catalog makes.
  const depthFormat = courseDepthFormat(t, shop.depthUnit);
  const shelfCourses = activeCourses.slice(0, 3).map((stored) => {
    const course = resolveCourseContentDepths(stored, depthFormat);
    const total = courseTotalCents(course);
    return {
      id: course.id,
      title: course.title,
      summary: course.summary,
      heroImageUrl: course.heroImageUrl,
      heroImageAlt: resolveImageAlt(
        course.heroImageAlt,
        t("course.photoAltFallback", { course: course.title, n: 1 }),
      ),
      href: publicCoursePath(shopSlug, course.slug),
      price: total !== null ? formatMoneyScanned(total, currency, locale) : null,
    };
  });

  return (
    <main
      className={
        isEmbed
          ? "w-full flex-1 px-3 py-4"
          : "mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
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
        <div className="flex min-w-0 items-start gap-4">
          {shop.logoUrl ? (
            // biome-ignore lint/performance/noImgElement: dynamic user-uploaded logo
            <img
              src={shop.logoUrl}
              alt=""
              className="size-16 shrink-0 rounded-xl border border-border bg-surface object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <ShopfrontHero
              name={shop.name}
              tagline={shop.tagline}
              aggregate={reviewAggregate}
              commitments={parseConservationCommitments(shop.conservationCommitments)}
              locale={locale}
              t={t}
            />
            {nextBoat ? (
              <div className="mt-6 max-w-md">
                <NextBoatCard
                  href={`${publicTripPath(shopSlug, nextBoat.id)}#book`}
                  when={whenWord(nextBoat.startsAt)}
                  time={formatTime(nextBoat.startsAt, locale, shop.timezone)}
                  title={nextBoat.title}
                  description={nextBoat.description}
                  spots={seatState(nextBoat).text}
                  price={
                    nextBoat.priceCents !== null
                      ? formatMoneyScanned(nextBoat.priceCents, currency, locale)
                      : null
                  }
                  t={t}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className={isEmbed ? undefined : "mt-10"}>
        {isEmbed ? null : (
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight">{t("schedule.title")}</h2>
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
            canDiveFilter={canDiveFilter ?? null}
            hideAboveFilter={hideAboveFilter}
            aboveLevelNotice={
              canDiveFilter && !hideAboveFilter && aboveStatedLevel.size > 0
                ? // It says the trips are still bookable, because they are: this
                  // is a stated preference, and a shop will take an Open Water
                  // diver on an Advanced charter as a guided dive or sell them the
                  // specialty.
                  t("schedule.filters.aboveLevelCount", {
                    count: aboveStatedLevel.size,
                    level: t(DIVER_CERTIFICATION_LEVEL_KEYS[canDiveFilter]),
                  })
                : null
            }
            copy={{
              tripType: t("schedule.filters.tripType"),
              allTrips: t("schedule.filters.allTrips"),
              funDive: t("schedule.filters.funDive"),
              course: t("schedule.filters.course"),
              hasSpace: t("schedule.filters.hasSpace"),
              canDive: t("schedule.filters.canDive"),
              canDiveUnsaid: t("schedule.filters.canDiveUnsaid"),
              // Ladder order, and the same words the public booking form's own
              // certification select uses — the vocabulary a diver has already
              // been asked in is the one to ask them in again.
              canDiveLevels: DECLARABLE_CERTIFICATION_LEVELS.map((level) => ({
                value: level,
                label: t(DIVER_CERTIFICATION_LEVEL_KEYS[level]),
              })),
              hideAboveLevel: t("schedule.filters.hideAboveLevel"),
            }}
          />
        ) : null}

        {/* **The shipped terminal state, unchanged.** A shop with nothing on the
            books says so and points at the composer below; the page's one
            primary becomes that composer's own submit. */}
        {!hasUpcoming ? (
          <EmptyState
            title={t("schedule.noTrips")}
            body={t(
              shop.contactPhone || shop.contactEmail
                ? "schedule.noTripsPublic"
                : "schedule.noTripsPublicNoPhone",
            )}
          />
        ) : visibleUpcoming.length === 0 ? (
          <EmptyState
            title={
              hasSpaceFilter || tripTypeFilter || hideAboveFilter
                ? t("schedule.filters.noMatches")
                : t("schedule.noTripsMonth")
            }
          />
        ) : (
          <WeekLedger
            rows={weekRows}
            listLabel={t("schedule.tripListLabel")}
            stickyTop={isEmbed ? "top-0" : "top-(--chrome-h)"}
          />
        )}
      </div>
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
                if (canDiveFilter) params.set("canDive", canDiveFilter);
                if (hideAboveFilter) params.set("hideAbove", "1");
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
          className="mt-12"
          t={t}
        />
      )}
      {/* Reviews are a full-page, diver-facing signal: the embed stays a
          compact booking widget (docs ADR 20260726-schedule-embed), and staff
          moderate from /shop/[shopSlug]/reviews rather than reading them here.
          The published-review list streams in behind the shell and trip list
          instead of gating them (docs task 119 follow-up: streaming the
          schedule); the section also carries the page's structured-data script
          tag, since its `review` items come from the same fetch. The aggregate
          is already in hand — it belongs to the hero now, and is handed down
          here rather than read a second time. */}
      {showReviews ? (
        <Suspense fallback={<ScheduleReviewsSkeleton />}>
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
      {!isEmbed ? (
        <section aria-labelledby="more-ways-heading" className="mt-12">
          <h2 id="more-ways-heading" className="text-lg font-semibold tracking-tight">
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
            <DisclosureRowList className="mt-4">
              {/* The date request is the answer to the question this page
                  raises and could not previously answer: the schedule shows the
                  dates that exist and stops, so a diver who wants a two-tank on
                  the Saturday nobody scheduled had nowhere to go. It is
                  deliberately *not* the deal list below it — that one says "tell
                  me when a seat frees on a departure that exists", and this one
                  says "please create a departure".

                  Not gated on `contactEmail`. The request lands in
                  `course_inquiries` and staff read it at /shop/<slug>/requests,
                  so the shop's email is only needed for the notification — which
                  `submitInquiryAction` already skips when there is none.
                  Guarding the form on it switched off the one conversion a shop
                  with nothing on the books can still make (issue #710).

                  The footer four rows below already carries the shop's email and
                  phone, so omitting them here prevents duplicate contact lines
                  on the same screen (issue #777). */}
              <DateRequestForm
                submitRequest={submitInquiryAction.bind(null, shopSlug, null)}
                askInterest
                sectionId="request-a-date"
                contactEmail={null}
                contactPhone={null}
                collapsible
                copy={dateRequestCopy(t, "dive")}
              />
              {/* The deal list stands down for a shop that has never had a
                  departure. It asks a diver to be told when a boat needs to fill
                  seats at a discount, and points them at "that trip's own page"
                  — on a shop with no boats it collects addresses it will never
                  mail, about trips that do not exist (issue #710).
                  `everHadDeparture`, not `hasUpcoming`: see above. */}
              {everHadDeparture ? <LastMinuteListForm shopSlug={shopSlug} /> : null}
              {/* Same gate, same reason: a shop that has never had a departure
                  cannot have a real booking to recover (issue #723). */}
              {everHadDeparture ? <FindMyBookingForm shopSlug={shopSlug} /> : null}
            </DisclosureRowList>
          </DiverIntlProvider>
        </section>
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
  aggregate,
  upcoming,
  origin,
  locale,
  tz,
  t,
}: {
  db: AppDb;
  shop: NonNullable<Awaited<ReturnType<typeof getShopBySlug>>>;
  /** Read once, at the top of the page, for the hero's rating line. */
  aggregate: ReviewAggregate;
  upcoming: Awaited<ReturnType<typeof pagedUpcomingTripsWithCounts>>["trips"];
  origin: string | null;
  locale: string;
  tz: string;
  t: DiverTranslator;
}) {
  const reviews = await listPublishedShopReviews(db, shop.id);
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
  );
  return (
    <>
      <JsonLd data={structuredData} />
      <ShopReviews
        className="mt-12"
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

/** Shaped like `ShopReviews` — heading, the all-reviews door, two ledger rows (design principle 1). */
function ScheduleReviewsSkeleton() {
  return (
    <section aria-hidden="true" className="mt-12 animate-pulse">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="h-6 w-40 rounded bg-surface-sunken" />
        <div className="h-4 w-24 rounded bg-surface-sunken" />
      </div>
      <div className="mt-4 flex flex-col">
        {[0, 1].map((row) => (
          <div key={row} className="border-t border-border py-4 last:border-b">
            <div className="h-4 w-24 rounded bg-surface-sunken" />
            <div className="mt-1.5 h-5 w-80 max-w-full rounded bg-surface-sunken" />
            <div className="mt-1.5 h-4 w-56 max-w-full rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
    </section>
  );
}
