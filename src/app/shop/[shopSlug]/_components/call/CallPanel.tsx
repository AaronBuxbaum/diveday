import Link from "next/link";
import { notFound } from "next/navigation";
import { bindFormDraft, draftForForm } from "@/app/actions/form-draft-props";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { FormDraft } from "@/components/FormDraft";
import { formDraftCopy } from "@/components/form-draft-copy";
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
import type { NoticeTone } from "@/components/ui/tone";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { AppDb } from "@/db/client";
import type { DateInterestRow } from "@/db/interest-dates";
import { departurePickerWindow } from "@/features/departure-picker-window";
import { getNewBookingPage } from "@/features/new-booking-page";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { DiveDaySession } from "@/lib/auth";
import { calendarDateInTimezone, formatCalendarDate, groupByLocalDay } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { dateRequestsByDay } from "@/lib/date-requests";
import { formatShortDate, formatTime, formatTimeRange } from "@/lib/format";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { callPanelHref, isCallOutcome } from "@/lib/took-a-call";
import { seatsOnSale, spotsRemaining } from "@/lib/trips";
import { uuidParam } from "@/lib/uuid";
import { tookACallAction } from "../../call-actions";
import { CallNoteSlot } from "./CallNoteSlot";
import type { DeparturePickerDay } from "./DeparturePicker";
import { DepartureWindowSection } from "./DepartureWindowSection";
import { type CallDeparture, TookACallFields } from "./TookACallFields";

/** The `?notice=` the call form can come back with, from `../../call-actions.ts`. */
const CALL_NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "call-invalid": { tone: "danger", key: "calls.notice.invalid" },
  "call-name": { tone: "danger", key: "calls.notice.name" },
  "call-reply": { tone: "danger", key: "calls.notice.reply" },
  "call-email": { tone: "danger", key: "calls.notice.email" },
  "call-departure": { tone: "danger", key: "calls.notice.departure" },
  "call-interest": { tone: "danger", key: "calls.notice.interest" },
  "call-waitlist-off": { tone: "warning", key: "calls.notice.waitlistOff" },
};

/** What the shop home's URL says about the panel (`?call=1`). */
export type CallPanelSearch = {
  page?: string;
  request?: string;
  notice?: string;
  outcome?: string;
  from?: string;
};

/**
 * **"Add a booking" when no departure is known** (#2737): the shop home's
 * panel, opened by `?call=1` (`callPanelHref`). A door that knows the boat
 * opens that departure's add band instead (`/trips/<id>?add=1`).
 *
 * "Someone just called, put them on Saturday's boat": the departures with a
 * seat, by day, and a row is the door to that boat's add band, a date request
 * being booked carried along. It used to be a page of its own, step one of
 * two; step two is the departure's own Divers tab now.
 *
 * **A caller with no seat to book is taken down at the foot** (N-22): the
 * boat they want is full, so it is a wait-list entry, or the day they want is
 * not on the board, so it is a date request. It keeps a draft as it is typed
 * (ADR 20260906-before-you-ask, decision 3), which is what a call interrupted
 * mid-sentence needs.
 */
