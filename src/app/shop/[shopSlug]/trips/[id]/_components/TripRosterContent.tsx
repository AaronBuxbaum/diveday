import Link from "next/link";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/ledger";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripGuests } from "@/db/trips-guests";
import { activityLine } from "@/i18n/activity-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { cancellationDeadline } from "@/lib/deposits";
import { formatShortDate } from "@/lib/format";
import type { PaperWaiverAction } from "@/lib/paper-waiver-form";
import { type FormNotice, noticeForForm, shopPath } from "@/lib/staff-notices";
import { isFull, spotsRemaining } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { AddDiverSection } from "./AddDiverSection";
import { LastMinuteDealSection } from "./LastMinuteDealSection";
import { RosterSection } from "./RosterSection";
import { readinessOf, seatHoldersOf, TripHull } from "./TripHull";
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
  markWaiverInPersonAction: PaperWaiverAction;
  markPaymentAction: FormAction;
  removeBookingAction: FormAction;
  confirmDiverIdentityAction: FormAction;
  certifyDiverAction?: FormAction;
  saveCourseNextStepAction?: FormAction;
  addInternalNoteAction: FormAction;
  deleteInternalNoteAction: FormAction;
  saveRosterEmergencyContactAction: FormAction;
  updateBookingPickupAction: (bookingId: string, formData: FormData) => void | Promise<void>;
  recordTripInvitationAction: (invitationId: string) => Promise<"sent" | "fallback">;
  undoRemoveBookingAction: FormAction;
  restoreInternalNoteAction: FormAction;
};

/**
 * The shared Trip ledger body. The canonical Trip surface owns this body; the
 * legacy `/guests` compatibility route remains available for old deep links so
 * moving the roster does not strand existing bookmarks.
 */
