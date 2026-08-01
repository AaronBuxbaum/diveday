import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { getShopById } from "@/db/shops";
import {
  pagedUpcomingTripsWithCounts,
  tripCrewByTrip,
  tripScheduleDayCounts,
  upcomingScheduleRange,
  upcomingScheduleStats,
} from "@/db/trips";
import { requestTranslator } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import {
  decodeCursorStack,
  encodeCursorStack,
  popCursor,
  pushCursor,
} from "@/lib/schedule-pagination";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { toDateInputValue, toTimeInputValue, utcToWallTime } from "@/lib/zoned";
import { type BuilderCopy, type BuilderDay, ScheduleBuilder } from "./_components/ScheduleBuilder";
import {
  addDepartureAction,
  duplicateDepartureAction,
  moveDepartureAction,
  removeDepartureAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Schedule board — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

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

/**
 * The staff operations board — KPI tiles and the add/move/copy/remove
 * departure builder. Split out of the old `/schedule` (Lens 17,
 * docs/product/features/story-backlog.md): that route rendered this staff content
 * *or* the public schedule depending on session, which meant a signed-out
 * diver and a signed-in owner could never both point at the same URL and
 * mean the same thing. `/schedule` is now the public, canonical page this
 * board's own "View public page" link previews.
 */
export default async function ScheduleBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    after?: string;
    /** The stack of every earlier page's cursor, oldest first — see
     * src/lib/schedule-pagination.ts. */
    back?: string;
    builder?: string;
  }>;
}) {
  await connection(); // schedule is live data — render per request, not at build
  const { shopSlug } = await params;
  const { after, back, builder } = await searchParams;
  const session = await requireStaffSession();
  const db = await getDb();
  // Scoped by the session's own shop, never the URL slug — a staff member
  // can't read another shop's board by editing the address bar.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();

  const tz = shop.timezone;
  // Some of this staff page's copy (the header eyebrow/title/description,
  // the empty-board line) has always lived in the diver bundle rather than
  // the staff one — pre-existing, unrelated to this split, left as-is.
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const st = staffTranslator(locale);
  const now = nowDate();

  // The board works off one keyset page of departures, same as the public
  // list — a shop with hundreds of upcoming departures still loads one page,
  // not the whole future.
  const [range, stats, { trips: upcoming, nextCursor }, canConfigure, courses, diveSites] =
    await Promise.all([
      upcomingScheduleRange(db, shop.id, now),
      upcomingScheduleStats(db, shop.id, now),
      pagedUpcomingTripsWithCounts(db, shop.id, { cursor: after, now }),
      canPersonConfigureTrips(db, shop.id, session.user.personId),
      listActiveCourses(db, shop.id).then((rows) =>
        rows.map((row) => ({ id: row.id, title: row.title })),
      ),
      listDiveSites(db, shop.id).then((rows) =>
        rows.map((row) => ({ id: row.id, title: row.name })),
      ),
    ]);
  const hasUpcoming = range.first !== null;
  // Depends on the trip ids above, so it runs as a second wave rather than
  // inside the batch that produces `upcoming`.
  const [dayCounts, crewByTrip] = await Promise.all([
    tripScheduleDayCounts(
      db,
      upcoming.map((trip) => trip.id),
    ),
    tripCrewByTrip(
      db,
      shop.id,
      upcoming.map((trip) => trip.id),
    ),
  ]);

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
    removeConfirmButton: st("schedule.builder.removeConfirmButton"),
    removeCancel: st("schedule.builder.removeCancel"),
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

  const todayIso = toDateInputValue(utcToWallTime(now, tz));
  const builderDays: BuilderDay[] = [];
  for (const trip of upcoming) {
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

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("schedule.eyebrow")}
        title={t("schedule.title")}
        description={t("schedule.staffDescription")}
        actions={
          <>
            <Link
              href={`/shop/${shopSlug}/schedule`}
              className={buttonClass({ variant: "secondary", className: "rounded-xl" })}
            >
              {st("schedule.viewPublicPage")}
            </Link>
            <Link
              href={`/shop/${shopSlug}/trips/new`}
              className={buttonClass({ className: "rounded-xl" })}
            >
              {st("schedule.fullTripForm")}
            </Link>
          </>
        }
      />

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

      {builderNotice ? (
        <ShopNotice
          tone={builderNotice.tone}
          role={builderNotice.tone === "danger" ? "alert" : "status"}
          className="mb-6"
        >
          {builderNotice.message}
        </ShopNotice>
      ) : null}

      {!hasUpcoming ? (
        <EmptyState>
          <h2 className="font-medium">{t("schedule.noTrips")}</h2>
          <p className="mt-1 text-sm text-muted">{t("schedule.noTripsStaff")}</p>
          <Link
            href={`/shop/${shopSlug}/trips/new`}
            className={buttonClass({ className: "mt-4 rounded-xl" })}
          >
            {st("schedule.scheduleTrip")}
          </Link>
        </EmptyState>
      ) : null}

      <ScheduleBuilder
        shopSlug={shopSlug}
        days={builderDays}
        courses={courses}
        diveSites={diveSites}
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

      {nextCursor || after ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {(() => {
            const backStack = decodeCursorStack(back);
            const previous = popCursor(backStack);
            if (!previous) return null;
            const params = new URLSearchParams();
            if (previous.after) params.set("after", previous.after);
            if (previous.stack.length > 0) params.set("back", encodeCursorStack(previous.stack));
            const query = params.toString();
            return (
              <Link
                href={`/shop/${shopSlug}/schedule/board${query ? `?${query}` : ""}`}
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
                return `/shop/${shopSlug}/schedule/board?${params.toString()}`;
              })()}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("schedule.showLater")}
            </Link>
          ) : null}
          {after ? (
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("schedule.backToNext")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
