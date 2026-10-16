import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { ScrollToHash } from "@/components/ScrollToHash";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { groupLabelClass } from "@/components/ui/group-label";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripGuests } from "@/db/trips";
import { activityLine } from "@/i18n/activity-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { cancellationDeadline } from "@/lib/deposits";
import { formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import type { PaperWaiverAction } from "@/lib/paper-waiver-form";
import type { MarkRetry } from "@/lib/payment-marks";
import { type FormNotice, noticeForForm, shopPath } from "@/lib/staff-notices";
import { isFull, seatsOnSale, spotsRemaining } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { recordPaperCourseFormAction } from "../course-actions";
import { AddDiverSection } from "./AddDiverSection";
import { DepartureNoteSection } from "./DepartureNoteSection";
import { LastMinuteDealSection } from "./LastMinuteDealSection";
import { type RosterArrival, RosterSection } from "./RosterSection";
import type { PartyPreview, RosterActions, RosterRecord, SeatMove } from "./roster-model";
import { TripInvitationGroup } from "./TripInvitationSection";
import { TripNoticeBanner } from "./TripNoticeBanner";
import { WaitlistGroup } from "./WaitlistSection";

type FormAction = (formData: FormData) => void | Promise<void>;

export type TripRosterActions = {
  addBookingAction: FormAction;
  addExistingDiverAction: FormAction;
  addToWaitlistAction: FormAction;
  createDirectTripInvitationAction: FormAction;
  /** A reducer, not a plain `FormAction`: a refused paper release answers in
   * the form with the typed values rather than redirecting (issue #1674). */
  markRosterWaiverInPersonAction: PaperWaiverAction;
  markPaymentAction: FormAction;
  previewPartyPaymentAction: FormAction;
  markPartyPaidAction: FormAction;
  removeBookingAction: FormAction;
  moveSeat?: SeatMove;
  /** The demand banner's "Carry the wait list" (third UX review, item 12). */
  carryWaitlistAction?: FormAction;
  setParticipantTypeAction: FormAction;
  confirmDiverIdentityAction: FormAction;
  splitDiverIdentityAction: FormAction;
  /** Drawn only for an owner or manager (`canRetireMedicalRefusal`). */
  sendNewWaiverAction?: FormAction;
  certifyDiverAction?: FormAction;
  saveCourseNextStepAction?: FormAction;
  setCourseMaterialsDoneAction?: FormAction;
  elearningCheckAction?: RosterActions["elearningCheckAction"];
  agencyCheckAction?: RosterActions["agencyCheckAction"];
  agencyListedAction?: RosterActions["agencyListedAction"];
  addInternalNoteAction: FormAction;
  deleteInternalNoteAction: FormAction;
  saveRosterEmergencyContactAction: FormAction;
  updateBookingPickupAction: (bookingId: string, formData: FormData) => void | Promise<void>;
  recordTripInvitationAction: (invitationId: string) => Promise<"sent" | "fallback">;
  undoRemoveBookingAction: FormAction;
  restoreInternalNoteAction: FormAction;
};

/** Everything `TripRosterContent` draws, assembled once by its caller and handed over as one object. */
export type TripRosterContentContext = {
  guests: TripGuests;
  shopSlug: string;
  shopName: string;
  locale: string;
  timezone: string;
  depthUnit: "feet" | "meters";
  /** The shop's rental catalog, read by the ledger's fit line (`RosterSection`). */
  shopRentalItems?: readonly string[];
  tripNotice?: FormNotice;
  pageNotice?: FormNotice;
  noteDeleted?: { bookingId: string; body: string };
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  undoBookingId?: string;
  keepOpenBookingId?: string;
  /** A refused Paid mark, to reopen the sheet holding what was typed (issue #2607). */
  paymentMarkRetry?: { bookingId: string } & MarkRetry;
  /** A party payment waiting on its confirm (issue #2605). */
  partyPreview?: PartyPreview;
  /** The seat whose paper release was refused for a namesake co-signer (#1573). */
  namesakeRefusedBookingId?: string;
  /** The seat whose change into diving the card check just refused. */
  participantTypeCertBookingId?: string;
  mayWriteOffPayment: boolean;
  /** Whether this staffer may raise an invoice — see `RosterSection`. */
  canManageOrders: boolean;
  /** The canonical Trip surface already owns the masthead capacity read. */
  compact?: boolean;
  /**
   * What reads as the roster's consequence rather than its footnote — on the
   * departure page, the packing list derived from these very seats.
   */
  afterRoster?: ReactNode;
  /** The desk's taps and groups, once arrivals open — see `RosterSection`. */
  arrival?: RosterArrival;
  /** The departure is finished: the ledger is its record (`RosterRecord`). */
  record?: RosterRecord;
  /**
   * The counter can still seat a walk-in: the add-diver search's one door for
   * someone new is then "Add as a walk-in", a name-only seat for the person
   * standing at the desk (UX audit 2026-10-07, item 24).
   */
  walkInOpen?: boolean;
  /**
   * `acceptsNewDivers`, read by the page against its clock: false on a
   * departure that has sailed, is held or is cancelled, and then no add or
   * invite control is drawn at all (owner, 2026-10-06).
   */
  acceptsDivers: boolean;
  actions: TripRosterActions;
};

/**
 * The Trip ledger body, which the departure's Divers tab renders.
 */
export function TripRosterContent({ context }: { context: TripRosterContentContext }) {
  const {
    guests,
    shopSlug,
    shopName,
    locale,
    timezone,
    // Kept on the interface for the page's own plumbing; the ledger's depth
    // sentences carry their own unit (`depthWarningText`).
    depthUnit: _depthUnit,
    shopRentalItems,
    tripNotice,
    pageNotice,
    noteDeleted,
    confirmName,
    confirmEmail,
    confirmPhone,
    undoBookingId,
    keepOpenBookingId,
    paymentMarkRetry,
    partyPreview,
    namesakeRefusedBookingId,
    participantTypeCertBookingId,
    mayWriteOffPayment,
    canManageOrders,
    compact = false,
    afterRoster = null,
    arrival,
    record,
    walkInOpen = false,
    acceptsDivers,
    actions,
  } = context;
  const t = staffTranslator(locale);
  const {
    trip,
    roster,
    requirement,
    waitlist,
    invitations,
    confirmMatches,
    diverCandidates,
    notesByBooking,
    courseNextStepByBooking,
    paymentsConnected,
    demand,
    certificationSummaries,
    byBooking,
    diverQuery,
    tripDateIso,
    dealRequirement,
  } = guests;
  const {
    rentalFit: rentalFitByBooking,
    nitrox: nitroxByBooking,
    readiness: readinessByBooking,
    waiver: waiverByBooking,
  } = byBooking;

  return (
    // `contents`, so these blocks lie in the page's flow; `space-y-10` is the
    // page's stack carried through it, since the page's own reaches only its
    // direct children, and this box is one (K-262).
    <div data-trip-guests-ready className="contents space-y-10">
      {noteDeleted ? (
        <UndoToast
          message={t("trips.roster.noteDeletedToast")}
          action={actions.restoreInternalNoteAction}
          fields={noteDeleted}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : (
        <TripNoticeBanner
          notice={pageNotice}
          locale={locale}
          undoBookingId={undoBookingId}
          undoAction={actions.undoRemoveBookingAction}
        />
      )}

      {demand ? (
        // A card in a tone (`TONE_PANEL_CLASS`), not a 12px inset box: its
        // corners were tighter than every card's, its words 4px further in.
        <section className={`${TONE_PANEL_CLASS} border-warning/40 bg-warning-tint`}>
          <p className={groupLabelClass("warning")}>{t("trips.guests.demandSignal")}</p>
          {/* Balanced: at 390 it ended on "capacity" alone (K-504). */}
          <h2 className={`mt-1 text-balance ${SECTION_TITLE_CLASS}`}>
            {t("trips.guests.demandHeading")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {t("trips.guests.demandBody", { count: demand.unmetSeats })}
          </p>
          <Link
            href={`${shopPath(shopSlug, "schedule", "board")}?add=1&date=${toDateInputValue(
              utcToWallTime(trip.startsAt, timezone),
            )}`}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
          >
            {t("trips.guests.scheduleAnotherDeparture")}
          </Link>
          {actions.carryWaitlistAction && actions.moveSeat?.targets.length ? (
            <CarryWaitlistForm
              action={actions.carryWaitlistAction}
              targets={actions.moveSeat.targets}
              t={t}
            />
          ) : null}
        </section>
      ) : null}

      <RosterSection
        trip={{
          shopSlug,
          rehearsal: trip.isRehearsal,
          shopTimezone: timezone,
          locale,
          tripId: trip.id,
          booked: trip.booked,
          capacity: trip.sellableCapacity,
          tripDate: tripDateIso,
          requiresPayment: Boolean(requirement?.requiresPayment),
          paymentsConnected,
          cancellationDeadline: cancellationDeadline(trip),
          mayWriteOffPayment,
          canManageOrders,
          shopRentalItems,
          splitAsksDateOfBirth: guests.splitAsksDateOfBirth,
          certifyDefaultLevel: guests.certifyDefaultLevel,
          courseHasMaterials: guests.courseHasMaterials,
          courseMaterialsOpen: guests.courseMaterialsOpen,
          compact,
          showSummaryHeading: !compact,
        }}
        rows={{
          roster,
          readinessByBooking,
          waiverByBooking,
          rentalFitByBooking,
          nitroxByBooking,
          notesByBooking,
          courseNextStepByBooking,
          elearningQueryByBooking: guests.elearningQueryByBooking,
          elearningChecksOff: guests.elearningChecksOff,
          agencyCheckCardsByPerson: guests.agencyCheckCardsByPerson,
          courseMaterialsDoneByPerson: guests.courseMaterialsDoneByPerson,
          sameNameHeldSeats: guests.sameNameHeldSeats,
          heldSeatLastDiveDay: guests.heldSeatLastDiveDay,
          packageDivesByBooking: guests.packageDivesByBooking,
          paymentMarksByBooking: guests.paymentMarksByBooking,
          keepOpenBookingId,
          paymentMarkRetry,
          partyPreview,
          namesakeRefusedBookingId,
          participantTypeCertBookingId,
        }}
        actions={{
          markRosterWaiverInPersonAction: actions.markRosterWaiverInPersonAction,
          markPaymentAction: actions.markPaymentAction,
          previewPartyPaymentAction: actions.previewPartyPaymentAction,
          markPartyPaidAction: actions.markPartyPaidAction,
          removeBookingAction: actions.removeBookingAction,
          moveSeat: actions.moveSeat,
          setParticipantTypeAction: actions.setParticipantTypeAction,
          confirmIdentityAction: actions.confirmDiverIdentityAction,
          splitIdentityAction: actions.splitDiverIdentityAction,
          sendNewWaiverAction: actions.sendNewWaiverAction,
          addNoteAction: actions.addInternalNoteAction,
          deleteNoteAction: actions.deleteInternalNoteAction,
          saveEmergencyContactAction: actions.saveRosterEmergencyContactAction,
          certifyDiverAction: guests.certifies ? actions.certifyDiverAction : undefined,
          saveCourseNextStepAction: actions.saveCourseNextStepAction,
          setCourseMaterialsDoneAction: guests.courseHasMaterials
            ? actions.setCourseMaterialsDoneAction
            : undefined,
          elearningCheckAction: guests.courseHasMaterials
            ? actions.elearningCheckAction
            : undefined,
          // A finished departure is its record: nothing on it is checked.
          agencyCheckAction: record ? undefined : actions.agencyCheckAction,
          agencyListedAction: record ? undefined : actions.agencyListedAction,
          // A course form signed on paper (ADR 20261008-course-forms). Bound
          // here rather than on the page: only a seat that owes a form draws it.
          recordPaperCourseFormAction: recordPaperCourseFormAction.bind(null, shopSlug, trip.id),
          updatePickupAction: actions.updateBookingPickupAction,
        }}
        slots={{
          arrival,
          record,
          waitingGroup:
            waitlist.length > 0 ? (
              <WaitlistGroup
                waitlist={waitlist}
                shopSlug={shopSlug}
                tripId={trip.id}
                shopName={shopName}
                tripTitle={trip.title}
                tripWhen={formatShortDate(trip.startsAt, locale, timezone)}
                certificationSummaries={certificationSummaries}
                departureRequirement={dealRequirement}
                locale={locale}
                timezone={timezone}
                canInvite={acceptsDivers}
              />
            ) : null,
          invitedGroup:
            invitations.length > 0 ? (
              <TripInvitationGroup
                invitations={invitations}
                shopSlug={shopSlug}
                tripId={trip.id}
                shopName={shopName}
                tripTitle={trip.title}
                tripStartsAt={trip.startsAt}
                timezone={timezone}
                inviteAction={actions.recordTripInvitationAction}
                locale={locale}
                canInvite={acceptsDivers}
              />
            ) : null,
          addDiverGroup: !acceptsDivers ? null : (
            <AddDiverSection
              context={{
                shopSlug,
                full: isFull(seatsOnSale(trip)),
                query: diverQuery,
                candidates: diverCandidates,
                tripId: trip.id,
                addBookingAction: actions.addBookingAction,
                addToWaitlistAction: actions.addToWaitlistAction,
                addExistingDiverAction: actions.addExistingDiverAction,
                inviteAction: actions.createDirectTripInvitationAction,
                status: noticeForForm(tripNotice, "add-diver"),
                locale,
                timeZone: timezone,
                confirmName,
                confirmEmail,
                confirmPhone,
                confirmMatches,
                shopRentalItems,
                walkInOpen,
              }}
            />
          ),
        }}
      />

      {afterRoster}
    </div>
  );
}

/**
 * **Promote and Activity, on Details** (owner, 2026-10-05). Both used to close
 * the Divers tab, under the roster. Neither is about the people coming: one
 * sells the departure's empty seats to people who are not on it, the other is
 * the departure's audit trail. Details is the tab about the departure itself,
 * beside its booking link and its public page. "More for this departure" sits
 * between them, the same kind of row (owner, 2026-10-06).
 */
export function TripPromoteAndActivity({
  guests,
  shopSlug,
  locale,
  shop,
  tripNotice,
  mayDiscount,
  more,
}: {
  guests: TripGuests;
  shopSlug: string;
  locale: string;
  /** Its zone for every time here; its currency for a fixed-amount last-minute deal. */
  shop: { id: string; timezone: string; currency: string | null };
  tripNotice?: FormNotice;
  mayDiscount: boolean;
  /** "More for this departure" (`TripMoreDisclosure`), between the two. */
  more?: ReactNode;
}) {
  const t = staffTranslator(locale);
  const timezone = shop.timezone;
  const currency = toShopCurrency(shop.currency);
  const {
    trip,
    cancelled,
    waitlist,
    activity,
    lastMinute,
    certificationSummaries,
    dealRequirement,
    courseTarget,
  } = guests;
  // The value is supplied by the page after the session gate. Keeping the role
  // check at the page boundary prevents a client-rendered roster from ever
  // deciding whether money controls should exist.
  const showPromote = lastMinute.showPromote && mayDiscount;
  return (
    // A shop's taps and its audit trail, not the departure a staffer prints.
    <div className="print:hidden">
      {showPromote ? (
        <AutoOpenDetails
          openOnHash="last-minute-deal"
          className="group/promote scroll-mt-6 border-t border-border"
        >
          <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 text-sm font-medium text-muted transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken hover:text-foreground">
            <span>{t("trips.guests.promoteHeading")}</span>
            <span className="flex items-center gap-2">
              {lastMinute.promos.length > 0
                ? t("trips.guests.promoteSentCount", { count: lastMinute.promos.length })
                : null}
              <DisclosureCaret direction="down" className="size-4 group-open/promote:rotate-180" />
            </span>
          </summary>
          <div className="pb-5">
            <LastMinuteDealSection
              shopSlug={shopSlug}
              locale={locale}
              recipients={lastMinute.recipients.map(({ person }) => ({
                personId: person.id,
                fullName: person.fullName,
                certification: certificationSummaries.get(person.id) ?? null,
              }))}
              requirement={dealRequirement}
              course={courseTarget}
              openSeats={spotsRemaining(seatsOnSale(trip))}
              hasWaitlist={waitlist.length > 0}
              cancelled={cancelled}
              promos={lastMinute.promos}
              promoRecipients={lastMinute.promoRecipients}
              timezone={timezone}
              currency={currency}
              status={noticeForForm(tripNotice, "last-minute-deal")}
              tripId={trip.id}
            />
          </div>
        </AutoOpenDetails>
      ) : null}

      <DepartureNoteSection locale={locale} shop={shop} trip={trip} />

      {more}

      <details className="group/activity border-y border-border">
        <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 text-sm font-medium text-muted transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken hover:text-foreground">
          <span>{t("trips.guests.activityHeading")}</span>
          <DisclosureCaret direction="down" className="size-4 group-open/activity:rotate-180" />
        </summary>
        <div className="pb-5">
          <ActivityLog
            events={activity.map((event) => ({
              id: event.id,
              message: activityLine(t, event),
              occurredAt: event.occurredAt,
            }))}
            locale={locale}
            timeZone={timezone}
            emptyText={t("trips.guests.noActivity")}
          />
        </div>
      </details>
      {/* Today, Promotions and a held send link here at `#last-minute-deal`;
          the roster's own ScrollToHash is not on this tab. */}
      <ScrollToHash />
    </div>
  );
}

/**
 * The demand banner's second door: hand the waiting leads to a departure that
 * is already on the board, including the one just added from "Schedule another
 * departure". The same departures a seat may move to (`seatMoveFor`).
 */
function CarryWaitlistForm({
  action,
  targets,
  t,
}: {
  action: FormAction;
  targets: SeatMove["targets"];
  t: StaffTranslator;
}) {
  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      <FieldGrid columns={1}>
        <Field label={t("trips.guests.carryWaitlistTo")} htmlFor="carry-waitlist-to">
          <select id="carry-waitlist-to" name="toTripId" required className={controlClass}>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      <div>
        <SubmitButton
          pendingLabel={t("trips.guests.carryWaitlistPending")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("trips.guests.carryWaitlist")}
        </SubmitButton>
      </div>
    </form>
  );
}
