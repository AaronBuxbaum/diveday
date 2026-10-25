import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { ActivityLog } from "@/components/ActivityLog";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { ScrollToHash } from "@/components/ScrollToHash";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { DisclosureRowList } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { groupLabelClass } from "@/components/ui/group-label";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripGuests } from "@/db/trips";
import { activityLine } from "@/i18n/activity-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { cancellationDeadline } from "@/lib/deposits";
import { formatShortDate } from "@/lib/format";
import { currencySymbol, toShopCurrency } from "@/lib/money";
import type { PaperWaiverAction } from "@/lib/paper-waiver-form";
import type { MarkRetry } from "@/lib/payment-marks";
import { type FormNotice, noticeForForm, shopPath } from "@/lib/staff-notices";
import { isFull, seatsOnSale, spotsRemaining } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { recordPaperCourseFormAction } from "../course-actions";
import { AddDiverSection } from "./AddDiverSection";
import { carryTargetLabel } from "./carry-target-label";
import { DealLeadTime } from "./DealLeadTime";
import { DepartureNoteSection } from "./DepartureNoteSection";
import { InviteSuggestionsGroup } from "./InviteSuggestionsGroup";
import { LastMinuteDealSection } from "./LastMinuteDealSection";
import { type RosterArrival, RosterSection } from "./RosterSection";
import type { PartyPreview, RosterActions, RosterRecord, SeatMove } from "./roster-model";
import { FOOT_ROW_BODY, FOOT_ROW_SUMMARY } from "./TripAboutSection";
import { TripNoticeBanner } from "./TripNoticeBanner";
import { WhoWantsInPanel } from "./WhoWantsInPanel";
import { whoWantsInGroupsOf } from "./who-wants-in-rows";

type FormAction = (formData: FormData) => void | Promise<void>;

export type TripRosterActions = {
  addBookingAction: FormAction;
  addExistingDiverAction: FormAction;
  walkInAddBookingAction: FormAction;
  walkInAddExistingDiverAction: FormAction;
  addToWaitlistAction: FormAction;
  addKnownToWaitlistAction: FormAction;
  createDirectTripInvitationAction: FormAction;
  invitePastDiverAction: FormAction;
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
  repointDiverIdentityAction: FormAction;
  /** Drawn only for an owner or manager (`canRetireMedicalRefusal`). */
  sendNewWaiverAction?: FormAction;
  certifyDiverAction?: FormAction;
  saveCourseNextStepAction?: FormAction;
  markCardProcessedAction?: FormAction;
  setCourseMaterialsDoneAction?: FormAction;
  elearningCheckAction?: RosterActions["elearningCheckAction"];
  agencyCheckAction?: RosterActions["agencyCheckAction"];
  agencyListedAction?: RosterActions["agencyListedAction"];
  addInternalNoteAction: FormAction;
  deleteInternalNoteAction: FormAction;
  saveRosterEmergencyContactAction: FormAction;
  updateBookingPickupAction: (bookingId: string, formData: FormData) => void | Promise<void>;
  updateBookingDietaryNoteAction: (bookingId: string, formData: FormData) => void | Promise<void>;
  undoRemoveBookingAction: FormAction;
  restoreInternalNoteAction: FormAction;
  /** Absent on a course session, and for a staffer who may not configure trips. */
  markTrainingDiveAction?: FormAction;
  clearTrainingDiveAction?: FormAction;
};

