import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { JsonLd } from "@/components/JsonLd";
import { type CalendarTrip, ScheduleCalendar } from "@/components/ScheduleCalendar";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ShopReviews } from "@/components/ShopReviews";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getShopReviewAggregate, listPublishedShopReviews } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import {
  pagedUpcomingTripsWithCounts,
  upcomingScheduleRange,
  upcomingTripsForCalendar,
} from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestTranslator } from "@/i18n/request";
import {
  addMonths,
  buildCalendarWeeks,
  type MonthRef,
  monthKey,
  monthLabel,
  parseMonthKey,
  weekStartsOn,
} from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { formatMoneyCents, formatShortDate, formatTime, formatTimeRange } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import {
  decodeCursorStack,
  encodeCursorStack,
  popCursor,
  pushCursor,
} from "@/lib/schedule-pagination";
import { scheduleJsonLd } from "@/lib/structured-data";
import { capacityLabel, isFull } from "@/lib/trips";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { LastMinuteListForm } from "./_components/LastMinuteListForm";

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
  const description = t("schedule.diverDescription");
  return {
    title: `Dive schedule — ${shop.name}`,
    description,
    alternates: { canonical: `/shop/${shop.slug}/schedule` },
    openGraph: {
      title: `Dive schedule — ${shop.name}`,
      description,
      url: `/shop/${shop.slug}/schedule`,
    },
  };
}

