import Link from "next/link";
import type { ReactNode } from "react";
import { AgencyCheckRow } from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckRow";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { menuRowClass } from "@/components/ui/menu";
import { STAFF_RE_ENTRY_KEYS } from "@/features/trips/dive-intent";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { CERTIFICATION_LEVEL_KEYS, STAFF_DIVE_RECENCY_KEYS } from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { certificationRank } from "@/lib/certification-levels";
import { rentalFitLine } from "@/lib/dive-prep";
import { formatDateTimeTz } from "@/lib/format";
import { GuestFact } from "./GuestFact";
import { GuestRequirements } from "./GuestRequirements";
import {
  GuestActionDismiss,
  GuestActionSheet,
  GuestActionsProvider,
  GuestMenuAction,
  GuestMoreMenu,
} from "./guest-actions";
import { MoveSeatControl } from "./MoveSeatControl";
import type { RosterRowContext } from "./RosterRow";
import type { RowOutstanding } from "./roster-row-outstanding";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";
import { SeatComingAs } from "./SeatComingAs";
import { SeatEmergencyContact } from "./SeatEmergencyContact";
import { SeatLunchNote } from "./SeatLunchNote";
import { SeatNotes } from "./SeatNotes";
import { SeatPickup } from "./SeatPickup";

const LINK = buttonClass({ variant: "link", size: "sm", flush: true });

/**
 * **A guest opened in place** (ADR 20261117-trip-page-clock; owner,
 * 2026-11-25, "one list, one menu"): what fixes them first, then one list of
 * facts (`GuestFact`: card, waiver, gear, last dive, who to call, pickup,
 * lunch, coming as, notes), each changed from the word at its row's end. The
 * rare acts are one More menu beside Close: the profile, Create order, Move to
 * another trip, Not here, Turn away and Cancel booking, each asking its
 * question in a sheet at the top of the panel. The row above carries the name
 * and the one status phrase; nothing here repeats them.
 */