/** Everything `TripRosterContent` draws, assembled once by its caller and handed over as one object. */
export type TripRosterContentContext = {
  guests: TripGuests;
  /** A guide in the water is rostered (`overview.crew.inWaterCrew`): the decompression reminder covers them too. */
  inWaterCrew?: { instructorCount: number; assistantCount: number };
  shopSlug: string;
  shopName: string;
  locale: string;
  timezone: string;
  /** The shop's rental catalog, read by the ledger's fit line (`RosterSection`). */
  shopRentalItems?: readonly string[];
  /** The shop offers hotel pickups (the Features page): only then may a seat set one. */
  offersHotelPickup: boolean;
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
  /** The live roles may send a wait-list invite (`seat_wanted`'s audience), as the action will. */
  mayInviteFromWaitlist: boolean;
  /** The role may discount (`canPersonManagePaymentSettings`): "with a discount" on the Offer. */
  mayDiscount: boolean;
  /** The shop's currency, for a fixed-amount discount. */
  currency: string | null;
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
    shopRentalItems,
    offersHotelPickup,
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
    afterRoster = null,
    arrival,
    record,
    inWaterCrew,
    walkInOpen = false,
    acceptsDivers,
    mayInviteFromWaitlist,
    mayDiscount,
    currency,
    actions,
  } = context;
  const t = staffTranslator(locale);
  const {
    trip,
    roster,
    requirement,
    confirmMatches,
    diverCandidates,
    notesByBooking,
    courseNextStepByBooking,
    paymentsConnected,
    demand,
    byBooking,
    diverQuery,
    tripDateIso,
  } = guests;
  const {
    rentalFit: rentalFitByBooking,
    nitrox: nitroxByBooking,
    readiness: readinessByBooking,
    waiver: waiverByBooking,
  } = byBooking;

  const whoWantsInGroups = whoWantsInGroupsOf({ guests, t, locale, timezone });

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
          dismissLabel={t("shared.undoToast.dismiss")}
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
          {actions.carryWaitlistAction &&
          actions.moveSeat?.targets.length &&
          !actions.moveSeat.departed ? (
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
          exceedsNoDecoLimits: trip.exceedsNoDecoLimits,
          divingCrew: Boolean(
            inWaterCrew && inWaterCrew.instructorCount + inWaterCrew.assistantCount > 0,
          ),
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
          issuedCardByPerson: guests.issuedCardByPerson,
          courseMaterialsDoneByPerson: guests.courseMaterialsDoneByPerson,
          sameNameHeldSeats: guests.sameNameHeldSeats,
          aboardAtSea: guests.aboardAtSea,
          sameNamePeople: guests.sameNamePeople,
          dependentCharters: guests.dependentCharters,
          trainingMarks: guests.trainingMarks,
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
          repointIdentityAction: actions.repointDiverIdentityAction,
          sendNewWaiverAction: actions.sendNewWaiverAction,
          addNoteAction: actions.addInternalNoteAction,
          deleteNoteAction: actions.deleteInternalNoteAction,
          saveEmergencyContactAction: actions.saveRosterEmergencyContactAction,
          certifyDiverAction: guests.certifies ? actions.certifyDiverAction : undefined,
          saveCourseNextStepAction: actions.saveCourseNextStepAction,
          markCardProcessedAction: actions.markCardProcessedAction,
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
          // A training dive on a charter (issue #2275). Never on a finished
          // departure: its ledger is the record.
          markTrainingDiveAction: record ? undefined : actions.markTrainingDiveAction,
          clearTrainingDiveAction: record ? undefined : actions.clearTrainingDiveAction,
          updatePickupAction: offersHotelPickup ? actions.updateBookingPickupAction : undefined,
          // Only a departure that serves lunch aboard asks for a lunch note.
          updateDietaryNoteAction: trip.lunchAboard
            ? actions.updateBookingDietaryNoteAction
            : undefined,
        }}
        slots={{
          arrival,
          record,
          // A cancelled departure has no seat to offer anyone.
          whoWantsInGroup: guests.cancelled ? null : (
            <WhoWantsInPanel
              groups={whoWantsInGroups}
              tripId={trip.id}
              shopSlug={shopSlug}
              shopName={shopName}
              tripTitle={trip.title}
              tripWhen={formatShortDate(trip.startsAt, locale, timezone)}
              seatsOpen={spotsRemaining(seatsOnSale(trip))}
              canOffer={acceptsDivers && mayInviteFromWaitlist}
              discount={
                mayDiscount
                  ? {
                      toggle: t("trips.whoWantsIn.addDiscount"),
                      hint: t("trips.whoWantsIn.discountHint"),
                      amountAriaLabel: t("trips.lastMinute.discountPercentAriaLabel"),
                      kindAriaLabel: t("trips.lastMinute.discountKindAriaLabel"),
                      currencySymbol: currencySymbol(toShopCurrency(currency), locale),
                    }
                  : null
              }
              locale={locale}
              // **One waiting diver is worth carrying too** (fourth review,
              // item 31). The demand banner, and the carry door inside it,
              // wait for a cluster; a full boat with one interest offered staff
              // only an offer of a boat with no seat. Under the list it is
              // about, whenever the banner is not standing.
              carry={
                !demand &&
                isFull(seatsOnSale(trip)) &&
                actions.carryWaitlistAction &&
                actions.moveSeat?.targets.length ? (
                  <CarryWaitlistForm
                    action={actions.carryWaitlistAction}
                    targets={actions.moveSeat.targets}
                    t={t}
                  />
                ) : null
              }
            />
          ),
          suggestionsGroup:
            acceptsDivers && guests.inviteSuggestions ? (
              <InviteSuggestionsGroup
                suggestions={guests.inviteSuggestions}
                action={actions.invitePastDiverAction}
                locale={locale}
                timeZone={timezone}
              />
            ) : null,
          addDiverGroup: !acceptsDivers ? null : (
            <AddDiverSection
              context={{
                shopSlug,
                full: isFull(seatsOnSale(trip)),
                waitlistOn: guests.waitlistOn,
                query: diverQuery,
                candidates: diverCandidates,
                tripId: trip.id,
                addBookingAction: walkInOpen
                  ? actions.walkInAddBookingAction
                  : actions.addBookingAction,
                addToWaitlistAction: actions.addToWaitlistAction,
                addKnownToWaitlistAction: actions.addKnownToWaitlistAction,
                addExistingDiverAction: walkInOpen
                  ? actions.walkInAddExistingDiverAction
                  : actions.addExistingDiverAction,
                offerAction: actions.createDirectTripInvitationAction,
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
  const { trip, cancelled, activity, lastMinute } = guests;
  // The value is supplied by the page after the session gate. Keeping the role
  // check at the page boundary prevents a client-rendered roster from ever
  // deciding whether money controls should exist.
  // Deals sent stay as history; the sender is the Divers tab's panel.
  const showPromote = lastMinute.promos.length > 0 && mayDiscount;
  const canOffer = !cancelled && spotsRemaining(seatsOnSale(trip)) > 0;
  return (
    // A shop's taps and its audit trail, not the departure a staffer prints.
    <div className="print:hidden">
      <DisclosureRowList>
        {showPromote ? (
          <AutoOpenDetails openOnHash="last-minute-deal" className="group/promote scroll-mt-6">
            <summary className={FOOT_ROW_SUMMARY}>
              <span>{t("trips.guests.promoteHeading")}</span>
              <span className="flex items-center gap-2">
                {t("trips.guests.promoteSentCount", { count: lastMinute.promos.length })}
                <DisclosureCaret
                  direction="down"
                  className="size-4 group-open/promote:rotate-180"
                />
              </span>
            </summary>
            <div className={FOOT_ROW_BODY}>
              <LastMinuteDealSection
                locale={locale}
                tripPath={canOffer ? shopPath(shopSlug, "trips", trip.id) : null}
                promos={lastMinute.promos}
                promoRecipients={lastMinute.promoRecipients}
                timezone={timezone}
                currency={currency}
                status={noticeForForm(tripNotice, "last-minute-deal")}
                leadTime={
                  <Suspense fallback={null}>
                    <DealLeadTime
                      shopId={shop.id}
                      startsAt={trip.startsAt}
                      timeZone={timezone}
                      locale={locale}
                    />
                  </Suspense>
                }
              />
            </div>
          </AutoOpenDetails>
        ) : null}

        <DepartureNoteSection locale={locale} shop={shop} trip={trip} />

        {more}

        <details className="group/activity">
          <summary className={FOOT_ROW_SUMMARY}>
            <span>{t("trips.guests.activityHeading")}</span>
            <DisclosureCaret direction="down" className="size-4 group-open/activity:rotate-180" />
          </summary>
          <div className={FOOT_ROW_BODY}>
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
      </DisclosureRowList>
      {/* Today, Promotions and a held send link here at `#last-minute-deal`;
          the roster's own ScrollToHash is not on this tab. */}
      <ScrollToHash />
    </div>
  );
}

/**
 * The demand banner's second door: hand the waiting interests to a departure that
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
                {carryTargetLabel(target, t)}
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
