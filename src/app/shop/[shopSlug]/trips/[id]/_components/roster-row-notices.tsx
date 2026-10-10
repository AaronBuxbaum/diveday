import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_CLASS } from "@/components/ui/card";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { STAFF_RE_ENTRY_KEYS } from "@/i18n/dive-intent-labels";
import { diveRecencyText } from "@/i18n/readiness-labels";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import { heldSeatBlockers } from "@/lib/identity-match";
import { isDiver } from "@/lib/participant-types";
import { shopPath } from "@/lib/staff-notices";
import type { RowHeader } from "./roster-row-header";

import type { RosterSeat } from "./roster-seat";
import { SeatEmergencyContact } from "./SeatEmergencyContact";

/** What stands in the open under the name: an emergency contact, a returning diver's ask, years dry, and a flagged medical answer's actions. */
export function rowNotices(seat: RosterSeat & RowHeader) {
  const {
    booking,
    person,
    t,
    arrival,
    shopSlug,
    readinessByBooking,
    sendNewWaiverAction,
    saveEmergencyContactAction,
    readiness,
    currentWaiver,
    waiverStatus,
    refusalRetired,
    identityUnconfirmed,
    showsPersonDetail,
    hasEmergencyContact,
    holdOpen,
  } = seat;
  const emergencyContactBlock = (
    <SeatEmergencyContact
      bookingId={booking.id}
      person={person}
      hasEmergencyContact={hasEmergencyContact}
      holdOpen={holdOpen}
      t={t}
      saveEmergencyContactAction={saveEmergencyContactAction}
    />
  );

  // **With the hold's reason in the open, its particulars wait behind the
  // row** (issue #716; dive-domain review 2026-10-05; Aaron, 2026-10-06).
  // The reason line says what a crew must read before the diver boards;
  // *which* questions were answered yes — health data about the person —
  // waits behind the row's mark, on the desk and off it alike.
  const reEntryNote = (
    <>
      {/* What this diver asked for when they said they were easing back, in
          the open. A fact beside a name in a muted tone — no warning
          colour, no mark that means careful:
          a diver getting comfortable again is a diver the shop is ready for.
          What this seat *came for* is deliberately not here; the crew reads
          that as the departure's count on the team builder, never as a row
          per person (#1183's boundary). */}
      {booking.reEntryAsk && !arrival ? (
        <p className={`mt-3 ${INSET_NOTE_CLASS}`}>{t(STAFF_RE_ENTRY_KEYS[booking.reEntryAsk])}</p>
      ) : null}
    </>
  );
  /**
   * **The row's lines of why** (owner, 2026-10-05: the Divers tab read as a
   * wall of open panels). Every sentence a seat with work left has to say —
   * what stops them boarding, then what is worth a word before they do —
   * stands under the name as one plain line each, with no tinted box; the
   * fixes for them wait behind the row's own control. Danger for a blocker,
   * warning for an advisory. Membership is by kind, never by value, so the
   * panel below never repeats a sentence said here.
   */
  // Currency is a diver's question (ADR 20261007-participant-types).
  const recencyText =
    isDiver(booking.participantType) && diveRecencyIsNotable(booking.lastDivedBand)
      ? diveRecencyText(t, booking.lastDivedBand)
      : null;
  /**
   * **A medical hold is a reason line with its doors under it** (Aaron,
   * 2026-10-06: "just having them in Blocked with a reason provided after
   * the X is good enough. But we do need controls"). The tinted panel that
   * restated the hold under the reason line is gone; what it carried that the
   * line does not — the doors — sits under the line's words, and which
   * questions were answered yes waits behind the row's mark with the rest of
   * the seat's health detail.
   */
  const linkAction = buttonClass({ variant: "link", size: "sm", flush: true });
  const medicalActions =
    waiverStatus === "medical_review" || waiverStatus === "medical_not_cleared" ? (
      <>
        {currentWaiver && showsPersonDetail ? (
          <Link
            href={shopPath(shopSlug, "divers", person.id, "waivers", currentWaiver.id)}
            className={linkAction}
          >
            {t("trips.roster.viewSignedRecord")}
          </Link>
        ) : null}
        {/* The clearance is a fact about the person, so it is recorded on
            their record. Not drawn once the answer has arrived: the record
            has nowhere for a second one to go. */}
        {waiverStatus === "medical_review" ? (
          <Link href={`${shopPath(shopSlug, "divers", person.id)}#waiver`} className={linkAction}>
            {t("trips.roster.recordPhysicianClearance")}
          </Link>
        ) : null}
        {/* A physician's "no" is final for its record, and a diver
            re-evaluated later gets back on a boat by signing a fresh release
            (docs/product/glossary.md, *Physician clearance*). Once retired,
            the seat's own waiver control carries the new link instead. */}
        {waiverStatus === "medical_not_cleared" && !refusalRetired && sendNewWaiverAction ? (
          <form action={sendNewWaiverAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <InlineConfirm
              triggerLabel={t("trips.roster.sendNewWaiver")}
              message={t("trips.roster.sendNewWaiverMessage", { name: person.fullName })}
              confirmLabel={t("trips.roster.sendNewWaiverConfirm")}
              cancelLabel={t("trips.roster.neverMind")}
              pendingLabel={t("trips.roster.sending")}
              triggerClassName={linkAction}
              confirmClassName={buttonClass({ variant: "primary", size: "sm" })}
            />
          </form>
        ) : null}
      </>
    ) : null;
  /**
   * **A new release can clear a diver a physician refused, and the row says
   * so** (Aaron, 2026-10-07, issue #2158: "allow a waiver without, but show
   * a warning that a previous waiver had a physician say no (with link)").
   * A warning, not a blocker, on Ready rows too, with the refused record one
   * tap away. Withheld on a held seat: it is the matched person's history.
   */
  const earlierRefusal = showsPersonDetail
    ? (readinessByBooking.get(booking.id)?.overriddenRefusal ?? null)
    : null;
  /**
   * **A clean release stood over a referral no physician answered, and the
   * row says so the same way** (Aaron, 2026-10-09, issue #2195, amending
   * H-98): the override stands, and the warning links back to the referral.
   * Never alongside the refusal line for one record (`overriddenReferral`
   * leaves refusals out), and withheld on a held seat for the same reason.
   */
  const earlierReferral = showsPersonDetail
    ? (readinessByBooking.get(booking.id)?.overriddenReferral ?? null)
    : null;
  // What withholding dropped is still said to exist, never which: the
  // manifest's rule (dive-domain review 2026-10-06).
  const moreHoldsBehindConfirmation =
    identityUnconfirmed &&
    readiness !== undefined &&
    readiness.status !== "ready" &&
    heldSeatBlockers(readiness.blockers).length < readiness.blockers.length;
  return {
    emergencyContactBlock,
    reEntryNote,
    recencyText,
    linkAction,
    medicalActions,
    earlierRefusal,
    earlierReferral,
    moreHoldsBehindConfirmation,
  };
}

export type RowNotices = ReturnType<typeof rowNotices>;
