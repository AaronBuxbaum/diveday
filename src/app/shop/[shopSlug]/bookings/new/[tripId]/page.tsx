import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import {
  type BookingRequestCardItem,
  BookingRequestContext,
  RelevantBookingRequests,
} from "@/components/seat-diver/BookingRequestCards";
import { SelectedTripCard } from "@/components/seat-diver/SelectedTripCard";
import { FormStatus } from "@/components/ui/form";
import { findSimilarDivers, getBookableDiver, listBookableDivers } from "@/db/divers";
import {
  type DateInterestRow,
  listDateInterestsByIds,
  listOpenDateInterestsForDates,
} from "@/db/interest-dates";
import { getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { dateRequestMatchFor, FLEXIBLE_WINDOW_DAYS } from "@/lib/date-requests";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SeatDiverPanel } from "../../../_components/SeatDiverPanel";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "New booking — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * The global "Add a booking" door, step two: who is taking the seat?
 *
 * The departure door with the boat chosen a step earlier: pick a returning
 * diver, or hand-enter a new one with the email optional, submitting through
 * the shared seat-a-diver actions (src/app/actions/seat-diver.ts), so a diver
 * seated here owes exactly the consequences a diver seated at any other door
 * does. Seated or refused, the staffer lands on the boat's Divers tab
 * (`SEAT_SURFACES.departure`), which holds the add-diver form and says why a
 * refusal happened; nothing here speaks refusals of its own.
 *
 * The departure lives in the path rather than a `?tripId=`: it is a place the
 * staffer is standing, bookmarkable and shareable.
 */
