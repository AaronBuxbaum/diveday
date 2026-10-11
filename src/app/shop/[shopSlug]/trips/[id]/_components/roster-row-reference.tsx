import { GroupLabel } from "@/components/ui/ledger";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { rentalFitLine } from "@/lib/dive-prep";
import { formatDateTimeTz } from "@/lib/format";
import type { RowHeader } from "./roster-row-header";
import type { RowIdentity } from "./roster-row-identity";
import type { RowNotices } from "./roster-row-notices";
import type { RowOutstanding } from "./roster-row-outstanding";
import type { RowReasonList } from "./roster-row-reason-list";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";
import { SeatComingAs } from "./SeatComingAs";
import { SeatFootActions } from "./SeatFootActions";
import { SeatNotes } from "./SeatNotes";
import { SeatPickup } from "./SeatPickup";

/** **Reference**: what is merely true about this seat, one tap away. */
export function rowReference(
  seat: RosterSeat &
    RowHeader &
    RowNotices &
    RowReasonLines &
    RowIdentity &
    RowReasonList &
    RowOutstanding,
) {
  const {
    booking,
    person,
    t,
    offersCreateOrder,
    shopSlug,
    shopTimezone,
    locale,
    shopRentalItems,
    rentalFitByBooking,
    participantTypeCertBookingId,
    removeBookingAction,
    setParticipantTypeAction,
    addNoteAction,
    deleteNoteAction,
    updatePickupAction,
    currentWaiver,
    waiverStatus,
    nitrox,
    showsPersonDetail,
    guardian,
    age,
    notes,
    depthText,
    depthShared,
    emergencyContactBlock,
  } = seat;
  const reference = (
    <>
      {/* The seat's own identity facts: the roster is scanned by name and
          state, and the email — with an adult's age beside it — is
          reference the moment it is needed, not a second line on every
          row. */}
      {showsPersonDetail ? null : (
        // Said, not silently blank: a panel with no contact and no sizes
        // reads as a diver who has none, which is a wrong fact rather than
        // an absent one. The confirm control is in the work above.
        <p className="mb-4 text-sm text-muted">{t("trips.roster.identityWithheldDetails")}</p>
      )}
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {/* Who this is, first: the roster is scanned by name and state, and
            the email, with an adult's age, is the fact a desk reads back. */}
        {showsPersonDetail ? (
          <div>
            <GroupLabel as="p">{t("trips.roster.diverColumnHeading")}</GroupLabel>
            <p className="mt-1 text-sm text-muted">
              <span className="[overflow-wrap:anywhere]">
                {person.email ?? t("trips.roster.noEmailOnFile")}
              </span>
              {age !== null ? (
                <span className="tabular-nums">
                  {" · "}
                  {t("trips.roster.ageYears", { age })}
                </span>
              ) : null}
            </p>
          </div>
        ) : null}
        {/* The signed waiver's own evidence — when, and by which route —
            and nothing else. Every state that is *not* signed already says
            so under the name (principle 9). */}
        {showsPersonDetail && currentWaiver?.completedAt && waiverStatus === "complete" ? (
          <div>
            <GroupLabel as="p">{t("trips.roster.waiverColumnHeading")}</GroupLabel>
            <p className="mt-1 text-sm text-muted">
              {currentWaiver.signatureMethod === "in_person_attested"
                ? t("trips.roster.signedPaper", {
                    date: formatDateTimeTz(currentWaiver.completedAt, locale, shopTimezone),
                  })
                : currentWaiver.signatureMethod === "imported"
                  ? t("trips.roster.signedImported", {
                      date: formatDateTimeTz(currentWaiver.completedAt, locale, shopTimezone),
                    })
                  : t("trips.roster.signedPlain", {
                      date: formatDateTimeTz(currentWaiver.completedAt, locale, shopTimezone),
                    })}
            </p>
            {/* A minor's release names who co-signed it (ADR
                20260907-guardian-co-signature) — the same sentence the
                manifest and the signature log use. */}
            {guardian ? (
              <p className="mt-1 text-sm text-muted">{guardianCoSignedText(t, guardian)}</p>
            ) : null}
          </div>
        ) : null}

        {/* Sizes are the matched person's profile row and the nitrox word
            is their card, so the whole column waits for the confirmation. */}
        {showsPersonDetail ? (
          <div>
            <GroupLabel as="p">{t("trips.roster.rentalFitColumnHeading")}</GroupLabel>
            <p className="mt-1 text-sm text-muted">
              {rentalFitLineText(
                t,
                locale,
                rentalFitLine(
                  rentalFitByBooking.get(booking.id) ?? null,
                  shopRentalItems,
                  booking.participantType,
                ),
              )}
            </p>
            {nitrox ? (
              <p className="mt-1 text-sm font-medium text-primary">
                {nitrox.approved
                  ? t("trips.roster.nitroxApproved")
                  : t("trips.roster.nitroxUnverified")}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* A contact already on file: a fact about the seat, which is what
            this panel is for. Only this state appears here — a missing one
            is a reason line under the name (principle 9). */}
        {showsPersonDetail ? emergencyContactBlock : null}

        {/* The full per-diver list, only when the reason lines compressed
            part of it into a count. */}
        {depthShared && depthText !== null ? (
          <div>
            <GroupLabel as="p">{t("trips.roster.depthChip")}</GroupLabel>
            <p className="mt-1 text-sm text-muted">{depthText}</p>
          </div>
        ) : null}

        <SeatPickup booking={booking} t={t} updatePickupAction={updatePickupAction} />
      </div>

      {setParticipantTypeAction ? (
        <SeatComingAs
          booking={booking}
          t={t}
          certRefused={participantTypeCertBookingId === booking.id}
          setParticipantTypeAction={setParticipantTypeAction}
        />
      ) : null}

      <SeatNotes
        bookingId={booking.id}
        notes={notes}
        t={t}
        locale={locale}
        shopTimezone={shopTimezone}
        addNoteAction={addNoteAction}
        deleteNoteAction={deleteNoteAction}
      />

      <SeatFootActions
        booking={booking}
        person={person}
        t={t}
        shopSlug={shopSlug}
        offersCreateOrder={offersCreateOrder}
        removeBookingAction={removeBookingAction}
      />
    </>
  );
  // The row's one disclosure control, pinned to the header line's trailing
  // edge in the same spot on every row. On a cleared seat its face *is* the
  // row's mark — the drawn check — so the mark and the door to the seat's
  // reference are one object rather than two trailing glyphs; a row with
  // open work wears the caret. The summary holds only the mark, so the
  // diver-name link beside it is never an interactive element nested in
  // another (axe nested-interactive); the accessible name says whose
  // details these are.
  //
  // `top-1` is the `li`'s own top padding (`py-1`), so this 44px box and the
  // header line's 44px name link share one band and the mark centres on the
  // name and the pills (K-157: a stale `top-2.5` sat it 6px low).
  return { reference };
}

export type RowReference = ReturnType<typeof rowReference>;
