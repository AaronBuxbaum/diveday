import Link from "next/link";
import type { ReactNode } from "react";
import { AgencyCheckRow } from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckRow";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { STAFF_RE_ENTRY_KEYS } from "@/features/dive-intent";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { CERTIFICATION_LEVEL_KEYS, STAFF_DIVE_RECENCY_KEYS } from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { certificationRank } from "@/lib/certification-levels";
import { rentalFitLine } from "@/lib/dive-prep";
import { formatDateTimeTz } from "@/lib/format";
import { TurnAwayRowStateProvider } from "../_arrivals/TurnAwayScript";
import { GuestRequirements } from "./GuestRequirements";
import type { RosterRowContext } from "./RosterRow";
import type { RowOutstanding } from "./roster-row-outstanding";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";
import { SeatComingAs } from "./SeatComingAs";
import { SeatEmergencyContact } from "./SeatEmergencyContact";
import { SeatFootActions } from "./SeatFootActions";
import { SeatLunchNote } from "./SeatLunchNote";
import { SeatNotes } from "./SeatNotes";
import { SeatPickup } from "./SeatPickup";

const LINK = buttonClass({ variant: "link", size: "sm", flush: true });

/**
 * **A guest opened in place** (ADR 20261117-trip-page-clock, drawing
 * `24-clock-guest-opened`): the buttons that fix them first, then a short list
 * of facts (card, waiver, gear, last dive, what they asked for, who to call),
 * then the rare actions behind one More. The row above it carries the name and
 * the one status phrase; nothing here repeats them as headings.
 *
 * Every action the old folio held is still here: the fixes and their forms,
 * the private details behind one disclosure, Not here and Turn away, Move to
 * another trip, Cancel booking, Create order, pickup, lunch, coming as, notes,
 * and the profile.
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
  const facts: { key: string; label: string; value: ReactNode }[] = [];
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
      // The door on a line of its own: inline, its 44px target stood one
      // wrapped line of sizes apart from the next like a blank line.
      value: (
        <>
          <span className="block">
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
          </span>
          <Link href={`/shop/${trip.shopSlug}/divers/${person.id}#gear`} className={LINK}>
            {t("trips.fixList.facts.setFit")}
          </Link>
        </>
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

  const content = (
    <div data-opened-guest={booking.id} className="space-y-5">
      {chips ? <div className="flex flex-wrap items-center gap-3">{chips}</div> : null}
      <div className="space-y-4">
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
      <dl className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        {facts.map((fact) => (
          <div key={fact.key} className="contents">
            <dt className="text-muted">{fact.label}</dt>
            <dd className="[overflow-wrap:anywhere]">{fact.value}</dd>
          </div>
        ))}
        <div id={`guest-contact-${booking.id}`} className="contents">
          <dt className="scroll-mt-24 text-muted">{t("trips.fixList.facts.ifNeeded")}</dt>
          <dd>
            {showsPersonDetail ? (
              <SeatEmergencyContact
                bookingId={booking.id}
                contact={{ name: person.emergencyContactName, phone: person.emergencyContactPhone }}
                holdOpen={seat.holdOpen}
                t={t}
                saveEmergencyContactAction={seat.saveEmergencyContactAction}
                bare
              />
            ) : (
              <SeatEmergencyContact
                bookingId={booking.id}
                contact={{
                  name: booking.heldEmergencyContactName ?? null,
                  phone: booking.heldEmergencyContactPhone ?? null,
                }}
                held
                holdOpen={seat.holdOpen}
                t={t}
                saveEmergencyContactAction={seat.saveEmergencyContactAction}
                bare
              />
            )}
          </dd>
        </div>
      </dl>
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
      {/* **The rare actions behind one More** (design review of the final screens,
          finding 10): the fixes and facts lead; releasing, moving, cancelling,
          the profile, pickup, lunch, coming as and notes wait one tap in. A
          refusal or a "Move to another departure" link arrives with it open. */}
      <AutoOpenDetails
        openOnHash={`move-booking-${booking.id}`}
        open={seat.holdOpen}
        className="group/guestmore"
      >
        <summary
          data-guest-more={booking.id}
          className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden"
        >
          {t("trips.clock.more")}
          <DisclosureCaret direction="down" className="size-4 group-open/guestmore:rotate-180" />
        </summary>
        <div className="space-y-4 pt-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {arrival?.details?.get(booking.id)}
            <SeatFootActions
              booking={booking}
              person={person}
              t={t}
              shopSlug={trip.shopSlug}
              offersCreateOrder={seat.offersCreateOrder}
              removeBookingAction={seat.removeBookingAction}
              aboardAtSea={seat.removeRefusedAboard}
              moveSeat={seat.moveSeat}
              carriedChartersNote={seat.carriedChartersNote}
            />
            <Link href={`/shop/${trip.shopSlug}/divers/${person.id}`} className={LINK}>
              {t("trips.folio.openProfile")}
            </Link>
          </div>
          <div className="space-y-1 text-sm">
            <SeatPickup booking={booking} t={t} updatePickupAction={seat.updatePickupAction} />
            <SeatLunchNote booking={booking} t={t} updateAction={seat.updateDietaryNoteAction} />
            {seat.setParticipantTypeAction ? (
              <SeatComingAs
                booking={booking}
                t={t}
                certRefused={seat.participantTypeCertBookingId === booking.id}
                setParticipantTypeAction={seat.setParticipantTypeAction}
              />
            ) : null}
            <SeatNotes
              bookingId={booking.id}
              notes={seat.notes}
              t={t}
              locale={locale}
              shopTimezone={timeZone}
              addNoteAction={seat.addNoteAction}
              deleteNoteAction={seat.deleteNoteAction}
            />
          </div>
        </div>
      </AutoOpenDetails>
    </div>
  );
  return arrival ? <TurnAwayRowStateProvider>{content}</TurnAwayRowStateProvider> : content;
}