export async function CallPanel({
  db,
  shop,
  user,
  shopSlug,
  locale,
  t,
  search,
}: {
  db: AppDb;
  shop: { id: string; timezone: string; waitlistEnabled: boolean };
  user: DiveDaySession["user"];
  shopSlug: string;
  locale: string;
  t: StaffTranslator;
  search: CallPanelSearch;
}) {
  const { page, request, notice, outcome, from } = search;
  const draftBinding = bindFormDraft(user);
  const requestId = request ? uuidParam(request) : null;
  // A `?request=` this shop does not have is a 404, as on the departure's
  // band: never a picker that quietly drops what the caller asked for.
  if (request && !requestId) notFound();
  // Today and tomorrow unless the staffer asked for another day (UX audit
  // 2026-10-07, item 19): the departures in that window, paged only if a
  // window ever holds more than a page.
  const pickerWindow = departurePickerWindow({ now: nowDate(), timeZone: shop.timezone, from });

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one. An
  // empty window says where the next open seat is, rather than leaving the
  // staffer to step through empty days to find it; nothing open anywhere
  // ahead is the board's empty state below. The date requests are read for
  // whoever can open this page (issue #1679), scoped to `shop.id`, so a
  // `?request=` id cannot reach another tenant.
  const {
    tripPage,
    trips,
    callDraft,
    upcoming,
    nextOpen,
    tripDates,
    selectedRequest,
    relevantRows,
  } = await getNewBookingPage(db, shop, user.personId, {
    page: Number.parseInt(page ?? "", 10),
    window: pickerWindow,
    requestId,
  });
  // The wait list is only for a full boat, so the call form offers only those.
  const fullDepartures: CallDeparture[] = upcoming.trips
    .filter((trip) => spotsRemaining(seatsOnSale(trip)) === 0)
    .map((trip) => ({
      id: trip.id,
      label: t("calls.departureFull", {
        title: trip.title,
        date: formatShortDate(trip.startsAt, locale, shop.timezone),
        time: formatTime(trip.startsAt, locale, shop.timezone),
      }),
    }));
  const callNotice = noticeFromParam(notice, CALL_NOTICES);
  if (requestId && !selectedRequest) notFound();
  const { byDay: relevantRequestsByDate, firstDayById: relevantDateById } = dateRequestsByDay(
    relevantRows,
    tripDates,
  );
  const requestSubject = (row: DateInterestRow) =>
    row.courseTitle
      ? t("requests.aboutCourse", { course: row.courseTitle })
      : t("requests.aboutDive", { interest: row.interest ?? "" });
  const requestName = (row: DateInterestRow) => row.name ?? t("requests.anonymous");
  const requestDivers = (row: DateInterestRow) =>
    t("requests.divers", { count: Math.max(1, row.partySize ?? 1) });
  /** A departure's add band, or this panel, with the request being booked carried along. */
  const bookingPath = (requestForBooking?: string, tripId?: string) => {
    if (!tripId) return callPanelHref(shopSlug, { request: requestForBooking });
    const query = new URLSearchParams({ add: "1" });
    if (requestForBooking) query.set("request", requestForBooking);
    return `${shopPath(shopSlug, "trips", tripId)}?${query.toString()}`;
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
    // Not a card: what it holds are cards and a ledger, and a card around
    // cards is a box drawn twice.
    <section id="call-panel" aria-labelledby="call-panel-title" className="scroll-mt-24">
      <div className="flex items-center justify-between gap-3">
        <h2 id="call-panel-title" className={SECTION_TITLE_CLASS}>
          {t(STAFF_DESTINATION_LABEL_KEYS.addBooking)}
        </h2>
        <Link href={shopPath(shopSlug)} className={buttonClass({ variant: "ghost", size: "sm" })}>
          {t("shared.commandPalette.close")}
        </Link>
      </div>
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
        shopSlug={shopSlug}
        pickerWindow={pickerWindow}
        requestId={selectedRequest?.id ?? null}
        days={pickerDays}
        tripPage={tripPage}
        nextOpenDay={nextOpen ? calendarDateInTimezone(nextOpen.startsAt, shop.timezone) : null}
        boardHref={shopPath(shopSlug, "schedule", "board")}
        locale={locale}
        t={t}
      />

      {/* `padding="none"`: summary and body pad themselves. Closed by default
          (A32); opens on `#call`, its own refusal or a kept draft, never hiding
          an answer or a half-typed call. No notice is `undefined`, not null. */}
      <AutoOpenDetails
        openOnHash="call"
        id="call"
        open={callNotice !== undefined || callDraft !== null}
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
          key={draftBinding.scope}
          action={tookACallAction.bind(null, shopSlug)}
          className="border-t border-border p-5 sm:p-6"
        >
          <FormDraft
            form="took_a_call"
            draft={draftForForm(callDraft, locale, shop.timezone)}
            actions={draftBinding.actions}
            copy={formDraftCopy(t)}
          />
          <CallNoteSlot shopId={shop.id} shopSlug={shopSlug} t={t} />
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
            waitlistOn={shop.waitlistEnabled}
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
    </section>
  );
}