/**
 * The public, canonical, embeddable dive schedule — calendar, trip list,
 * reviews, and the last-minute-deal signup. Every visitor sees this exact
 * page, signed in or not: the staff operations board (KPI tiles, add/move/
 * copy/remove) lives at `/schedule/board` instead (Lens 17 — this route used
 * to be four products crammed onto one, including a staff branch that could
 * never coexist with the diver-facing content it shared a component tree
 * with; see docs/product/story-backlog.md and the archive it supersedes).
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
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) {
    notFound();
  }

  // The page is served in pieces: the list is one keyset page, the calendar
  // comes from a bounded month query — nothing loads every trip at once, so a
  // shop with hundreds of departures on the books stays quick.
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

  // When the diver has explicitly paged the calendar to a month, bound the
  // trip list below it to that same month so the two surfaces can't disagree
  // — the previous behavior kept the list on "next N trips from now"
  // regardless of which month the calendar had paged to.
  const explicitMonth = parseMonthKey(month);
  const listMonthBounds = explicitMonth ? monthBoundsUtc(explicitMonth) : null;

  const [range, { trips: upcoming, nextCursor }, reviewAggregate, reviews] = await Promise.all([
    upcomingScheduleRange(db, shop.id, now),
    pagedUpcomingTripsWithCounts(db, shop.id, {
      cursor: after,
      now,
      ...listMonthBounds,
      hasSpace: hasSpaceFilter ? true : undefined,
      tripType: tripTypeFilter,
    }),
    getShopReviewAggregate(db, shop.id),
    listPublishedShopReviews(db, shop.id),
  ]);
  const hasUpcoming = range.first !== null;

  // A prominent quick link to the soonest departure with room, so a returning
  // diver who already knows what they want never has to scroll the full list.
  // Only on the default (unbounded) view — once a diver has paged the
  // calendar to a specific month, `upcoming` is bounded to it and its first
  // trip is no longer necessarily the shop's actual next departure.
  const nextDeparture = !explicitMonth ? (upcoming.find((trip) => !isFull(trip)) ?? null) : null;

  // Diver-facing month calendar: place the month's dives on their shop-local
  // day (storage is UTC; the diver thinks in the shop's wall clock), and page
  // through the months that actually have dives on the books.
  const ordinal = (ref: MonthRef) => ref.year * 12 + (ref.month - 1);
  const monthOf = (date: Date): MonthRef => {
    const wall = utcToWallTime(date, tz);
    return { year: wall.year, month: wall.month };
  };
  const todayWall = utcToWallTime(now, tz);
  const todayIso = toDateInputValue(todayWall);
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

  const tripsByDay = new Map<string, CalendarTrip[]>();
  if (hasUpcoming) {
    const { monthStart, monthEnd } = listMonthBounds ?? monthBoundsUtc(currentMonth);
    const monthTrips = await upcomingTripsForCalendar(db, shop.id, monthStart, monthEnd, now);
    for (const trip of monthTrips) {
      const iso = toDateInputValue(utcToWallTime(trip.startsAt, tz));
      const list = tripsByDay.get(iso) ?? [];
      list.push({
        id: trip.id,
        title: trip.title,
        time: formatTime(trip.startsAt, locale, tz),
        full: isFull(trip),
      });
      tripsByDay.set(iso, list);
    }
  }

  // Structured data describes the canonical standalone page only — see
  // generateMetadata above. Reviews only ever come from this page's own
  // top-level call: they're the same rows `<ShopReviews>` renders directly
  // below, never threaded into a per-trip Event's organizer.
  const structuredData = isEmbed
    ? null
    : scheduleJsonLd(
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
        publicAppUrl(),
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
    <main
      className={
        isEmbed
          ? "w-full flex-1 px-3 py-4"
          : "mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
      }
    >
      {structuredData ? <JsonLd data={structuredData} /> : null}
      {isEmbed ? null : (
        <ShopPageHeader
          eyebrow={t("schedule.eyebrow")}
          title={t("schedule.title")}
          description={t("schedule.diverDescription")}
        />
      )}

      {nextDeparture ? (
        <Link
          href={`/shop/${shopSlug}/schedule/${nextDeparture.id}${isEmbed ? "?embed=1" : ""}#book`}
          className="card-scale-hint mb-8 flex items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-sm transition-all duration-200 hover:border-primary/50"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">
              {t("schedule.nextDeparture.eyebrow")}
            </p>
            <p className="mt-1 truncate text-lg font-semibold">
              {t("schedule.nextDeparture.title", {
                when: `${formatShortDate(nextDeparture.startsAt, locale, shop.timezone)} · ${formatTime(nextDeparture.startsAt, locale, shop.timezone)}`,
                trip: nextDeparture.title,
              })}
            </p>
          </div>
          <Badge tone="primary" tabularNums className="shrink-0">
            {(() => {
              const label = capacityLabel(nextDeparture);
              return label.kind === "full"
                ? t("fallback.full")
                : t("fallback.spotsLeft", { count: label.remaining });
            })()}
          </Badge>
        </Link>
      ) : null}

      <ScheduleCalendar
        shopSlug={shopSlug}
        label={monthLabel(currentMonth)}
        weeks={buildCalendarWeeks(currentMonth, weekStartsOn(locale))}
        todayIso={todayIso}
        tripsByDay={tripsByDay}
        locale={locale}
        t={t}
        prevMonthKey={prevMonthKey}
        nextMonthKey={nextMonthKey}
        embed={isEmbed}
      />

      {hasUpcoming ? (
        // Server-fed, same house pattern as the roster search in
        // AddDiverSection.tsx: a GET reload carries the filters and the list
        // below re-renders filtered. No client state, so the list stays
        // pixel-stable for visual regression.
        <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
          {isEmbed ? <input type="hidden" name="embed" value="1" /> : null}
          {month ? <input type="hidden" name="month" value={month} /> : null}
          <FieldGrid columns={1} className="min-w-40">
            <Field label={t("schedule.filters.tripType")}>
              <select name="tripType" defaultValue={tripTypeFilter ?? ""} className={controlClass}>
                <option value="">{t("schedule.filters.allTrips")}</option>
                <option value="fun_dive">{t("schedule.filters.funDive")}</option>
                <option value="course">{t("schedule.filters.course")}</option>
              </select>
            </Field>
          </FieldGrid>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="hasSpace"
              value="1"
              defaultChecked={hasSpaceFilter}
              className="size-4"
            />
            {t("schedule.filters.hasSpace")}
          </label>
          <SubmitButton
            pendingLabel={t("schedule.filters.applying")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("schedule.filters.apply")}
          </SubmitButton>
        </form>
      ) : null}

      {!hasUpcoming ? (
        <EmptyState>
          <h2 className="font-medium">{t("schedule.noTrips")}</h2>
          <p className="mt-1 text-sm text-muted">{t("schedule.noTripsPublic")}</p>
        </EmptyState>
      ) : upcoming.length === 0 ? (
        <EmptyState>
          <p className="text-sm text-muted">
            {hasSpaceFilter || tripTypeFilter
              ? t("schedule.filters.noMatches")
              : t("schedule.noTripsMonth")}
          </p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t("schedule.tripListLabel")}>
          {(() => {
            // "Two-tank trip" (task 6) gets its plain-language explanation
            // once, on the first card that says it — every later trip
            // sharing that shape stays as it was, so a long list doesn't
            // repeat the same aside a dozen times.
            let twoTankHintShown = false;
            return upcoming.map((trip) => {
              const full = isFull(trip);
              const capacityLabelValue = capacityLabel(trip);
              const capacityText =
                capacityLabelValue.kind === "full"
                  ? t("fallback.full")
                  : t("fallback.spotsLeft", { count: capacityLabelValue.remaining });
              const showTwoTankHint = trip.plannedDives === 2 && !twoTankHintShown;
              if (showTwoTankHint) twoTankHintShown = true;
              const tripHref = `/shop/${shopSlug}/schedule/${trip.id}${isEmbed ? "?embed=1" : ""}`;
              return (
                <li key={trip.id}>
                  {/* A "stretched link" card: the whole row navigates to the
                    trip via an invisible overlay anchor, while the course
                    title keeps its own real link into the course page
                    (task 1) — two <a> tags can never nest, so the overlay
                    sits behind everything and the course link opts back
                    onto z-10 to stay reachable by mouse and keyboard alike. */}
                  <div className="group card-scale-hint relative flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:border-primary/40 sm:flex-row sm:items-center">
                    <Link
                      href={tripHref}
                      className="absolute inset-0 z-0 rounded-2xl"
                      aria-label={t("schedule.tripCardLabel", {
                        when: `${formatShortDate(trip.startsAt, locale, shop.timezone)} · ${formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}`,
                        trip: trip.title,
                        capacity: capacityText,
                      })}
                    />
                    <div className="shrink-0 sm:w-32">
                      <p className="font-medium">
                        {formatShortDate(trip.startsAt, locale, shop.timezone)}
                      </p>
                      <p className="text-sm text-muted">
                        {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-medium group-hover:text-primary">{trip.title}</h2>
                      {trip.course ? (
                        <p className="mt-0.5 text-sm font-medium text-primary">
                          {t("schedule.courseSession")} ·{" "}
                          <Link
                            href={`/shop/${shopSlug}/courses/${trip.course.slug}`}
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
                          {formatMoneyCents(trip.priceCents, currency, locale)}{" "}
                          <span className="font-normal text-muted">{t("common.perDiver")}</span>
                        </p>
                      ) : null}
                      {trip.diveSite ? (
                        <p className="mt-2 text-sm font-medium text-primary">
                          {t("schedule.diveSite")} · {trip.diveSite.name}
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm text-muted">
                        {trip.plannedDives === 2 ? (
                          <>
                            {t("schedule.twoTank")}
                            {showTwoTankHint ? (
                              <span className="block text-xs text-muted/80">
                                {t("schedule.twoTankHint")}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          t("schedule.diveCount", { count: trip.plannedDives })
                        )}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <Badge tone={full ? "neutral" : "primary"} tabularNums>
                        {capacityText}
                      </Badge>
                    </div>
                  </div>
                </li>
              );
            });
          })()}
        </ul>
      )}
      {nextCursor || after ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {(() => {
            const backStack = decodeCursorStack(back);
            const previous = popCursor(backStack);
            if (!previous) return null;
            const params = new URLSearchParams();
            if (previous.after) params.set("after", previous.after);
            if (previous.stack.length > 0) params.set("back", encodeCursorStack(previous.stack));
            if (month) params.set("month", month);
            if (isEmbed) params.set("embed", "1");
            const query = params.toString();
            return (
              <Link
                href={`/shop/${shopSlug}/schedule${query ? `?${query}` : ""}`}
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
                if (month) params.set("month", month);
                if (isEmbed) params.set("embed", "1");
                return `/shop/${shopSlug}/schedule?${params.toString()}`;
              })()}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("schedule.showLater")}
            </Link>
          ) : null}
          {after ? (
            <Link
              href={`/shop/${shopSlug}/schedule${month ? `?month=${month}` : ""}${isEmbed ? `${month ? "&" : "?"}embed=1` : ""}`}
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
          moderate from /shop/[shopSlug]/reviews rather than reading them here. */}
      {!isEmbed ? (
        <ShopReviews
          aggregate={reviewAggregate}
          reviews={reviews}
          locale={locale}
          timezone={tz}
          t={t}
        />
      ) : null}
      {/* The only Client Component on this page that reads copy, so the
          provider wraps it alone rather than the whole tree — the diver bundle
          then crosses to the browser once, on the one surface that needs it. */}
      {!isEmbed ? (
        <DiverIntlProvider locale={locale} timeZone={tz}>
          <LastMinuteListForm shopSlug={shopSlug} />
        </DiverIntlProvider>
      ) : null}
      {/* Human-discovery footer, embed mode only — a single small line, not a
          banner, so the widget stays compact and booking-focused (docs ADR
          20260726-schedule-embed). A relative href resolves against the
          iframe's own document (this page's origin), not the parent page, so
          it reaches the DiveDay homepage regardless of what site framed it. */}
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
