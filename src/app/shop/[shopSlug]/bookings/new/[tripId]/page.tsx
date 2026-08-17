import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import {
  type BookingRequestCardItem,
  BookingRequestContext,
  RelevantBookingRequests,
} from "@/components/seat-diver/BookingRequestCards";
import { SelectedTripCard } from "@/components/seat-diver/SelectedTripCard";
import { getDb } from "@/db/client";
import {
  type DateRequestRow,
  listDateRequestsByIds,
  listDateRequestsForCalendarDates,
} from "@/db/course-inquiries";
import { findSimilarDivers, getBookableDiver, listBookableDivers } from "@/db/divers";
import { canPersonViewShopReports } from "@/db/reporting";
import { getShopById } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { dateRequestMatchFor, FLEXIBLE_WINDOW_DAYS } from "@/lib/date-requests";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";
import { uuidParam } from "@/lib/uuid";
import { SeatDiverPanel } from "../../../_components/SeatDiverPanel";

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
 * Refusals, in the trip page's vocabulary — the same codes and mostly the same
 * words the Guests tab uses, because this door is that tab's add-a-diver
 * section with the departure chosen a step earlier. Success never lands here:
 * a seated diver goes to the trip's Guests tab with the roster's own toast
 * (`SEAT_SURFACES["new-booking"]`, src/app/actions/seat-diver-surfaces.ts).
 */
const NOTICE_KEYS: Record<string, { tone: "danger"; key: StaffMessageKey }> = {
  // Its own words, not the Guests tab's: that one asks for "a name and a valid
  // email", which is true there and false here — this door takes the no-email
  // diver the counter always could.
  "diver-invalid": { tone: "danger", key: "bookings.new.noticeInvalid" },
  "diver-full": { tone: "danger", key: "trips.notices.diverFull" },
  "diver-already": { tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": { tone: "danger", key: "trips.notices.diverCourseUnstaffed" },
  "diver-course-prerequisite": { tone: "danger", key: "trips.notices.diverCoursePrerequisite" },
  "diver-course-ratio-full": { tone: "danger", key: "trips.notices.diverCourseRatioFull" },
  "diver-course-min-age": { tone: "danger", key: "trips.notices.diverCourseMinAge" },
  "diver-trip-prerequisite": { tone: "danger", key: "trips.notices.diverTripPrerequisite" },
  "diver-unavailable": { tone: "danger", key: "trips.notices.diverUnavailable" },
};

/**
 * The global "Add a booking" door, step two: who is taking the seat?
 *
 * Same two halves as the counter walk-in — pick a returning diver, or hand-enter
 * a new one with the email optional — submitting through the shared seat-a-diver
 * actions (src/app/actions/seat-diver.ts), so a diver seated here owes exactly
 * the consequences a diver seated at any other door does.
 *
 * The departure lives in the path rather than a `?tripId=`, which is what lets
 * a refusal bounce back here by adding only its own `?notice=` to a URL that
 * had no query. Appending a second param to an already-queried URL is the one
 * shape a server-action redirect could not land on: the client router held the
 * page it already had and the submit button span forever.
 */
export default async function NewBookingDiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; tripId: string }>;
  searchParams: Promise<{
    diverq?: string;
    notice?: string;
    request?: string;
    /** Signed, verified against this route's own `tripId` — src/lib/trip-admission-gate.ts. */
    gate?: string | string[];
    confirmName?: string;
    confirmEmail?: string;
    confirmPhone?: string;
  }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const session = await requireStaffSession();
  const { shopSlug, tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { diverq, notice, gate, request, confirmName, confirmEmail, confirmPhone } =
    await searchParams;
  const db = await getDb();
  // Scoped by the session's own shop, never the URL slug.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const confirmMatches = confirmName ? await findSimilarDivers(db, shop.id, confirmName) : [];
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const requestId = request ? uuidParam(request) : null;
  const canViewReports = await canPersonViewShopReports(db, shop.id, session.user.personId);

  // Read by id, not from the picker's page of options: a departure sitting past
  // the first page is still a legitimate place to stand.
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "scheduled") notFound();
  const query = diverq?.trim() ?? "";
  const tripDate = calendarDateInTimezone(trip.startsAt, shop.timezone);
  const lookupDates = Array.from({ length: FLEXIBLE_WINDOW_DAYS * 2 + 1 }, (_unused, index) =>
    shiftCalendarDate(tripDate, index - FLEXIBLE_WINDOW_DAYS),
  );
  const [requestRows, relevantRows]: [DateRequestRow[], DateRequestRow[]] = canViewReports
    ? await Promise.all([
        requestId ? listDateRequestsByIds(db, shop.id, [requestId]) : Promise.resolve([]),
        listDateRequestsForCalendarDates(db, shop.id, lookupDates),
      ])
    : [[], []];
  const requestContext: DateRequestRow | null = requestRows[0] ?? null;
  const requestSubject = (row: DateRequestRow) =>
    row.courseTitle
      ? t("requests.aboutCourse", { course: row.courseTitle })
      : t("requests.aboutDive", { interest: row.interest ?? "" });
  const requestName = (row: DateRequestRow) => row.name ?? t("requests.anonymous");
  const requestDivers = (row: DateRequestRow) =>
    t("requests.divers", { count: Math.max(1, row.divers ?? 1) });
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
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  // The trip's own cert gate refused this diver: say *which* requirement failed
  // and what they hold, rather than the one static sentence every refusal used
  // to share (src/lib/trip-admission.ts).
  const gateRefusal =
    notice === "diver-trip-prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "trip", id: tripId })
      : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("bookings.new.eyebrow")}
        title={t("bookings.new.title")}
        description={t("bookings.new.description")}
      />
      {/* R9: step two used to point back at the board, exactly like step one —
          so a staffer who picked the wrong departure had to leave the flow and
          re-enter it. Back, here, means back one step: the departure picker.
          Step one keeps the board link, because that is what is behind it. */}
      <Link
        href={`/shop/${shopSlug}/bookings/new${requestQuery}`}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t("bookings.new.backToPicker")}
      </Link>

      {banner ? (
        <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)} className="mt-6">
          {gateRefusal ? tripAdmissionRefusalText(t, gateRefusal, locale) : t(banner.key)}
        </ShopNotice>
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
        description={t("bookings.new.relevantRequestsDescription")}
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
          capacity: trip.capacity,
        })}
        changeHref={`/shop/${shopSlug}/bookings/new${requestQuery}`}
        changeLabel={t("bookings.new.changeTrip")}
      />

      {/* The same panel the counter walk-in stands on — this door is that one
          with the departure chosen a step earlier. The email rule the two
          differ on comes from `SEAT_SURFACES["new-booking"]`, not from a
          `required` attribute hand-copied between two files. */}
      <SeatDiverPanel
        surface="new-booking"
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
          search: t("seatDiver.search"),
          searching: t("seatDiver.searching"),
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
          confirmMatchesTitle: t("divers.page.confirmMatchesTitle"),
          confirmMatchesSubmit: t("divers.page.confirmMatchesSubmit"),
        }}
      />
    </main>
  );
}