export default async function NewBookingDiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
  searchParams: Promise<{
    diverq?: string;
    request?: string;
    confirmName?: string;
    confirmEmail?: string;
    confirmPhone?: string;
    notice?: string;
  }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const { shopSlug, tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { diverq, request, confirmName, confirmEmail, confirmPhone, notice } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  const confirmMatches = confirmName ? await findSimilarDivers(db, shop.id, confirmName) : [];
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const seatNotice = noticeFromParam(notice, {
    "party-seat-added": {
      tone: "success" as NoticeTone,
      text: t("bookings.new.partySeatAdded"),
    },
  });
  const requestId = request ? uuidParam(request) : null;

  // Read by id, not from the picker's page of options: a departure sitting past
  // the first page is still a legitimate place to stand.
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();
  const query = diverq?.trim() ?? "";
  const tripDate = calendarDateInTimezone(trip.startsAt, shop.timezone);
  const lookupDates = Array.from({ length: FLEXIBLE_WINDOW_DAYS * 2 + 1 }, (_unused, index) =>
    shiftCalendarDate(tripDate, index - FLEXIBLE_WINDOW_DAYS),
  );
  // Read for whoever can open this page, since 2026-09-16 (issue #1679). It
  // was behind `canPersonViewShopReports` as the downstream half of the gate
  // on `/requests`; that page is ungated now, so the check protected nothing
  // and only emptied the hand-off — a captain following "Create booking" from
  // a request got no prefilled diver and no matching-request cards. Still
  // scoped to `shop.id`, so a `?request=` id cannot reach another tenant.
  const [requestRows, relevantRows]: [DateInterestRow[], DateInterestRow[]] = await Promise.all([
    requestId ? listDateInterestsByIds(db, shop.id, [requestId]) : Promise.resolve([]),
    listOpenDateInterestsForDates(db, shop.id, lookupDates),
  ]);
  const requestContext: DateInterestRow | null = requestRows[0] ?? null;
  const requestSubject = (row: DateInterestRow) =>
    row.courseTitle
      ? t("requests.aboutCourse", { course: row.courseTitle })
      : t("requests.aboutDive", { interest: row.interest ?? "" });
  const requestName = (row: DateInterestRow) => row.name ?? t("requests.anonymous");
  const requestDivers = (row: DateInterestRow) =>
    t("requests.divers", { count: Math.max(1, row.partySize ?? 1) });
  const matchingRequests = relevantRows.filter(
    (row) => dateRequestMatchFor(row, tripDate) !== null,
  );
  const requestItems: BookingRequestCardItem[] = matchingRequests.map((row) => ({
    id: row.id,
    name: requestName(row),
    subject: requestSubject(row),
    diversLabel: requestDivers(row),
    dateLabel: formatCalendarDate(tripDate, locale),
    href: `/shop/${shopSlug}/bookings/new/${trip.id}?request=${encodeURIComponent(row.id)}`,
  }));
  const requestPersonSearch = requestContext?.personId && !query ? requestName(requestContext) : "";
  const searchQuery = query || requestPersonSearch;
  const requestCandidate =
    requestContext?.personId && !query
      ? await getBookableDiver(db, shop.id, trip.id, requestContext.personId)
      : null;
  const candidates = requestCandidate
    ? [requestCandidate]
    : await listBookableDivers(db, shop.id, trip.id, { query: searchQuery });
  const requestQuery = requestContext ? `?request=${encodeURIComponent(requestContext.id)}` : "";
  return (
    <StaffPage width="reading">
      {/* R9 put a second link under this header pointing back one step, to the
          departure picker, because pointing at the board stranded a staffer
          who had picked the wrong boat. `SelectedTripCard` below now carries
          that door on the departure itself, which is where principle 10 wants
          it, so the header spends its one way up on the board — the same word
          step one names. */}
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        eyebrowHref={shopPath(shopSlug, "schedule", "board")}
        title={t("bookings.new.title")}
      />

      {seatNotice ? (
        <FormStatus tone={seatNotice.tone} className="mt-6">
          {seatNotice.text}
        </FormStatus>
      ) : null}

      {requestContext ? (
        <BookingRequestContext
          className="mt-6"
          title={t("bookings.new.fromRequest")}
          name={requestName(requestContext)}
          diversLabel={requestDivers(requestContext)}
          subject={requestSubject(requestContext)}
          sourceHref={`/shop/${shopSlug}/requests`}
          sourceLabel={t("bookings.new.viewRequests")}
          personHref={
            requestContext.personId
              ? `/shop/${shopSlug}/divers/${requestContext.personId}`
              : undefined
          }
          personLabel={requestContext.personId ? t("requests.viewDiver") : undefined}
        />
      ) : null}

      <RelevantBookingRequests
        className="mt-6"
        title={t("bookings.new.relevantRequests")}
        openLabel={t("bookings.new.bookFromRequest")}
        items={requestItems}
      />

      <SelectedTripCard
        className="mt-6"
        label={t("bookings.new.tripHeading")}
        summary={t("seatDiver.tripSummary", {
          title: trip.title,
          date: formatShortDate(trip.startsAt, locale, shop.timezone),
          time: formatTimeRange(trip.startsAt, trip.endsAt, locale, shop.timezone),
          booked: trip.booked,
          capacity: trip.sellableCapacity,
        })}
        changeHref={`/shop/${shopSlug}/bookings/new${requestQuery}`}
        changeLabel={t("bookings.new.changeTrip")}
      />

      {/* The panel the roster's add-diver band is the other half of: one door,
          `SEAT_SURFACES.departure`, whichever page the staffer started on. */}
      <SeatDiverPanel
        surface="departure"
        shopSlug={shopSlug}
        tripId={trip.id}
        query={searchQuery}
        candidates={candidates}
        personHref={(personId) => `/shop/${shopSlug}/divers/${personId}`}
        searchHiddenFields={requestContext ? { request: requestContext.id } : undefined}
        newDiverDefaults={
          requestContext && !requestContext.personId
            ? {
                fullName: requestContext.name ?? undefined,
                email: requestContext.email ?? undefined,
                phone: requestContext.phone ?? undefined,
              }
            : undefined
        }
        confirmName={confirmName}
        confirmEmail={confirmEmail}
        confirmPhone={confirmPhone}
        confirmMatches={confirmMatches}
        copy={{
          findHeading: t("seatDiver.findHeading"),
          findLabel: t("seatDiver.findLabel"),
          findPlaceholder: t("seatDiver.findPlaceholder"),
          noEmailOnFile: t("seatDiver.noEmailOnFile"),
          adding: t("seatDiver.adding"),
          addLabel: t("bookings.new.addToTrip"),
          addPersonAriaLabel: (name) => t("bookings.new.addPersonAriaLabel", { name }),
          noMatchesHeading: t("seatDiver.noMatchesHeading"),
          noMatches: t("seatDiver.noMatches", { query }),
          noMatchesAction: t("seatDiver.noMatchesAction"),
          addDiver: t("seatDiver.addDiver"),
          addDiverAction: t("seatDiver.addDiverAction"),
          addDiverPrompt: t.raw("seatDiver.addDiverPrompt"),
          addNewDiverAction: t.raw("seatDiver.addNewDiverAction"),
          confirmMatchesTitle: t("divers.page.confirmMatchesTitle", { name: confirmName ?? "" }),
          confirmMatchesLastDive: (at) =>
            t("divers.page.confirmMatchesLastDive", {
              date: formatShortDate(at, locale, shop.timezone),
            }),
          confirmMatchesNoDiveDay: t("divers.page.confirmMatchesNoDiveDay"),
          confirmMatchesBorn: (dateOfBirth) =>
            t("divers.page.confirmMatchesBorn", { date: formatCalendarDate(dateOfBirth, locale) }),
          confirmMatchesSubmit: t("divers.page.confirmMatchesSubmit"),
        }}
      />
    </StaffPage>
  );
}
