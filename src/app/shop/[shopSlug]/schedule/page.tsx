import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { JsonLd } from "@/components/JsonLd";
import { type CalendarTrip, ScheduleCalendar } from "@/components/ScheduleCalendar";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { ShopReviews } from "@/components/ShopReviews";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { getShopReviewAggregate, listPublishedShopReviews } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import {
  pagedUpcomingTripsWithCounts,
  tripCrewByTrip,
  tripScheduleDayCounts,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingTripsForCalendar,
} from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestTranslator } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
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
import { noticeFromParam } from "@/lib/staff-notices";
import { scheduleJsonLd } from "@/lib/structured-data";
import { capacityLabel, isFull } from "@/lib/trips";
import { toDateInputValue, toTimeInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { LastMinuteListForm } from "./_components/LastMinuteListForm";
import { type BuilderCopy, type BuilderDay, ScheduleBuilder } from "./_components/ScheduleBuilder";
import {
  addDepartureAction,
  duplicateDepartureAction,
  moveDepartureAction,
  removeDepartureAction,
} from "./actions";

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
 * What the board says after a builder action, keyed by the `outcome.reason`
 * code the mutation returns (see `moveTrip`/`duplicateTrip`/`deleteTrip` in
 * src/db/trips.ts). Every outcome gets a sentence — including the refusals,
 * which are the interesting ones: a departure that won't move or won't delete
 * is protecting a roster or a head count, and the staff member needs to know
 * which, not just that nothing happened. The message itself is a lookup into
 * the staff bundle, never English baked into this map (docs `i18n-copy` skill).
 */
const BUILDER_NOTICE_KEYS: Record<
  string,
  { tone: "success" | "danger" | "warning"; key: StaffMessageKey }
> = {
  added: { tone: "success", key: "schedule.notices.added" },
  moved: { tone: "success", key: "schedule.notices.moved" },
  copied: { tone: "success", key: "schedule.notices.copied" },
  removed: { tone: "success", key: "schedule.notices.removed" },
  invalid: { tone: "danger", key: "schedule.notices.invalid" },
  "end-before-start": { tone: "danger", key: "schedule.notices.endBeforeStart" },
  "not-authorized": { tone: "danger", key: "schedule.notices.notAuthorized" },
  "not-found": { tone: "danger", key: "schedule.notices.notFound" },
  "not-scheduled": { tone: "warning", key: "schedule.notices.notScheduled" },
  "already-sailed": { tone: "warning", key: "schedule.notices.alreadySailed" },
  "has-roster": { tone: "warning", key: "schedule.notices.hasRoster" },
};

export default async function TripsPage({
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
    builder?: string;
    preview?: string;
    hasSpace?: string;
    tripType?: string;
  }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { month, after, back, embed, builder, preview, hasSpace, tripType } = await searchParams;
  const hasSpaceFilter = hasSpace === "1";
  const tripTypeFilter = tripType === "fun_dive" || tripType === "course" ? tripType : undefined;
  // Embed mode is the compact, chrome-light surface a shop pastes into its own
  // website (docs ADR 20260726-schedule-embed) — never for staff, who always
  // arrive signed in and never via a third-party iframe.
  const isEmbed = embed === "1";
  // A signed-in staff member deliberately asking to see what a diver sees —
  // e.g. the "View public page" link on /reviews — gets the full diver-facing
  // page, reviews included, rather than the staff board embed mode also
  // suppresses reviews on (see below). Never reachable by accident: it takes
  // the exact query param, not a default.
  const isPreview = preview === "1";
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) {
    notFound();
  }
  const session = await auth();
  // Embed mode always renders the diver-facing surface, even for a signed-in
  // staff member previewing the page — an iframe on the shop's own website
  // must never expose the staff board.
  const staffView =
    !isEmbed && !isPreview && session?.user?.shopId === shop.id && isStaff(session.user.roles);

  // The board is served in pages: the list is one keyset page, the stat tiles
  // and calendar come from bounded queries — nothing loads every trip at once,
  // so a shop with hundreds of departures on the books stays quick.
  const tz = shop.timezone;
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  // The staff board is the only staff-only content on this otherwise
  // diver-facing page (see route map): its copy comes from the staff bundle,
  // never the diver `t` above, even though both share the same negotiated locale.
  const st = staffTranslator(locale);
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
  // regardless of which month the calendar had paged to. The default view
  // (no explicit `?month=`) stays that unbounded list; staff never navigate
  // by month, so their builder list is never bounded by it either.
  const explicitMonth = !staffView ? parseMonthKey(month) : null;
  const listMonthBounds = explicitMonth ? monthBoundsUtc(explicitMonth) : null;

  const [range, stats, { trips: upcoming, nextCursor }, reviewAggregate, reviews] =
    await Promise.all([
      upcomingScheduleRange(db, shop.id, now),
      staffView ? upcomingScheduleStats(db, shop.id, now) : null,
      pagedUpcomingTripsWithCounts(db, shop.id, {
        cursor: after,
        now,
        ...listMonthBounds,
        hasSpace: !staffView && hasSpaceFilter ? true : undefined,
        tripType: !staffView ? tripTypeFilter : undefined,
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
  const nextDeparture =
    !staffView && !explicitMonth ? (upcoming.find((trip) => !isFull(trip)) ?? null) : null;

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

  // The builder works off the same keyset page the list below it renders, so a
  // shop with hundreds of departures still loads one page of rows — the board is
  // a working surface for the next few weeks, not an archive.
  const [canConfigure, dayCounts, crewByTrip, builderCourses, builderDiveSites] = staffView
    ? await Promise.all([
        canPersonConfigureTrips(db, shop.id, session?.user?.personId ?? ""),
        tripScheduleDayCounts(
          db,
          upcoming.map((trip) => trip.id),
        ),
        tripCrewByTrip(
          db,
          shop.id,
          upcoming.map((trip) => trip.id),
        ),
        listActiveCourses(db, shop.id).then((rows) =>
          rows.map((row) => ({ id: row.id, title: row.title })),
        ),
        listDiveSites(db, shop.id).then((rows) =>
          rows.map((row) => ({ id: row.id, title: row.name })),
        ),
      ])
    : [
        false,
        // i18n-exempt: generic-type literal, not copy — scanner false positive.
        new Map<string, number>(),
        new Map<string, Array<{ id: string; name: string }>>(),
        [],
        [],
      ];

  const builderNoticeEntry = noticeFromParam(builder, BUILDER_NOTICE_KEYS);
  const builderNotice = builderNoticeEntry
    ? { tone: builderNoticeEntry.tone, message: st(builderNoticeEntry.key) }
    : undefined;
  const builderCopy: BuilderCopy = {
    heading: st("schedule.builder.heading"),
    description: st("schedule.builder.description"),
    ariaLabel: st("schedule.builder.ariaLabel"),
    addDeparture: st("schedule.builder.addDeparture"),
    addDepartureOnDay: st("schedule.builder.addDepartureOnDay"),
    add: st("schedule.builder.add"),
    cancel: st("schedule.builder.cancel"),
    noSiteSetYet: st("schedule.builder.noSiteSetYet"),
    courseLabel: st("schedule.builder.courseLabel"),
    dayCountLabel: st("schedule.builder.dayCountLabel"),
    crewLabel: st("schedule.builder.crewLabel"),
    crewNobodyYet: st("schedule.builder.crewNobodyYet"),
    noPriceSet: st("schedule.builder.noPriceSet"),
    noPriceSetAria: st("schedule.builder.noPriceSetAria"),
    move: st("schedule.builder.move"),
    moveAria: st("schedule.builder.moveAria"),
    copy: st("schedule.builder.copy"),
    copyAria: st("schedule.builder.copyAria"),
    remove: st("schedule.builder.remove"),
    removeAria: st("schedule.builder.removeAria"),
    removeConfirm: st("schedule.builder.removeConfirm"),
    removePending: st("schedule.builder.removePending"),
    whatIsIt: st("schedule.builder.whatIsIt"),
    titlePlaceholder: st("schedule.builder.titlePlaceholder"),
    date: st("schedule.builder.date"),
    departs: st("schedule.builder.departs"),
    returns: st("schedule.builder.returns"),
    seats: st("schedule.builder.seats"),
    dives: st("schedule.builder.dives"),
    course: st("schedule.builder.course"),
    optional: st("schedule.builder.optional"),
    diveSite: st("schedule.builder.diveSite"),
    ordinaryTrip: st("schedule.builder.ordinaryTrip"),
    decideLater: st("schedule.builder.decideLater"),
    adding: st("schedule.builder.adding"),
    putOnBoard: st("schedule.builder.putOnBoard"),
    newDate: st("schedule.builder.newDate"),
    multiDayNote: st("schedule.builder.multiDayNote"),
    newDepartureTime: st("schedule.builder.newDepartureTime"),
    moving: st("schedule.builder.moving"),
    moveIt: st("schedule.builder.moveIt"),
    copyTo: st("schedule.builder.copyTo"),
    copyDescription: st("schedule.builder.copyDescription"),
    departureTime: st("schedule.builder.departureTime"),
    copying: st("schedule.builder.copying"),
    copyIt: st("schedule.builder.copyIt"),
  };

  const builderDays: BuilderDay[] = [];
  for (const trip of staffView ? upcoming : []) {
    const wall = utcToWallTime(trip.startsAt, tz);
    const dateIso = toDateInputValue(wall);
    let day = builderDays.at(-1);
    if (day?.dateIso !== dateIso) {
      day = { dateIso, label: formatShortDate(trip.startsAt, locale, tz), trips: [] };
      builderDays.push(day);
    }
    day.trips.push({
      id: trip.id,
      title: trip.title,
      dateIso,
      startTime: toTimeInputValue(wall),
      timeRange: formatTimeRange(trip.startsAt, trip.endsAt, locale, tz),
      capacity: trip.capacity,
      booked: trip.booked,
      courseTitle: trip.course?.title ?? null,
      diveSiteName: trip.diveSite?.name ?? null,
      dayCount: dayCounts.get(trip.id) ?? 1,
      crew: (crewByTrip.get(trip.id) ?? []).map((member) => member.name),
      priceCents: trip.priceCents,
    });
  }

  const tripsByDay = new Map<string, CalendarTrip[]>();
  if (!staffView && hasUpcoming) {
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
                {st("schedule.fullTripForm")}
              </Link>
            ) : undefined
          }
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

      {staffView && stats ? (
        <section
          aria-label={st("schedule.overview.ariaLabel")}
          className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <ShopStat
            label={st("schedule.overview.departures")}
            value={stats.departures}
            detail={st("schedule.overview.departuresDetail")}
            tone="primary"
          />
          <ShopStat
            label={st("schedule.overview.booked")}
            value={stats.booked}
            detail={st("schedule.overview.bookedDetail")}
          />
          <ShopStat
            label={st("schedule.overview.openSeats")}
            value={stats.openSeats}
            detail={st("schedule.overview.openSeatsDetail")}
            tone="success"
          />
          <ShopStat
            label={st("schedule.overview.atCapacity")}
            value={stats.atCapacity}
            detail={st("schedule.overview.atCapacityDetail")}
          />
        </section>
      ) : null}

      {staffView && builderNotice ? (
        <ShopNotice
          tone={builderNotice.tone}
          role={builderNotice.tone === "danger" ? "alert" : "status"}
          className="mb-6"
        >
          {builderNotice.message}
        </ShopNotice>
      ) : null}

      {staffView ? (
        <ScheduleBuilder
          shopSlug={shopSlug}
          days={builderDays}
          courses={builderCourses}
          diveSites={builderDiveSites}
          defaultDateIso={builderDays[0]?.dateIso ?? todayIso}
          canConfigure={canConfigure}
          copy={builderCopy}
          actions={{
            add: addDepartureAction.bind(null, shopSlug),
            move: moveDepartureAction.bind(null, shopSlug),
            duplicate: duplicateDepartureAction.bind(null, shopSlug),
            remove: removeDepartureAction.bind(null, shopSlug),
          }}
        />
      ) : null}

      {!staffView && hasUpcoming ? (
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
      ) : null}

      {!staffView && hasUpcoming ? (
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
          {staffView ? (
            <>
              <p className="mt-1 text-sm text-muted">{t("schedule.noTripsStaff")}</p>
              <Link
                href={`/shop/${shopSlug}/trips/new`}
                className={buttonClass({ className: "mt-4 rounded-xl" })}
              >
                {st("schedule.scheduleTrip")}
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{t("schedule.noTripsPublic")}</p>
          )}
        </EmptyState>
      ) : staffView ? null : upcoming.length === 0 ? (
        <p className="text-sm text-muted">
          {hasSpaceFilter || tripTypeFilter
            ? t("schedule.filters.noMatches")
            : t("schedule.noTripsMonth")}
        </p>
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
              // Staff manage a trip on /trips/[id]; anonymous and diver
              // visitors book on /schedule/[id]. Linking staff straight to the
              // management view removes the /schedule/[id] redirect hop.
              const tripHref = staffView
                ? `/shop/${shopSlug}/trips/${trip.id}`
                : `/shop/${shopSlug}/schedule/${trip.id}${isEmbed ? "?embed=1" : ""}`;
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
      {!isEmbed && !staffView ? (
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
      {!isEmbed && !staffView ? (
        <DiverIntlProvider locale={locale} timeZone={tz}>
          <LastMinuteListForm shopSlug={shopSlug} />
        </DiverIntlProvider>
      ) : null}
    </main>
  );
}
