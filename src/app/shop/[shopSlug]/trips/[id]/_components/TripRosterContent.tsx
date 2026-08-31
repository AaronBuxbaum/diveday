import Link from "next/link";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/ledger";
import type { TripGuests } from "@/db/trips-guests";
import { staffTranslator } from "@/i18n/staff-messages";
import { cancellationDeadline } from "@/lib/deposits";
import { formatShortDate } from "@/lib/format";
import { type FormNotice, noticeForForm, shopPath } from "@/lib/staff-notices";
import { isFull, spotsRemaining } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { AddDiverSection } from "./AddDiverSection";
import { LastMinuteDealSection } from "./LastMinuteDealSection";
import { RosterSection } from "./RosterSection";
import { TripInvitationGroup } from "./TripInvitationSection";
import { TripNoticeBanner } from "./TripNoticeBanner";
import { WaitlistGroup } from "./WaitlistSection";

type FormAction = (formData: FormData) => void | Promise<void>;

export type TripRosterActions = {
  addBookingAction: FormAction;
  addExistingDiverAction: FormAction;
  addToWaitlistAction: FormAction;
  createDirectTripInvitationAction: FormAction;
  markWaiverInPersonAction: FormAction;
  markPaymentAction: FormAction;
  removeBookingAction: FormAction;
  confirmDiverIdentityAction: FormAction;
  certifyDiverAction?: FormAction;
  addInternalNoteAction: FormAction;
  deleteInternalNoteAction: FormAction;
  saveRosterEmergencyContactAction: FormAction;
  updateBookingPickupAction: (bookingId: string, formData: FormData) => void | Promise<void>;
  inviteWaitlistAction: (entryId: string) => Promise<"sent" | "fallback">;
  recordTripInvitationAction: (invitationId: string) => Promise<"sent" | "fallback">;
  sendLastMinuteDealAction: FormAction;
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
  tripNotice,
  pageNotice,
  noteDeleted,
  confirmName,
  confirmEmail,
  confirmPhone,
  undoBookingId,
  keepOpenBookingId,
  mayDiscount,
  mayWriteOffPayment,
  compact = false,
  actions,
}: {
  guests: TripGuests;
  shopSlug: string;
  shopName: string;
  locale: string;
  timezone: string;
  depthUnit: "feet" | "meters";
  tripNotice?: FormNotice;
  pageNotice?: FormNotice;
  noteDeleted?: { bookingId: string; body: string };
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  undoBookingId?: string;
  keepOpenBookingId?: string;
  mayDiscount: boolean;
  mayWriteOffPayment: boolean;
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
        <section className="mt-6 rounded-xl border border-warning/40 bg-warning-tint p-5">
          <p className={groupLabelClass("warning")}>{t("trips.guests.demandSignal")}</p>
          <h2 className="mt-1 text-lg font-semibold">{t("trips.guests.demandHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{demand.message}</p>
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
        notesByBooking={notesByBooking}
        addNoteAction={actions.addInternalNoteAction}
        deleteNoteAction={actions.deleteInternalNoteAction}
        saveEmergencyContactAction={actions.saveRosterEmergencyContactAction}
        updatePickupAction={actions.updateBookingPickupAction}
        keepOpenBookingId={keepOpenBookingId}
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
              inviteAction={actions.inviteWaitlistAction}
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
        compact={compact}
        showSummaryHeading={!compact}
      />

      {cancelled ? null : (
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
          confirmName={confirmName}
          confirmEmail={confirmEmail}
          confirmPhone={confirmPhone}
          confirmMatches={confirmMatches}
        />
      )}

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
                sendAction={actions.sendLastMinuteDealAction}
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
              events={activity}
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