export function TripRosterContent({
  guests,
  shopSlug,
  shopName,
  locale,
  timezone,
  depthUnit,
  shopRentalItems,
  tripNotice,
  pageNotice,
  noteDeleted,
  confirmName,
  confirmEmail,
  confirmPhone,
  undoBookingId,
  keepOpenBookingId,
  namesakeRefusedBookingId,
  mayDiscount,
  mayWriteOffPayment,
  hull,
  compact = false,
  actions,
}: {
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
  /** The seat whose paper release was refused for a namesake co-signer (#1573). */
  namesakeRefusedBookingId?: string;
  mayDiscount: boolean;
  mayWriteOffPayment: boolean;
  /**
   * The boat this departure sails on, for the hull above the rows. Null where
   * it has none — a shore dive and a pool session have a roster and no boat,
   * and an invented hull would be a picture of something that is not there.
   */
  hull: {
    name: string;
    color: string | null;
    /**
     * The guides assigned to this departure, already named. Two fit in the
     * wheelhouse; the rest are the crew panel's, which is where a crew reads
     * them in full.
     */
    crew: readonly string[];
  } | null;
  /** The canonical Trip surface already owns the masthead capacity read. */
  compact?: boolean;
  actions: TripRosterActions;
}) {
  const t = staffTranslator(locale);
  const {
    trip,
    cancelled,
    roster,
    requirement,
    waitlist,
    invitations,
    activity,
    confirmMatches,
    diverCandidates,
    notesByBooking,
    courseNextStepByBooking,
    paymentsConnected,
    demand,
    lastMinute,
    certificationSummaries,
    byBooking,
    diverQuery,
    tripDateIso,
    dealRequirement,
    courseTarget,
  } = guests;
  const {
    rentalFit: rentalFitByBooking,
    nitrox: nitroxByBooking,
    readiness: readinessByBooking,
    waiver: waiverByBooking,
  } = byBooking;
  // The value is supplied by the page after the session gate. Keeping the role
  // check at the page boundary prevents a client-rendered roster from ever
  // deciding whether money controls should exist.
  const showPromote = lastMinute.showPromote && mayDiscount;

  /**
   * **The hull's sentence counts the rows the hull draws.**
   *
   * It used to take `trip.booked` while the seats were drawn from every
   * non-cancelled booking — two different sets, so a departure with one no-show
   * showed six filled seats over the words "5 of 6 seats taken" (dive-domain
   * review 20260919). Both read `seatHoldersOf` now.
   *
   * The blocked count is the one fact the picture carries that the masthead
   * does not, which is why the sentence names it: for a reader who cannot see
   * the boat, "two who cannot board" *is* the picture.
   */
  const hullSeatHolders = hull ? seatHoldersOf(roster) : [];
  /*
   * **Counted off the same three-way answer the seats are drawn from**
   * (`readinessOf`, ADR 20260919-one-idea §3b.5) rather than off
   * `rosterRowIsBlocked` directly. Asked through the fail-open predicate, a
   * booking nobody had read counted as neither blocked nor doubtful, so the
   * sentence said "6 of 6 seats taken" flat — and a reader who cannot see the
   * boat was told nothing at all about the one diver nobody had looked at.
   * Design principle 6: colour never carries a state alone, and a dash pattern
   * is colour's quieter cousin.
   */
  const hullReadiness = hullSeatHolders.map((entry) =>
    readinessOf(readinessByBooking, entry.booking.id),
  );
  const hullSeatCounts = {
    booked: hullSeatHolders.length,
    blocked: hullReadiness.filter((readiness) => readiness === "blocked").length,
    unread: hullReadiness.filter((readiness) => readiness === "unread").length,
  };

  return (
    <div data-trip-guests-ready className="contents">
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
        <section className="mt-6 rounded-inset border border-warning/40 bg-warning-tint p-5">
          <p className={groupLabelClass("warning")}>{t("trips.guests.demandSignal")}</p>
          <h2 className={`mt-1 ${SECTION_TITLE_CLASS}`}>{t("trips.guests.demandHeading")}</h2>
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
        </section>
      ) : null}

      {/* **The departure drawn as its boat** (ADR 20260919-one-idea, decision
          I · Tide, slice 23c). Above the rows rather than instead of them: a
          crew sees the shape of the morning — how full, how many cannot board,
          how much room is left — and then reads every one of those facts in
          words underneath. Take the picture away and the page says exactly
          what it said before.

          Only where the departure has a boat. A shore dive and a pool session
          have a roster and no hull, and an invented one would be a picture of
          something that is not there.

          **And only where it is sailing.** A blow-out cancels the departure and
          leaves every booking active (the glossary's *Blow-out*), so a
          cancelled trip's seats are all still held and the hull drew a full,
          happy boat at the top of a page whose words said the day was off — and
          the picture is read first. There is no honest hull for a departure
          that is not going, so there is none (dive-domain review 20260919). */}
      {hull && !cancelled ? (
        <div className="mt-6">
          <TripHull
            roster={roster}
            readinessByBooking={readinessByBooking}
            capacity={trip.capacity}
            color={hull.color}
            crew={hull.crew}
            label={t("trips.hullLabel", {
              boat: hull.name,
              booked: hullSeatCounts.booked,
              capacity: trip.capacity,
              blocked: hullSeatCounts.blocked,
              unread: hullSeatCounts.unread,
            })}
          />
        </div>
      ) : null}

      <RosterSection
        locale={locale}
        shopSlug={shopSlug}
        shopTimezone={timezone}
        tripId={trip.id}
        booked={trip.booked}
        capacity={trip.capacity}
        roster={roster}
        readinessByBooking={readinessByBooking}
        waiverByBooking={waiverByBooking}
        rentalFitByBooking={rentalFitByBooking}
        shopRentalItems={shopRentalItems}
        nitroxByBooking={nitroxByBooking}
        requiresPayment={Boolean(requirement?.requiresPayment)}
        paymentsConnected={paymentsConnected}
        cancellationDeadline={cancellationDeadline(trip)}
        markWaiverInPersonAction={actions.markWaiverInPersonAction}
        markPaymentAction={actions.markPaymentAction}
        mayWriteOffPayment={mayWriteOffPayment}
        removeBookingAction={actions.removeBookingAction}
        confirmIdentityAction={actions.confirmDiverIdentityAction}
        certifyDiverAction={actions.certifyDiverAction}
        saveCourseNextStepAction={actions.saveCourseNextStepAction}
        courseNextStepByBooking={courseNextStepByBooking}
        notesByBooking={notesByBooking}
        addNoteAction={actions.addInternalNoteAction}
        deleteNoteAction={actions.deleteInternalNoteAction}
        saveEmergencyContactAction={actions.saveRosterEmergencyContactAction}
        updatePickupAction={actions.updateBookingPickupAction}
        keepOpenBookingId={keepOpenBookingId}
        namesakeRefusedBookingId={namesakeRefusedBookingId}
        depthUnit={depthUnit}
        tripDate={tripDateIso}
        waitingGroup={
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
            />
          ) : null
        }
        invitedGroup={
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
            />
          ) : null
        }
        addDiverGroup={
          cancelled ? null : (
            <AddDiverSection
              shopSlug={shopSlug}
              full={isFull(trip)}
              query={diverQuery}
              candidates={diverCandidates}
              tripId={trip.id}
              addBookingAction={actions.addBookingAction}
              addToWaitlistAction={actions.addToWaitlistAction}
              addExistingDiverAction={actions.addExistingDiverAction}
              inviteAction={actions.createDirectTripInvitationAction}
              status={noticeForForm(tripNotice, "add-diver")}
              locale={locale}
              timeZone={timezone}
              confirmName={confirmName}
              confirmEmail={confirmEmail}
              confirmPhone={confirmPhone}
              confirmMatches={confirmMatches}
              shopRentalItems={shopRentalItems}
            />
          )
        }
        compact={compact}
        showSummaryHeading={!compact}
      />

      <div className="mt-8">
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
                <DisclosureCaret
                  direction="down"
                  className="size-4 group-open/promote:rotate-180"
                />
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
                openSeats={spotsRemaining({ capacity: trip.capacity, booked: trip.booked })}
                cancelled={cancelled}
                promos={lastMinute.promos}
                promoRecipients={lastMinute.promoRecipients}
                timezone={timezone}
                status={noticeForForm(tripNotice, "last-minute-deal")}
                tripId={trip.id}
              />
            </div>
          </AutoOpenDetails>
        ) : null}

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
      </div>
    </div>
  );
}
