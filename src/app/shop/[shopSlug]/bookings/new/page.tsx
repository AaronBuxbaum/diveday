import type { Metadata } from "next";
import { connection } from "next/server";
import { discardFormDraftAction, saveFormDraftAction } from "@/app/actions/form-drafts";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { FormDraft } from "@/components/FormDraft";
import { formDraftCopy } from "@/components/form-draft-copy";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import {
  type BookingRequestCardItem,
  BookingRequestContext,
  RelevantBookingRequests,
} from "@/components/seat-diver/BookingRequestCards";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { buttonClass } from "@/components/ui/button";
import { cardSummaryClass, sectionCardClass } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { FieldActions, FormStatus } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import {
  type DateRequestRow,
  listDateRequestsByIds,
  listDateRequestsForCalendarDates,
} from "@/db/course-inquiries";
import { readFormDraft } from "@/db/form-drafts";
import { PAGE_SIZE } from "@/db/paging";
import { offsetUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import {
  calendarDateInTimezone,
  formatCalendarDate,
  groupByLocalDay,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { dateRequestMatchFor, FLEXIBLE_WINDOW_DAYS } from "@/lib/date-requests";
import { departurePickerWindow } from "@/lib/departure-picker-window";
import { formatShortDate, formatTime, formatTimeRange } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { isCallOutcome } from "@/lib/took-a-call";
import { spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import type { DeparturePickerDay } from "./_components/DeparturePicker";
import { DepartureWindowSection } from "./_components/DepartureWindowSection";
import { type CallDeparture, TookACallFields } from "./_components/TookACallFields";
import { tookACallAction } from "./call-actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
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

/** The `?notice=` the call form can come back with, from `./call-actions.ts`. */
const CALL_NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "call-invalid": { tone: "danger", key: "calls.notice.invalid" },
  "call-name": { tone: "danger", key: "calls.notice.name" },
  "call-reply": { tone: "danger", key: "calls.notice.reply" },
  "call-email": { tone: "danger", key: "calls.notice.email" },
  "call-departure": { tone: "danger", key: "calls.notice.departure" },
  "call-interest": { tone: "danger", key: "calls.notice.interest" },
};

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
 *
 * **A caller with no seat to book is taken down at the foot** (N-22): the
 * boat they want is full, so it is a wait-list entry, or the day they want is
 * not on the board, so it is a date request. That form was its own "Took a
 * call" page, reachable only from search, routing to these same three answers;
 * the booking one is this page, so the other two live under it. It keeps a
 * draft as it is typed (ADR 20260906-before-you-ask, decision 3), which is what
 * a call interrupted mid-sentence needs.
 */
export default async function NewBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    page?: string;
    request?: string;
    notice?: string;
    outcome?: string;
    from?: string;
  }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const { shopSlug } = await params;
  const { page, request, notice, outcome, from } = await searchParams;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const requestId = request ? uuidParam(request) : null;
  // Today and tomorrow unless the staffer asked for another day (UX audit
  // 2026-10-07, item 19): the departures in that window, paged only if a
  // window ever holds more than a page.
  const pickerWindow = departurePickerWindow({ now: nowDate(), timeZone: shop.timezone, from });

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one.
  const [tripPage, callDraft, upcoming] = await Promise.all([
    offsetUpcomingTripsWithCounts(db, shop.id, {
      hasSpace: true,
      limit: TRIP_PAGE_SIZE,
      page: Number.parseInt(page ?? "", 10),
      now: pickerWindow.start,
      monthEnd: pickerWindow.end,
    }),
    readFormDraft(db, shop.id, session.user.personId, "took_a_call"),
    offsetUpcomingTripsWithCounts(db, shop.id, { limit: CALL_DEPARTURE_LOOKAHEAD }),
  ]);
  // The wait list is only for a full boat, so the call form offers only those.
  const fullDepartures: CallDeparture[] = upcoming.trips
    .filter((trip) => spotsRemaining(trip) === 0)
    .map((trip) => ({
      id: trip.id,
      label: t("calls.departureFull", {
        title: trip.title,
        date: formatShortDate(trip.startsAt, locale, shop.timezone),
        time: formatTime(trip.startsAt, locale, shop.timezone),
      }),
    }));
  const callNotice = noticeFromParam(notice, CALL_NOTICES);
  const trips = tripPage.trips;
  // An empty window says where the next open seat is, rather than leaving the
  // staffer to step through empty days to find it; nothing open anywhere
  // ahead is the board's empty state below.
  const nextOpen =
    trips.length === 0
      ? ((
          await offsetUpcomingTripsWithCounts(db, shop.id, {
            hasSpace: true,
            limit: 1,
            now: pickerWindow.end,
          })
        ).trips[0] ?? null)
      : null;
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
  // Read for whoever can open this page, since 2026-09-16 (issue #1679). It
  // was behind `canPersonViewShopReports` as the downstream half of the gate
  // on `/requests`; that page is ungated now, so the check protected nothing
  // and only emptied the hand-off — a captain following "Create booking" from
  // a request got no prefilled diver and no matching-request cards. Still
  // scoped to `shop.id`, so a `?request=` id cannot reach another tenant.
  const [requestContext, relevantRows]: [DateRequestRow[], DateRequestRow[]] = await Promise.all([
    requestId ? listDateRequestsByIds(db, shop.id, [requestId]) : Promise.resolve([]),
    listDateRequestsForCalendarDates(db, shop.id, lookupDates),
  ]);
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

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      {/* The eyebrow is the way up, in the board's own word. It used to read
          "Bookings" — a nav group with no page behind it, which principle 10
          forbids — with a second back link to the board underneath it. */}
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        eyebrowHref={shopPath(shopSlug, "schedule", "board")}
        title={t("bookings.new.title")}
      />

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

      <DepartureWindowSection
        self={`/shop/${shopSlug}/bookings/new`}
        pickerWindow={pickerWindow}
        requestId={selectedRequest?.id ?? null}
        days={pickerDays}
        tripPage={tripPage}
        nextOpenDay={nextOpen ? calendarDateInTimezone(nextOpen.startsAt, shop.timezone) : null}
        boardHref={shopPath(shopSlug, "schedule", "board")}
        locale={locale}
        t={t}
      />

      {/* `padding="none"`: the summary and the open body pad themselves. Opens
          on its own refusal, or on a kept draft — a shut disclosure would hide
          the answer the staffer is waiting for, or the call they were halfway
          through. */}
      <AutoOpenDetails
        openOnHash="call"
        id="call"
        open={callNotice !== null || callDraft !== null}
        className={sectionCardClass({
          padding: "none",
          className: "group/call mt-10 scroll-mt-24",
        })}
      >
        <summary className={cardSummaryClass({ className: "min-h-11 justify-between p-5 sm:p-6" })}>
          <h2 className={SECTION_TITLE_CLASS}>{t("calls.title")}</h2>
          <SummaryCaret
            line={`h-lh ${SECTION_TITLE_CLASS}`}
            className="size-4 text-muted group-open/call:rotate-90"
          />
        </summary>
        <form
          action={tookACallAction.bind(null, shopSlug)}
          className="border-t border-border p-5 sm:p-6"
        >
          <FormDraft
            form="took_a_call"
            draft={
              callDraft
                ? {
                    fields: callDraft.fields,
                    savedAtLabel: formatTime(callDraft.savedAt, locale, shop.timezone),
                  }
                : null
            }
            actions={{ save: saveFormDraftAction, discard: discardFormDraftAction }}
            copy={formDraftCopy(t)}
          />
          <PersonFieldTrio
            as="div"
            email="optional"
            nameLabel={t("seatDiver.nameLabel")}
            emailLabel={t("seatDiver.emailLabel")}
            phoneLabel={t("seatDiver.phoneLabel")}
            optionalHint={t("seatDiver.optionalHint")}
          />
          <TookACallFields
            copy={{
              outcomeHeading: t("calls.outcomeHeading"),
              outcome: {
                "date-request": t("calls.outcome.dateRequest"),
                waitlist: t("calls.outcome.waitlist"),
              },
              departureLabel: t("calls.departureLabel"),
              departureUnchosen: t("calls.departureUnchosen"),
              noDepartures: t("calls.noDepartures"),
              interestLabel: t("calls.interestLabel"),
              interestPlaceholder: t("calls.interestPlaceholder"),
              preferredDateLabel: t("calls.preferredDateLabel"),
              diversLabel: t("calls.diversLabel"),
              noteLabel: t("calls.noteLabel"),
              optionalHint: t("seatDiver.optionalHint"),
            }}
            departures={fullDepartures}
            defaultOutcome={isCallOutcome(outcome) ? outcome : null}
          />
          {/* The refusal sits in the action row beside the button that
              produced it, never in a banner at the top of the page. */}
          <FieldActions className="mt-4">
            <SubmitButton pendingLabel={t("calls.submitting")} className={buttonClass()}>
              {t("calls.submit")}
            </SubmitButton>
            <FormStatus tone={callNotice?.tone ?? "danger"}>
              {callNotice ? t(callNotice.key) : null}
            </FormStatus>
          </FieldActions>
        </form>
      </AutoOpenDetails>
    </main>
  );
}
