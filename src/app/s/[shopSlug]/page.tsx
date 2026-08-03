import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState } from "@/components/EmptyState";
import { JsonLd } from "@/components/JsonLd";
import { type CalendarTrip, ScheduleCalendar } from "@/components/ScheduleCalendar";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { ShopReviews } from "@/components/ShopReviews";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { type AppDb, getDb } from "@/db/client";
import { getShopReviewAggregate, listPublishedShopReviews } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import {
  pagedUpcomingTripsWithCounts,
  upcomingScheduleRange,
  upcomingTripsForCalendar,
} from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import type { DiverTranslator } from "@/i18n/messages";
import { requestTranslator } from "@/i18n/request";
import {
  addMonths,
  buildCalendarWeeks,
  type CalendarDay,
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
import { publicCoursePath, publicSchedulePath, publicTripPath } from "@/lib/public-routes";
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

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
    alternates: { canonical: publicSchedulePath(shop.slug) },
    openGraph: {
      title: `Dive schedule — ${shop.name}`,
      description,
      url: publicSchedulePath(shop.slug),
    },
  };
}

/**
 * The public, canonical, embeddable dive schedule — calendar, trip list,
 * reviews, and the last-minute-deal signup, and the root of a shop's diver
 * namespace. Every visitor sees this exact page, signed in or not: the staff
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

  // The review aggregate and published-review list stream in separately
  // (below, via <ScheduleReviewsSection>) rather than joining this batch —
  // reviews are a slower, independent read the shell and trip list never
  // needed to wait behind (docs task 119 follow-up: streaming the schedule).
  const [range, { trips: upcoming, nextCursor }] = await Promise.all([
    upcomingScheduleRange(db, shop.id, now),
    pagedUpcomingTripsWithCounts(db, shop.id, {
      cursor: after,
      now,
      ...listMonthBounds,
      hasSpace: hasSpaceFilter ? true : undefined,
      tripType: tripTypeFilter,
    }),
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

  // The month grid's own trip lookup (`upcomingTripsForCalendar`) is a
  // second, genuinely sequential query — it can't start until `currentMonth`
  // is known above — so it moves into <ScheduleCalendarSection> below and
  // streams in behind the shell and trip list instead of blocking them.
  // Only the (cheap, synchronous) month boundary math happens here.
  const { monthStart: calendarMonthStart, monthEnd: calendarMonthEnd } =
    listMonthBounds ?? monthBoundsUtc(currentMonth);

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
      {isEmbed ? null : (
        <ShopPageHeader
          eyebrow={t("schedule.eyebrow")}
          title={t("schedule.title")}
          description={t("schedule.diverDescription")}
        />
      )}

      {nextDeparture ? (
        <Link
          href={`${publicTripPath(shopSlug, nextDeparture.id)}${isEmbed ? "?embed=1" : ""}#book`}
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

      {hasUpcoming ? (
        // The month grid's own query is the one genuinely sequential fetch
        // on this page (it depends on `currentMonth`, computed above) — a
        // Suspense boundary lets the trip list below stream in without
        // waiting on it (docs task 119 follow-up: streaming the schedule).
        <Suspense fallback={<ScheduleCalendarSkeleton />}>
          <ScheduleCalendarSection
            db={db}
            shopId={shop.id}
            shopSlug={shopSlug}
            monthStart={calendarMonthStart}
            monthEnd={calendarMonthEnd}
            now={now}
            tz={tz}
            locale={locale}
            t={t}
            label={monthLabel(currentMonth)}
            weeks={buildCalendarWeeks(currentMonth, weekStartsOn(locale))}
            todayIso={todayIso}
            prevMonthKey={prevMonthKey}
            nextMonthKey={nextMonthKey}
            embed={isEmbed}
          />
        </Suspense>
      ) : null}

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
              const tripHref = `${publicTripPath(shopSlug, trip.id)}${isEmbed ? "?embed=1" : ""}`;
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
                    {/* Wide enough for a formatted range, and `whitespace-nowrap`
                        so it never breaks at the ordinary space before AM/PM and
                        strands "PM" on its own line. */}
                    <div className="shrink-0 sm:w-36">
                      <p className="font-medium">
                        {formatShortDate(trip.startsAt, locale, shop.timezone)}
                      </p>
                      <p className="text-sm whitespace-nowrap text-muted">
                        {formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-medium group-hover:text-primary">{trip.title}</h2>
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
                      <Badge
                        tone={full ? "neutral" : lowInventory ? "warning" : "primary"}
                        tabularNums
                      >
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
                href={`${publicSchedulePath(shopSlug)}${query ? `?${query}` : ""}`}
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
                return `${publicSchedulePath(shopSlug)}?${params.toString()}`;
              })()}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("schedule.showLater")}
            </Link>
          ) : null}
          {after ? (
            <Link
              href={`${publicSchedulePath(shopSlug)}${month ? `?month=${month}` : ""}${isEmbed ? `${month ? "&" : "?"}embed=1` : ""}`}
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
      {/* The only Client Component on this page that reads copy, so the
          provider wraps it alone rather than the whole tree — the diver bundle
          then crosses to the browser once, on the one surface that needs it. */}
      {!isEmbed ? (
        <DiverIntlProvider locale={locale} timeZone={tz} namespaces={["lastMinute", "common"]}>
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

/**
 * The month grid's own trip lookup, isolated behind its `<Suspense>` boundary
 * above so a shop with a slow month query never holds up the shell or the
 * trip list rendered ahead of it.
 */
async function ScheduleCalendarSection({
  db,
  shopId,
  shopSlug,
  monthStart,
  monthEnd,
  now,
  tz,
  locale,
  t,
  label,
  weeks,
  todayIso,
  prevMonthKey,
  nextMonthKey,
  embed,
}: {
  db: AppDb;
  shopId: string;
  shopSlug: string;
  monthStart: Date;
  monthEnd: Date;
  now: Date;
  tz: string;
  locale: string;
  t: DiverTranslator;
  label: string;
  weeks: CalendarDay[][];
  todayIso: string;
  prevMonthKey: string | null;
  nextMonthKey: string | null;
  embed: boolean;
}) {
  const monthTrips = await upcomingTripsForCalendar(db, shopId, monthStart, monthEnd, now);
  const tripsByDay = new Map<string, CalendarTrip[]>();
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
  return (
    <ScheduleCalendar
      shopSlug={shopSlug}
      label={label}
      weeks={weeks}
      todayIso={todayIso}
      tripsByDay={tripsByDay}
      locale={locale}
      t={t}
      prevMonthKey={prevMonthKey}
      nextMonthKey={nextMonthKey}
      embed={embed}
    />
  );
}

/** Shaped like `ScheduleCalendar`'s header + 7x5 day grid (design principle 1). */
function ScheduleCalendarSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="mb-8 animate-pulse rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="h-6 w-32 rounded bg-surface-sunken" />
        <div className="flex items-center gap-2">
          <div className="size-11 rounded-lg bg-surface-sunken" />
          <div className="size-11 rounded-lg bg-surface-sunken" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }, (_, i) => i).map((cell) => (
          <div key={cell} className="min-h-16 rounded-lg bg-surface-sunken/60 sm:min-h-24" />
        ))}
      </div>
    </section>
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
          <div key={i} className="h-28 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
    </section>
  );
}