export function OpenedGuest({
  seat,
  context,
  reasonLines,
  chips,
  fixes,
  identityCheck,
  identityContact,
}: {
  seat: RosterSeat & Pick<RowOutstanding, "paymentRemedy" | "referenceFacts">;
  context: RosterRowContext;
  reasonLines: RowReasonLines["reasonLines"];
  /** Minor, birthday, or coming as something other than a diver. */
  chips: ReactNode;
  /** The remedies not already beside a reason: waiver, course forms, payment, course work. */
  fixes: ReactNode;
  identityCheck: ReactNode;
  identityContact: ReactNode;
}) {
  const { booking, person, t, arrival, showsPersonDetail, identityUnconfirmed } = seat;
  const { rows, actions, trip } = context;
  const { locale, shopTimezone: timeZone } = trip;
  const readiness = rows.readinessByBooking.get(booking.id);
  const card = [...(readiness?.certifications ?? [])].sort(
    (a, b) => certificationRank(b.level as never) - certificationRank(a.level as never),
  )[0];
  const waiver = seat.currentWaiver;
  const signed =
    waiver?.completedAt &&
    (seat.waiverStatus === "signed" || seat.waiverStatus === "guardian_missing")
      ? waiver.completedAt
      : null;
  const facts: { key: string; label: string; value: ReactNode; door?: ReactNode }[] = [];
  // A minor's age is said in years: it decides who signs and how deep they go.
  if (seat.minor && seat.age !== null) {
    facts.push({ key: "age", label: t("trips.fixList.facts.age"), value: seat.age });
  }
  if (showsPersonDetail && booking.participantType !== "rider") {
    facts.push({
      key: "card",
      label: t("trips.fixList.facts.card"),
      value: card?.level
        ? t(
            card.status === "verified"
              ? "trips.fixList.facts.cardChecked"
              : "trips.fixList.facts.cardUnchecked",
            { level: t(CERTIFICATION_LEVEL_KEYS[card.level]) },
          )
        : t("trips.fixList.facts.noCard"),
    });
  }
  if (signed && showsPersonDetail) {
    const date = formatDateTimeTz(signed, locale, timeZone);
    const method = waiver?.signatureMethod;
    facts.push({
      key: "waiver",
      label: t("trips.fixList.facts.waiver"),
      value: (
        <>
          {t(
            method === "in_person_attested"
              ? "trips.roster.signedPaper"
              : method === "imported"
                ? "trips.roster.signedImported"
                : "trips.roster.signedPlain",
            { date },
          )}
          {/* A minor's release names who co-signed it (ADR 20260907-guardian-co-signature). */}
          {seat.guardian ? (
            <span className="block">{guardianCoSignedText(t, seat.guardian)}</span>
          ) : null}
        </>
      ),
    });
  }
  if (showsPersonDetail && booking.participantType !== "rider") {
    facts.push({
      key: "gear",
      label: t("trips.fixList.facts.gear"),
      value: (
        <>
          {rentalFitLineText(
            t,
            locale,
            rentalFitLine(
              rows.rentalFitByBooking.get(booking.id) ?? null,
              trip.shopRentalItems,
              booking.participantType,
            ),
          )}
          {seat.nitrox ? (
            <>
              {" · "}
              {t(
                seat.nitrox.approved
                  ? "trips.roster.nitroxApproved"
                  : "trips.roster.nitroxUnverified",
              )}
            </>
          ) : null}
        </>
      ),
      // Sizes are the diver's own, kept on their profile.
      door: (
        <Link href={`/shop/${trip.shopSlug}/divers/${person.id}#gear`} className="hover:underline">
          {t("trips.fact.edit")}
        </Link>
      ),
    });
  }
  if (booking.lastDivedBand) {
    facts.push({
      key: "lastDive",
      label: t("trips.fixList.facts.lastDive"),
      value: t(STAFF_DIVE_RECENCY_KEYS[booking.lastDivedBand]),
    });
  }
  // What a guest easing back asked the crew for, said at the desk too (domain review of layer B, F2).
  if (booking.reEntryAsk && showsPersonDetail) {
    facts.push({
      key: "asked",
      label: t("trips.fixList.facts.asked"),
      value: t(STAFF_RE_ENTRY_KEYS[booking.reEntryAsk]),
    });
  }
  if (seat.depthShared && seat.depthText) {
    facts.push({ key: "depth", label: t("trips.roster.depthChip"), value: seat.depthText });
  }
  // A walk-in booked with no email is said, so the desk asks for one.
  if (showsPersonDetail) {
    facts.push({
      key: "email",
      label: t("trips.fixList.facts.email"),
      value: person.email ? (
        <a href={`mailto:${person.email}`} className="hover:underline">
          {person.email}
        </a>
      ) : (
        t("trips.fixList.facts.noEmail")
      ),
    });
  }

  const menuRow = menuRowClass("quiet", { gutter: false });
  const moves = seat.moveSeat && seat.moveSeat.targets.length > 0 ? seat.moveSeat : null;
  const moveRefusal = moves?.refusal?.bookingId === booking.id ? moves.refusal.text : undefined;
  const acts = arrival?.acts?.get(booking.id) ?? [];
  const neverMind = <GuestActionDismiss>{t("words.dismiss.neverMind")}</GuestActionDismiss>;
  return (
    <GuestActionsProvider
      initial={moveRefusal ? "move" : null}
      // The Inbox's "Move to another departure" lands on this fragment.
      openOnHash={{ [`move-booking-${booking.id}`]: "move" }}
    >
      <div data-opened-guest={booking.id} className="space-y-4">
        <GuestMoreMenu bookingId={booking.id} label={t("trips.clock.more")}>
          <Link href={`/shop/${trip.shopSlug}/divers/${person.id}`} className={menuRow}>
            {t("trips.folio.openProfile")}
          </Link>
          {/* One orders door per row, and only when the shop can take money at all. */}
          {seat.offersCreateOrder ? (
            <Link
              href={`/shop/${trip.shopSlug}/orders?add=1&personId=${person.id}&bookingId=${booking.id}`}
              className={menuRow}
            >
              {t("trips.roster.createOrder")}
            </Link>
          ) : null}
          {moves ? (
            <GuestMenuAction action="move">{t("trips.roster.moveSeat")}</GuestMenuAction>
          ) : null}
          {acts.map((act) => (
            <GuestMenuAction key={act.key} action={act.key}>
              {act.label}
            </GuestMenuAction>
          ))}
          <GuestMenuAction action="cancel" tone="danger">
            {t("trips.roster.removeBooking")}
          </GuestMenuAction>
        </GuestMoreMenu>
        {moves ? (
          <GuestActionSheet id={`move-booking-${booking.id}`} action="move">
            <MoveSeatControl
              sheet
              dismiss={neverMind}
              bookingId={booking.id}
              copy={{
                trigger: t("trips.roster.moveSeat"),
                label: t("trips.roster.moveSeatTo"),
                note: t("trips.roster.moveSeatNote"),
                choose: t("trips.roster.moveSeatChoose"),
                pending: t("trips.roster.moveSeatPending"),
                submit: t("trips.roster.moveSeatSubmit"),
                cancel: t("words.dismiss.neverMind"),
              }}
              targets={moves.targets.map((target) => ({
                ...target,
                availability: t(
                  target.seatsLeft > 0
                    ? "trips.roster.moveSeatAvailability"
                    : "trips.roster.moveSeatFull",
                  { count: Math.max(0, target.seatsLeft) },
                ),
              }))}
              action={moves.action}
              refusal={moveRefusal}
              carriedChartersNote={seat.carriedChartersNote}
              partySeats={moves.partySeats}
              partyNote={
                moves.partySeats
                  ? t("trips.roster.moveSeatParty", { count: moves.partySeats })
                  : undefined
              }
            />
          </GuestActionSheet>
        ) : null}
        {acts.map((act) => (
          <GuestActionSheet key={act.key} action={act.key}>
            {act.sheet}
          </GuestActionSheet>
        ))}
        <GuestActionSheet action="cancel">
          {seat.removeRefusedAboard ? (
            // The boat carried this seat or may be carrying it (H-20261015-aboard-diver-removal-at):
            // the sheet says why it will not cancel, and there is nothing to confirm.
            <p role="status" className="text-sm font-medium text-danger">
              {t(
                seat.removeRefusedAboard === "uncertain"
                  ? "trips.roster.removePresenceUncertain"
                  : seat.removeRefusedAboard === "uncounted"
                    ? "trips.roster.removeUncounted"
                    : "trips.roster.removeAboard",
                { name: person.fullName },
              )}
            </p>
          ) : (
            // A cancel inside the shop's refund window fires an automatic Stripe
            // refund the Undo banner cannot claw back, so it asks first
            // (docs/design/principles.md §7).
            <form action={seat.removeBookingAction} className="space-y-3">
              <input type="hidden" name="bookingId" value={booking.id} />
              <p className="text-sm">
                {t("trips.roster.confirmRemoveBooking", { name: person.fullName })}
              </p>
              {seat.carriedChartersNote ? (
                <p className="text-sm text-muted">{seat.carriedChartersNote}</p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <SubmitButton
                  pendingLabel={t("words.busy.removing")}
                  className={buttonClass({ variant: "danger", size: "sm" })}
                >
                  {t("trips.roster.removeBookingConfirmButton")}
                </SubmitButton>
                {neverMind}
              </div>
            </form>
          )}
        </GuestActionSheet>
        {chips ? <div className="flex flex-wrap items-center gap-3">{chips}</div> : null}
        <div className="space-y-4 empty:hidden">
          <GuestRequirements
            lines={reasonLines}
            blockers={seat.blockerTexts}
            payment={seat.paymentRemedy}
            contact={
              <a href={`#guest-contact-${booking.id}`} className={LINK}>
                {t("trips.folio.reviewContact")}
              </a>
            }
            t={t}
          />
          {arrival ? null : identityContact}
          {identityCheck}
          {seat.arrivalBelow}
          {identityUnconfirmed || !actions.agencyCheckAction ? null : (
            <AgencyCheckRow
              personId={person.id}
              cards={rows.agencyCheckCardsByPerson?.get(person.id) ?? []}
            />
          )}
          {fixes}
        </div>
        {showsPersonDetail ? null : (
          // Said, not silently blank: an empty list reads as a guest with no
          // card and no contact, a wrong fact rather than an absent one.
          <p className="text-sm text-muted">{t("trips.roster.identityWithheldDetails")}</p>
        )}
        <div data-guest-facts="" className="divide-y divide-border border-t border-border">
          {facts.map((fact) => (
            <GuestFact key={fact.key} label={fact.label} value={fact.value} door={fact.door} />
          ))}
          <SeatEmergencyContact
            row
            bookingId={booking.id}
            held={!showsPersonDetail}
            contact={
              showsPersonDetail
                ? { name: person.emergencyContactName, phone: person.emergencyContactPhone }
                : {
                    name: booking.heldEmergencyContactName ?? null,
                    phone: booking.heldEmergencyContactPhone ?? null,
                  }
            }
            holdOpen={seat.holdOpen}
            t={t}
            saveEmergencyContactAction={seat.saveEmergencyContactAction}
          />
          {seat.setParticipantTypeAction ? (
            <SeatComingAs
              row
              booking={booking}
              t={t}
              certRefused={seat.participantTypeCertBookingId === booking.id}
              setParticipantTypeAction={seat.setParticipantTypeAction}
            />
          ) : null}
          <SeatPickup row booking={booking} t={t} updatePickupAction={seat.updatePickupAction} />
          <SeatLunchNote row booking={booking} t={t} updateAction={seat.updateDietaryNoteAction} />
          <SeatNotes
            row
            bookingId={booking.id}
            notes={seat.notes}
            t={t}
            locale={locale}
            shopTimezone={timeZone}
            addNoteAction={seat.addNoteAction}
            deleteNoteAction={seat.deleteNoteAction}
          />
        </div>
        {/* A flagged medical answer, and a held seat's matched record, stay one tap further in. */}
        {seat.flaggedPrompts.length > 0 || (arrival && identityContact) ? (
          <details className="group/private">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
              {t("trips.fixList.private")}
              <DisclosureCaret direction="down" className="size-4 group-open/private:rotate-180" />
            </summary>
            {seat.referenceFacts}
          </details>
        ) : null}
        {seat.blockerTexts.length > 0 && seat.arrivalControl ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">{seat.arrivalControl}</div>
        ) : null}
      </div>
    </GuestActionsProvider>
  );
}
