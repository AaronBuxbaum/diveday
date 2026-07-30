import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { JsonLd } from "@/components/JsonLd";
import { type CalendarTrip, ScheduleCalendar } from "@/components/ScheduleCalendar";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { ShopReviews } from "@/components/ShopReviews";
import { StaffScheduleBoard } from "@/components/StaffScheduleBoard";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopReviewAggregate, listPublishedShopReviews } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import {
  pagedUpcomingTripsWithCounts,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingStaffSchedule,
  upcomingTripsForCalendar,
} from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import {
  addMonths,
  buildCalendarWeeks,
  type MonthRef,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTime, formatTimeRange } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
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
  const t = diverTranslator(shop.defaultLocale);
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

export default async function TripsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string; after?: string; embed?: string }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { month, after, embed } = await searchParams;
  // Embed mode is the compact, chrome-light surface a shop pastes into its own
  // website (docs ADR 20260726-schedule-embed) — never for staff, who always
  // arrive signed in and never via a third-party iframe.
  const isEmbed = embed === "1";
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) {
    notFound();
  }
  const session = await auth();
  // Embed mode always renders the diver-facing surface, even for a signed-in
  // staff member previewing the page — an iframe on the shop's own website
  // must never expose the staff board.
  const staffView = !isEmbed && session?.user?.shopId === shop.id && isStaff(session.user.roles);

  // The board is served in pages: the list is one keyset page, the stat tiles
  // and calendar come from bounded queries — nothing loads every trip at once,
  // so a shop with hundreds of departures on the books stays quick.
  const tz = shop.timezone;
  const locale = shop.defaultLocale;
  const t = diverTranslator(locale);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  const now = nowDate();
  const [range, stats, { trips: upcoming, nextCursor }, reviewAggregate, reviews] =
    await Promise.all([
      upcomingScheduleRange(db, shop.id, now),
      staffView ? upcomingScheduleStats(db, shop.id, now) : null,
      pagedUpcomingTripsWithCounts(db, shop.id, { cursor: after, now }),
      getShopReviewAggregate(db, shop.id),
      listPublishedShopReviews(db, shop.id),
    ]);
  const hasUpcoming = range.first !== null;

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
  const currentMonth: MonthRef = parseMonthKey(month) ??
    firstTripMonth ?? { year: todayWall.year, month: todayWall.month };
  const prev = addMonths(currentMonth, -1);
  const next = addMonths(currentMonth, 1);
  const prevMonthKey =
    firstTripMonth && ordinal(prev) >= ordinal(firstTripMonth) ? monthKey(prev) : null;
  const nextMonthKey =
    lastTripMonth && ordinal(next) <= ordinal(lastTripMonth) ? monthKey(next) : null;

  const staffSchedule = staffView
    ? await upcomingStaffSchedule(
        db,
        shop.id,
        wallTimeToUtc(
          { year: currentMonth.year, month: currentMonth.month, day: 1, hour: 0, minute: 0 },
          tz,
        ),
        wallTimeToUtc({ year: next.year, month: next.month, day: 1, hour: 0, minute: 0 }, tz),
        now,
      )
    : [];

  const tripsByDay = new Map<string, CalendarTrip[]>();
  if (!staffView && hasUpcoming) {
    const monthStart = wallTimeToUtc(
      { year: currentMonth.year, month: currentMonth.month, day: 1, hour: 0, minute: 0 },
      tz,
    );
    const nextRef = addMonths(currentMonth, 1);
    const monthEnd = wallTimeToUtc(
      { year: nextRef.year, month: nextRef.month, day: 1, hour: 0, minute: 0 },
      tz,
    );
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
  // generateMetadata above. Staff see their own board, which is not a public
  // document and has no business carrying an Event graph.
  const structuredData =
    isEmbed || staffView
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
          description={staffView ? t("schedule.staffDescription") : t("schedule.diverDescription")}
          actions={
            staffView ? (
              <Link
                href={`/shop/${shopSlug}/trips/new`}
                className={buttonClass({ className: "rounded-xl" })}
              >
                <span aria-hidden="true">+</span> Schedule a trip
              </Link>
            ) : undefined
          }
        />
      )}
      {staffView && stats ? (
        <section
          aria-label="Schedule overview"
          className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <ShopStat
            label="Departures"
            value={stats.departures}
            detail="Upcoming trips and sessions"
            tone="primary"
          />
          <ShopStat label="Booked" value={stats.booked} detail="Divers across all departures" />
          <ShopStat
            label="Open seats"
            value={stats.openSeats}
            detail="Available across the board"
            tone="success"
          />
          <ShopStat
            label="At capacity"
            value={stats.atCapacity}
            detail="Trips with no open seats"
          />
        </section>
      ) : null}

      {staffView && staffSchedule.length > 0 ? (
        <StaffScheduleBoard shopSlug={shopSlug} trips={staffSchedule} timezone={tz} />
      ) : null}

      {!staffView && hasUpcoming ? (
        <ScheduleCalendar
          shopSlug={shopSlug}
          label={monthLabel(currentMonth)}
          weeks={buildCalendarWeeks(currentMonth)}
          todayIso={todayIso}
          tripsByDay={tripsByDay}
          prevMonthKey={prevMonthKey}
          nextMonthKey={nextMonthKey}
          embed={isEmbed}
        />
      ) : null}

      {!hasUpcoming ? (
        <EmptyState>
          <h2 className="font-medium">{t("schedule.noTrips")}</h2>
          {staffView ? (
            <>
              <p className="mt-1 text-sm text-muted">{t("schedule.noTripsStaff")}</p>
              <Link
                href={`/shop/${shopSlug}/trips/new`}
                className={buttonClass({ className: "mt-4 rounded-xl" })}
              >
                Schedule a trip
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{t("schedule.noTripsPublic")}</p>
          )}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {upcoming.map((trip) => {
            const full = isFull(trip);
            return (
              <li key={trip.id}>
                <Link
                  // Staff manage a trip on /trips/[id]; anonymous and diver
                  // visitors book on /schedule/[id]. Linking staff straight to
                  // the management view removes the /schedule/[id] redirect hop.
                  href={
                    staffView
                      ? `/shop/${shopSlug}/trips/${trip.id}`
                      : `/shop/${shopSlug}/schedule/${trip.id}${isEmbed ? "?embed=1" : ""}`
                  }
                  className="group card-scale-hint flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:border-primary/40 sm:flex-row sm:items-center"
                >
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
                        {t("schedule.courseSession")} · {trip.course.title}
                      </p>
                    ) : null}
                    {trip.description ? (
                      <p className="mt-0.5 text-sm text-muted">{trip.description}</p>
                    ) : null}
                    {trip.priceCents !== null ? (
                      <p className="mt-2 text-sm font-semibold tabular-nums">
                        {money.format(trip.priceCents / 100)}{" "}
                        <span className="font-normal text-muted">{t("common.perDiver")}</span>
                      </p>
                    ) : null}
                    {trip.diveSite ? (
                      <p className="mt-2 text-sm font-medium text-primary">
                        {t("schedule.diveSite")} · {trip.diveSite.name}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm text-muted">
                      {trip.plannedDives === 2
                        ? t("schedule.twoTank")
                        : t("schedule.diveCount", { count: trip.plannedDives })}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Badge tone={full ? "neutral" : "primary"} tabularNums>
                      {capacityLabel(trip)}
                    </Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor || after ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {nextCursor ? (
            <Link
              href={`/shop/${shopSlug}/schedule?after=${encodeURIComponent(nextCursor)}${month ? `&month=${month}` : ""}${isEmbed ? "&embed=1" : ""}`}
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
      {!isEmbed && !staffView ? (
        <ShopReviews
          aggregate={reviewAggregate}
          reviews={reviews}
          locale={locale}
          timezone={tz}
          t={t}
        />
      ) : null}
      {!isEmbed && !staffView ? <LastMinuteListForm shopSlug={shopSlug} /> : null}
    </main>
  );
}
