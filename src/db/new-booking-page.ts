import { type CalendarDate, calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { FLEXIBLE_WINDOW_DAYS } from "@/lib/date-requests";
import { seatsOnSale } from "@/lib/trips";
import type { AppDb } from "./client";
import { findSimilarDivers, getBookableDiver, listBookableDivers } from "./divers";
import { readFormDraft } from "./form-drafts";
import { listDateInterestsByIds, listOpenDateInterestsForDates } from "./interest-dates";
import { PAGE_SIZE } from "./paging";
import { offsetUpcomingTripsWithCounts } from "./trips-queries";
import { getTripWithBooked } from "./trips-record";

/**
 * How many departures the picker offers at once. A page, not a shop's whole
 * future: a busy season has hundreds of upcoming departures, and a picker that
 * rendered all of them would be a screen nobody can scan (AGENTS.md — bound
 * the page, not the capture).
 *
 * The picker shows two days at a time now (`departurePickerWindow`), with a
 * date control and Earlier / Later days beside it, so the pager only appears
 * for a window that holds more than a page (ADR 20260803-one-pagination-model
 * still governs it when it does).
 */
const TRIP_PAGE_SIZE = PAGE_SIZE.list;

/**
 * How far ahead the call form looks for a full departure to wait-list. A phone
 * call is about the next week or two, and a `<select>` holding a season is a
 * control nobody can use one-handed with a handset to their ear.
 */
const CALL_DEPARTURE_LOOKAHEAD = 40;

/** The `±FLEXIBLE_WINDOW_DAYS` around each date, once each. */
function flexibleLookupDates(dates: readonly CalendarDate[]): CalendarDate[] {
  return [
    ...new Set(
      dates.flatMap((date) =>
        Array.from({ length: FLEXIBLE_WINDOW_DAYS * 2 + 1 }, (_unused, index) =>
          shiftCalendarDate(date, index - FLEXIBLE_WINDOW_DAYS),
        ),
      ),
    ),
  ];
}

/**
 * **New booking's picker in one call** (issue #2757): the window's page of
 * departures with space, the reader's unfinished call form, and the next few
 * weeks for the call form's full boats; when the window is empty, where the
 * next open seat is; then the date requests a booking could answer — the one
 * `?request=` names and every open one within the flexible window of a day in
 * the picker. Read for whoever can open this page (issue #1679), still scoped
 * to the shop so a `?request=` id cannot reach another tenant.
 *
 * A non-numeric `page` reads as page 1; the query clamps it into range.
 */
export async function getNewBookingPage(
  db: AppDb,
  shop: { id: string; timezone: string },
  personId: string,
  input: { page: number; window: { start: Date; end: Date }; requestId?: string | null },
) {
  const [tripPage, callDraft, upcoming] = await Promise.all([
    offsetUpcomingTripsWithCounts(db, shop.id, {
      hasSpace: true,
      limit: TRIP_PAGE_SIZE,
      page: input.page,
      now: input.window.start,
      monthEnd: input.window.end,
    }),
    readFormDraft(db, shop.id, personId, "took_a_call"),
    offsetUpcomingTripsWithCounts(db, shop.id, { limit: CALL_DEPARTURE_LOOKAHEAD }),
  ]);
  const nextOpen =
    tripPage.trips.length === 0
      ? ((
          await offsetUpcomingTripsWithCounts(db, shop.id, {
            hasSpace: true,
            limit: 1,
            now: input.window.end,
          })
        ).trips[0] ?? null)
      : null;
  const tripDates = [
    ...new Set(tripPage.trips.map((trip) => calendarDateInTimezone(trip.startsAt, shop.timezone))),
  ];
  const [requestRows, relevantRows] = await Promise.all([
    input.requestId ? listDateInterestsByIds(db, shop.id, [input.requestId]) : [],
    listOpenDateInterestsForDates(db, shop.id, flexibleLookupDates(tripDates)),
  ]);
  return {
    tripPage,
    trips: tripPage.trips.map(seatsOnSale),
    callDraft,
    upcoming,
    nextOpen,
    tripDates,
    selectedRequest: requestRows[0] ?? null,
    relevantRows,
  };
}

/**
 * **Booking a diver onto one departure** (issue #2757): who a name being
 * confirmed reads like, and the departure, read by id rather than from the
 * picker's page (a departure past the first page is still a legitimate place
 * to stand) — `null` unless it is this shop's and scheduled. Then the date
 * requests a booking here could answer (issue #1679; scoped to the shop), and
 * the divers to offer: the request's own diver when it names one and nothing
 * was typed, otherwise a search for the typed name or, failing that, the
 * request's name (`anonymousName` when it has none).
 */
export async function getBookingForTripPage(
  db: AppDb,
  shop: { id: string; timezone: string },
  tripId: string,
  input: {
    confirmName?: string;
    requestId?: string | null;
    query: string;
    anonymousName: string;
  },
) {
  const [confirmMatches, trip] = await Promise.all([
    input.confirmName ? findSimilarDivers(db, shop.id, input.confirmName) : [],
    getTripWithBooked(db, shop.id, tripId),
  ]);
  if (trip?.status !== "scheduled") return null;
  const tripDate = calendarDateInTimezone(trip.startsAt, shop.timezone);
  const [requestRows, relevantRows] = await Promise.all([
    input.requestId ? listDateInterestsByIds(db, shop.id, [input.requestId]) : [],
    listOpenDateInterestsForDates(db, shop.id, flexibleLookupDates([tripDate])),
  ]);
  const requestContext = requestRows[0] ?? null;
  const requestPersonId = !input.query ? (requestContext?.personId ?? null) : null;
  const requestCandidate = requestPersonId
    ? await getBookableDiver(db, shop.id, trip.id, requestPersonId)
    : null;
  const searchQuery =
    input.query || (requestPersonId ? (requestContext?.name ?? input.anonymousName) : "");
  const candidates = requestCandidate
    ? [requestCandidate]
    : await listBookableDivers(db, shop.id, trip.id, { query: searchQuery });
  return { confirmMatches, trip, tripDate, requestContext, relevantRows, searchQuery, candidates };
}
