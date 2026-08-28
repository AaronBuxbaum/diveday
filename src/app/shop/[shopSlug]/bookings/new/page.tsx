import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import {
  type BookingRequestCardItem,
  BookingRequestContext,
  RelevantBookingRequests,
} from "@/components/seat-diver/BookingRequestCards";
import { buttonClass } from "@/components/ui/button";
import {
  type DateRequestRow,
  listDateRequestsByIds,
  listDateRequestsForCalendarDates,
} from "@/db/course-inquiries";
import { PAGE_SIZE } from "@/db/paging";
import { canPersonViewShopReports } from "@/db/reporting";
import { offsetUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  calendarDateInTimezone,
  formatCalendarDate,
  groupByLocalDay,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { dateRequestMatchFor, FLEXIBLE_WINDOW_DAYS } from "@/lib/date-requests";
import { formatTimeRange } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { DeparturePicker, type DeparturePickerDay } from "./_components/DeparturePicker";

// `instant = true` asserts that navigating *into* this page paints
// immediately. Not a claim of a static shell: the staff shell layout declares
// `instant = false` (read its comment for why), so a cold direct visit still
// blocks on the session and shop row. What this validates is the navigation
// staff make all day — arriving from another `/shop` page, where the shell
// is already mounted. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Add a booking — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * How many departures the picker offers at once. A page, not a shop's whole
 * future: a busy season has hundreds of upcoming departures, and a picker that
 * rendered all of them would be a screen nobody can scan (AGENTS.md — bound
 * the page, not the capture).
 *
 * Anything past this used to be reachable only by leaving for the schedule
 * board — the one place staff still met "go look somewhere else" where every
 * other list says "page 2 of 4" (ADR 20260803-one-pagination-model). It pages
 * in place now; the board link above stays, because the board is still where
 * you go to *change* the schedule rather than book against it.
 */
const TRIP_PAGE_SIZE = PAGE_SIZE.list;

/**
 * The global "Add a booking" door, step one: which departure?
 *
 * Every other staff door starts somewhere else — a trip you already opened, a
 * diver record you already found, the check-in counter — so "someone just
 * called, put them on Saturday's boat" meant navigating to a trip first just
 * to reach a form. This is the same two decisions in their natural order:
 * which departure (here), then who (`./[tripId]/page.tsx`).
 *
 * The chosen departure is a path segment, not a `?tripId=`, because it is a
 * *place* the staffer is standing — bookmarkable, shareable, and the URL a
 * refusal can bounce back to while adding only its own `?notice=`.
 */
export default async function NewBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string; request?: string }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const { shopSlug } = await params;
  const { page, request } = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const requestId = request ? uuidParam(request) : null;
  const canViewReports = await canPersonViewShopReports(db, shop.id, session.user.personId);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one.
  const tripPage = await offsetUpcomingTripsWithCounts(db, shop.id, {
    hasSpace: true,
    limit: TRIP_PAGE_SIZE,
    page: Number.parseInt(page ?? "", 10),
  });
  const trips = tripPage.trips;
  const tripDates = [
    ...new Set(trips.map((trip) => calendarDateInTimezone(trip.startsAt, shop.timezone))),
  ];
  const lookupDates = [
    ...new Set(
      tripDates.flatMap((date) =>
        Array.from({ length: FLEXIBLE_WINDOW_DAYS * 2 + 1 }, (_unused, index) =>
          shiftCalendarDate(date, index - FLEXIBLE_WINDOW_DAYS),
        ),
      ),
    ),
  ];
  const [requestContext, relevantRows]: [DateRequestRow[], DateRequestRow[]] = canViewReports
    ? await Promise.all([
        requestId ? listDateRequestsByIds(db, shop.id, [requestId]) : Promise.resolve([]),
        listDateRequestsForCalendarDates(db, shop.id, lookupDates),
      ])
    : [[], []];
  const selectedRequest = requestContext[0] ?? null;
  const relevantDateById = new Map<string, string>();
  for (const date of tripDates) {
    for (const row of relevantRows) {
      if (dateRequestMatchFor(row, date) && !relevantDateById.has(row.id)) {
        relevantDateById.set(row.id, date);
      }
    }
  }
  const relevantRequestsByDate = new Map(
    tripDates.map((date) => [
      date,
      relevantRows.filter((row) => dateRequestMatchFor(row, date) !== null),
    ]),
  );
  const requestSubject = (row: DateRequestRow) =>
    row.courseTitle
      ? t("requests.aboutCourse", { course: row.courseTitle })
      : t("requests.aboutDive", { interest: row.interest ?? "" });
  const requestName = (row: DateRequestRow) => row.name ?? t("requests.anonymous");
  const requestDivers = (row: DateRequestRow) =>
    t("requests.divers", { count: Math.max(1, row.divers ?? 1) });
  const bookingPath = (requestForBooking?: string, tripId?: string) => {
    const path = tripId
      ? `/shop/${shopSlug}/bookings/new/${tripId}`
      : `/shop/${shopSlug}/bookings/new`;
    if (!requestForBooking) return path;
    return `${path}?request=${encodeURIComponent(requestForBooking)}`;
  };
  const relevantRequestItems: BookingRequestCardItem[] = relevantDateById.size
    ? relevantRows
        .filter((row) => relevantDateById.has(row.id))
        .flatMap((row) => {
          const date = relevantDateById.get(row.id);
          if (!date) return [];
          return [
            {
              id: row.id,
              name: requestName(row),
              subject: requestSubject(row),
              diversLabel: requestDivers(row),
              dateLabel: formatCalendarDate(date, locale),
              href: bookingPath(row.id),
            },
          ];
        })
    : [];
  /**
   * The days, and the departures inside each. `groupByLocalDay` buckets the
   * instants in the **shop's** zone, not the server's — on a UTC box a 9:00 PM
   * Key Largo departure is stored on tomorrow's date, so a host-zone read
   * would file a shop's evening under the wrong heading and no test on a UTC
   * runner could see it. The rows already arrive in `startsAt` order, so the
   * days come back consecutive and the Pager cannot split one across a page
   * boundary out of order.
   */
  const pickerDays: DeparturePickerDay[] = groupByLocalDay(
    trips,
    shop.timezone,
    (trip) => trip.startsAt,
  ).map((group) => ({
    day: group.day,
    label: formatCalendarDate(group.day, locale),
    rows: group.items.map((trip) => {
      const requestCount = relevantRequestsByDate.get(group.day)?.length ?? 0;
      return {
        id: trip.id,
        href: bookingPath(selectedRequest?.id, trip.id),
        title: trip.title,
        time: formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone),
        // Seats left, not "booked/capacity": the question at this moment is
        // whether this diver fits.
        seats: t("bookings.new.seatsLeft", { count: spotsRemaining(trip) }),
        ...(requestCount > 0
          ? { requests: t("bookings.new.requestsCount", { count: requestCount }) }
          : {}),
      };
    }),
  }));
  const self = `/shop/${shopSlug}/bookings/new`;
  const pageHref = (target: number) => (target > 1 ? `${self}?page=${target}` : self);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader eyebrow={t("bookings.new.eyebrow")} title={t("bookings.new.title")} />
      <Link
        href={`/shop/${shopSlug}/schedule/board`}
        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <DiveDayIcon name="arrow-left" className="size-4" />
        {t("bookings.new.backToBoard")}
      </Link>

      {selectedRequest ? (
        <BookingRequestContext
          className="mt-6"
          title={t("bookings.new.fromRequest")}
          name={requestName(selectedRequest)}
          diversLabel={requestDivers(selectedRequest)}
          subject={requestSubject(selectedRequest)}
          sourceHref={`/shop/${shopSlug}/requests`}
          sourceLabel={t("bookings.new.viewRequests")}
          personHref={
            selectedRequest.personId
              ? `/shop/${shopSlug}/divers/${selectedRequest.personId}`
              : undefined
          }
          personLabel={selectedRequest.personId ? t("requests.viewDiver") : undefined}
        />
      ) : null}

      <RelevantBookingRequests
        className="mt-6"
        title={t("bookings.new.relevantRequests")}
        openLabel={t("bookings.new.bookFromRequest")}
        items={relevantRequestItems}
      />

      {/* The list is filtered to departures with a seat left, and a filter
          nobody announced reads as a missing departure: a sold-out Saturday
          simply wasn't here, with nothing on screen to say why or what to do
          about it. The picker says both, and names the board as the place to
          do something about it. */}
      {trips.length === 0 ? (
        // "Put a departure on the board first" now goes to the board.
        <EmptyState
          title={t("bookings.new.tripEmpty")}
          action={
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ className: "mt-4" })}
            >
              {t("bookings.new.tripEmptyAction")}
            </Link>
          }
          className="mt-8"
        />
      ) : (
        <>
          <DeparturePicker
            className="mt-8"
            heading={t("bookings.new.tripHeading")}
            headingId="which-departure"
            days={pickerDays}
          />
          <Pager
            page={tripPage.page}
            pageCount={tripPage.pageCount}
            href={pageHref}
            total={t("bookings.new.pagination.total", { count: tripPage.total })}
            t={t}
            className="mt-4"
          />
          {/* Under the list rather than over it: it explains an absence, and
              an absence is only noticed once the reader has looked for it. */}
          <p className="mt-4 text-sm text-muted">{t("bookings.new.fullExcluded")}</p>
        </>
      )}
    </main>
  );
}
