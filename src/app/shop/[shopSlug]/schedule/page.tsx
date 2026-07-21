import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { type CalendarTrip, ScheduleCalendar } from "@/components/ScheduleCalendar";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import {
  pagedUpcomingTripsWithCounts,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingTripsForCalendar,
} from "@/db/trips";
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
import { capacityLabel, isFull } from "@/lib/trips";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

export const metadata: Metadata = {
  title: "Schedule — DiveDay",
};

export default async function TripsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ month?: string; after?: string }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { month, after } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) {
    notFound();
  }
  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);

  // The board is served in pages: the list is one keyset page, the stat tiles
  // and calendar come from bounded queries — nothing loads every trip at once,
  // so a shop with hundreds of departures on the books stays quick.
  const tz = shop.timezone;
  const now = nowDate();
  const [range, stats, { trips: upcoming, nextCursor }] = await Promise.all([
    upcomingScheduleRange(db, shop.id, now),
    staffView ? upcomingScheduleStats(db, shop.id, now) : null,
    pagedUpcomingTripsWithCounts(db, shop.id, { cursor: after, now }),
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
        time: formatTime(trip.startsAt, "en-US", tz),
        full: isFull(trip),
      });
      tripsByDay.set(iso, list);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={shop.name}
        title="Schedule"
        description={
          staffView
            ? "Upcoming trips and charters. Open a departure to work through its roster, readiness, prep list, and manifest."
            : "Find your next day on the water, see what to expect, and reserve your spot."
        }
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

      {!staffView && hasUpcoming ? (
        <ScheduleCalendar
          shopSlug={shopSlug}
          label={monthLabel(currentMonth)}
          weeks={buildCalendarWeeks(currentMonth)}
          todayIso={todayIso}
          tripsByDay={tripsByDay}
          prevMonthKey={prevMonthKey}
          nextMonthKey={nextMonthKey}
        />
      ) : null}

      {!hasUpcoming ? (
        <EmptyState>
          <h2 className="font-medium">No trips on the books yet</h2>
          {staffView ? (
            <>
              <p className="mt-1 text-sm text-muted">
                The board is clear. Schedule your first departure and divers can start booking.
              </p>
              <Link
                href={`/shop/${shopSlug}/trips/new`}
                className={buttonClass({ className: "mt-4 rounded-xl" })}
              >
                Schedule a trip
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Check back soon — or call the shop and we&apos;ll find you a boat.
            </p>
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
                      : `/shop/${shopSlug}/schedule/${trip.id}`
                  }
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 sm:flex-row sm:items-center"
                >
                  <div className="shrink-0 sm:w-32">
                    <p className="font-medium">
                      {formatShortDate(trip.startsAt, "en-US", shop.timezone)}
                    </p>
                    <p className="text-sm text-muted">
                      {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-medium group-hover:text-primary">{trip.title}</h2>
                    {trip.course ? (
                      <p className="mt-0.5 text-sm font-medium text-primary">
                        Course session · {trip.course.title}
                      </p>
                    ) : null}
                    {trip.description ? (
                      <p className="mt-0.5 text-sm text-muted">{trip.description}</p>
                    ) : null}
                    {trip.priceCents !== null ? (
                      <p className="mt-2 text-sm font-semibold tabular-nums">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                        }).format(trip.priceCents / 100)}{" "}
                        <span className="font-normal text-muted">per diver</span>
                      </p>
                    ) : null}
                    {trip.diveSite ? (
                      <p className="mt-2 text-sm font-medium text-primary">
                        Dive site · {trip.diveSite.name}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm text-muted">
                      {trip.plannedDives === 2 ? "Two-tank trip" : `${trip.plannedDives} dives`}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <span
                      className={
                        full
                          ? "inline-block rounded-full border border-border bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
                          : "inline-block rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums"
                      }
                    >
                      {capacityLabel(trip)}
                    </span>
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
              href={`/shop/${shopSlug}/schedule?after=${encodeURIComponent(nextCursor)}${month ? `&month=${month}` : ""}`}
              className={buttonClass({ variant: "secondary" })}
            >
              Show later departures
            </Link>
          ) : null}
          {after ? (
            <Link
              href={`/shop/${shopSlug}/schedule${month ? `?month=${month}` : ""}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              ← Back to the next departure
            </Link>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
