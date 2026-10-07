import Link from "next/link";
import { Children, type ReactNode } from "react";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { IdentityCheck } from "@/components/IdentityCheck";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX, INSET_NOTE_CLASS } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { GroupLabel } from "@/components/ui/ledger";
import { StatusMark, StatusMarkColumn } from "@/components/ui/StatusMark";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { STAFF_RE_ENTRY_KEYS } from "@/i18n/dive-intent-labels";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { identityCheckWords, identityReasonText } from "@/i18n/identity-check-labels";
import { staffParticipantTypeLabel, staffSeatTypeNote } from "@/i18n/participant-labels";
import {
  CERTIFICATION_LEVEL_KEYS,
  diveRecencyText,
  readinessBlockerText,
  readinessStatusText,
  readinessStatusTone,
  SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import { drysuitCardWarningText, rentalFitLineText } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ageOnDate, birthdayCallout, isMinorOnDate, maxPlausibleBirthDate } from "@/lib/age";
import type { CalendarDate } from "@/lib/calendar-date";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { rentalFitLine } from "@/lib/dive-prep";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import { checkDrysuitCard } from "@/lib/drysuit-card";
import { displayStoredPhoneWhole } from "@/lib/forgiving-fields";
import { formatDateTimeTz, formatShortDate, formatTimeTz } from "@/lib/format";
import { guardianSignatureOf, guardianSignatureRequired } from "@/lib/guardian";
import { heldSeatBlockers } from "@/lib/identity-match";
import { cachedListFormat } from "@/lib/intl-cache";
import { flaggedMedicalPrompts } from "@/lib/medical";
import { isDiver, PARTICIPANT_TYPES } from "@/lib/participant-types";
import { paymentSourceLine } from "@/lib/payment-source";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import { shopPath } from "@/lib/staff-notices";
import { waiverState } from "@/lib/waivers";
import { PaymentStatusControl, type PaymentStatusControlCopy } from "./PaymentStatusControl";
import {
  PAYMENT_STATUSES_ALL,
  PAYMENT_STATUSES_RECORDING_ONLY,
  type RosterActions,
  type RosterArrival,
  type RosterPrivateNote,
  type RosterRows,
  type RosterTrip,
  type WaiverControls,
} from "./roster-model";
import type { RosterEntry } from "./types";

/** What every row on the ledger reads, built once by `RosterSection`. */
export type RosterRowContext = {
  t: StaffTranslator;
  trip: RosterTrip;
  rows: RosterRows;
  actions: RosterActions;
  arrival: RosterArrival | undefined;
  /** Depth sentences much of the boat shares, said once in the group band. */
  sharedAdvisoryTexts: ReadonlySet<string>;
  waiverControls: WaiverControls;
  paymentStatusCopy: PaymentStatusControlCopy;
  refundEligible: boolean;
  /** Today in the shop's zone — when a paper release recorded here is signed. */
  signedToday: CalendarDate;
  /** One answer for the seat's foot row: the link and the flush of the control after it. */
  offersCreateOrder: boolean;
};

/**
 * The drawn mark a cleared seat wears — the same circle-and-check geometry as
 * `SettledCheck`, so one hand drew every settled mark in the app. Decorative:
 * the group band above the row already says "Ready" in words, which is what
 * lets seven rows stop repeating it (ADR
 * 20260827-the-departure-is-two-working-surfaces; emoji never — decision 5).
 */
function ReadyMark({ className = "" }: { className?: string }) {
  return <StatusMark variant="success" size="md" className={className} />;
}

/**
 * **One seat on the guests ledger** — its name line, its reason lines, and the
 * one panel behind its mark (what the seat still needs, then what is true
 * about it, then notes, then the seat's own actions). `RosterSection` files
 * it under its group; this draws it.
 */
export function RosterRow({
  entry,
  settled: settledRow,
  context,
}: {
  entry: RosterEntry;
  /** Filed under a settled group ("Ready", "Checked in"): its mark is the drawn check. */
  settled: boolean;
  context: RosterRowContext;
}) {
  const { booking, person } = entry;
  const {
    t,
    trip,
    rows,
    actions,
    arrival,
    sharedAdvisoryTexts,
    waiverControls: WAIVER_CONTROLS,
    paymentStatusCopy,
    refundEligible,
    signedToday,
    offersCreateOrder,
  } = context;
  const {
    shopSlug,
    shopTimezone,
    locale,
    tripId,
    tripDate,
    requiresPayment,
    cancellationDeadline,
    mayWriteOffPayment,
    shopRentalItems,
    splitAsksDateOfBirth = false,
  } = trip;
  const {
    readinessByBooking,
    waiverByBooking,
    rentalFitByBooking,
    nitroxByBooking,
    notesByBooking,
    courseNextStepByBooking,
    sameNameHeldSeats,
    keepOpenBookingId,
    namesakeRefusedBookingId,
    participantTypeCertBookingId,
  } = rows;
  const {
    markWaiverInPersonAction,
    markPaymentAction,
    removeBookingAction,
    setParticipantTypeAction,
    confirmIdentityAction,
    splitIdentityAction,
    sendNewWaiverAction,
    addNoteAction,
    deleteNoteAction,
    saveEmergencyContactAction,
    certifyDiverAction,
    saveCourseNextStepAction,
    updatePickupAction,
  } = actions;
  const readiness = readinessByBooking.get(booking.id)?.readiness;
  const paymentStatus = readinessByBooking.get(booking.id)?.paymentStatus;
  const paymentSourceCode = paymentSourceLine(
    paymentStatus,
    readinessByBooking.get(booking.id)?.paymentProvider,
  );
  const paymentSource =
    paymentSourceCode === "online"
      ? t("trips.roster.paymentSourceOnline")
      : paymentSourceCode === "package"
        ? t("trips.roster.paymentSourcePackage")
        : paymentSourceCode === "counter"
          ? t("trips.roster.paymentSourceCounter")
          : paymentSourceCode === "waived"
            ? t("trips.roster.paymentSourceWaived")
            : null;
  const currentWaiver = waiverByBooking.get(booking.id)?.waiver ?? null;
  const waiverStatus = waiverState(currentWaiver);
  // **A retired refusal still governs, and the seat's own new link is what
  // there is to do** (`retireMedicalRefusal`). The physician's "no" keeps the
  // seat blocked and keeps its reason line, while the waiver control speaks
  // for the fresh release the seat now carries: sent, expired, or not yet.
  const refusalRetired =
    waiverStatus === "medical_not_cleared" && Boolean(currentWaiver?.supersededAt);
  const ownWaiver = readinessByBooking.get(booking.id)?.bookingWaiver ?? null;
  const waiverControl = WAIVER_CONTROLS[refusalRetired ? waiverState(ownWaiver) : waiverStatus];
  const nitrox = nitroxByBooking.get(booking.id);
  // Either signal holds the seat, so a readiness read that failed closed
  // (and so raised no identity blocker) still withholds (security review
  // 2026-10-06).
  const identityUnconfirmed =
    Boolean(booking.identityUnconfirmedAt) ||
    Boolean(readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed"));
  /**
   * **The flag gates disclosure as well as boarding** (security review
   * 2026-09-11). This seat attached itself to an existing person on a guess
   * — a reused email under a different name (H-13), or a name tapped off the
   * counter's trigram prompt (issue #1556) — and everything the roster knows
   * about that person is then a fact about *somebody*, not provably about
   * whoever is standing at the counter. Until a staffer confirms it, one
   * mis-tap would otherwise print a real diver's flagged medical answers,
   * date of birth, emergency contact and rental sizes under a stranger's
   * name, to whoever reads the roster.
   *
   * What stays is the **state of the seat** — its blockers, its readiness
   * word, its payment, the confirm control — because a seat nobody can board
   * still has to say so. What waits is the **particulars of the person**.
   * Confirming reveals all of it in the same render.
   *
   * Deliberately *not* gated: `requiresGuardian` below. That one is a gate,
   * not a line of text — suppressing it would let a staffer record a paper
   * waiver for a minor with no guardian co-signature (ADR
   * 20260907-guardian-co-signature), which is the wrong direction entirely.
   */
  const showsPersonDetail = !identityUnconfirmed;
  const guardian = showsPersonDetail && currentWaiver ? guardianSignatureOf(currentWaiver) : null;
  const flaggedPrompts =
    showsPersonDetail &&
    (waiverStatus === "medical_review" || waiverStatus === "medical_not_cleared") &&
    currentWaiver?.medicalAnswers
      ? flaggedMedicalPrompts(currentWaiver.medicalAnswers)
      : [];
  // Age is shown only when the shop actually holds a date of birth — no
  // date, no line, rather than an "unknown" that reads as a gap to fill on
  // every diver who has never been asked (H-21).
  const dateOfBirth = person.dateOfBirth;
  const age = showsPersonDetail && dateOfBirth ? ageOnDate(dateOfBirth, tripDate) : null;
  const minor = showsPersonDetail && dateOfBirth ? isMinorOnDate(dateOfBirth, tripDate) : false;
  const requiresGuardian = guardianSignatureRequired(dateOfBirth, signedToday);
  const birthday = showsPersonDetail ? birthdayCallout(dateOfBirth, tripDate) : null;
  const hasEmergencyContact = Boolean(person.emergencyContactName && person.emergencyContactPhone);
  // A warning, never a gate: the site goes deeper than this diver's
  // training, which an instructor may well have already planned around
  // (H-08). It sits apart from the blocker list for that reason. Withheld
  // on a held seat, as everything measured against the matched person is.
  const depth = showsPersonDetail ? readinessByBooking.get(booking.id)?.depthAdvisory : undefined;
  const notes = notesByBooking.get(booking.id) ?? [];
  // This row's blockers, each in its own sentence. The held-identity one
  // names both people the guess was between (`identityReasonText`), so the
  // two answers under the reason lines need no words of their own. A held
  // seat says nothing measured against the matched person
  // (`heldSeatBlockers`), the same rule as its particulars above.
  const blockerTexts =
    readiness && readiness.status !== "ready"
      ? heldSeatBlockers(readiness.blockers).map((blocker) => ({
          blocker,
          text:
            blocker.code === "identity_unconfirmed"
              ? identityReasonText(
                  t,
                  { bookedAs: booking.identityBookedAs, matchedBy: booking.identityMatchedBy },
                  person.fullName,
                  readinessBlockerText(t, blocker),
                )
              : readinessBlockerText(t, blocker),
        }))
      : [];
  const depthText = depth?.status === "exceeds" ? depthWarningText(t, depth) : null;
  const depthShared = depthText !== null && sharedAdvisoryTexts.has(depthText);
  // A diver in a drysuit, theirs or ours, with no drysuit card on file
  // (H-78). Behind the same confirmation as the sizes and the nitrox word
  // below, because both halves of the question are the matched person's own
  // record.
  const drysuitCard = showsPersonDetail
    ? checkDrysuitCard(
        rentalFitByBooking.get(booking.id)?.divesDry ?? false,
        readinessByBooking.get(booking.id)?.specialtyCertifications ?? [],
      )
    : ({ status: "ok" } as const);
  // The namesake refusal (issue #1573) holds its row open for the same
  // reason a saved contact does: the way through is a control inside the
  // row, and a staffer sent back to a collapsed list has been told what
  // happened and not where to act on it.
  const namesakeRefused = namesakeRefusedBookingId === booking.id;
  const arrivalControl = arrival?.controls.get(booking.id);
  const arrivalBelow = arrival?.below.get(booking.id);
  const holdOpen =
    keepOpenBookingId === booking.id ||
    namesakeRefused ||
    participantTypeCertBookingId === booking.id;

  const headerLeft = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {/* A real target, not a 21px text line: this link shares its row with
          the disclosure mark, so it needs its own clear hit area (WCAG
          2.5.8's 24px floor; the dock test asks for 44). Foreground ink,
          not `text-primary` — a column of teal names made the identity
          column the loudest thing on the ledger (principle 10: hierarchy by
          type before colour), and the board's own trip-title doors already
          read this way. Hover restores the link cue. */}
      <Link
        href={`/shop/${shopSlug}/divers/${person.id}`}
        className="inline-flex min-h-11 items-center font-semibold leading-tight text-base text-foreground hover:text-primary hover:underline"
      >
        {person.fullName}
      </Link>
      {/* What this person is doing aboard, in words, when it is not diving
          (ADR 20261007-participant-types). A diver carries no capsule: the
          roster is a dive roster, and the exception is what the crew is
          told. Never a filter: a rider is on this list like everyone. A seat
          whose type moved since it was sold is said in warning tone: the type
          change is the one door that clears a card check without a card,
          and the crew should see it was used. */}
      {staffSeatTypeNote(t, booking) ? (
        <Badge tone="warning" size="sm" toneMark={false}>
          {staffSeatTypeNote(t, booking)}
        </Badge>
      ) : !isDiver(booking.participantType) && booking.participantType ? (
        <Badge tone="neutral" size="sm" toneMark={false}>
          {staffParticipantTypeLabel(t, booking.participantType)}
        </Badge>
      ) : null}
      {/* Text, never colour alone — this is read in sunlight on a moving
          boat (design/principles.md #2). A minor is the exception the crew
          is being told about, and how old the minor is changes what the
          crew does about it — the manifest's own "Minor · age N" capsule,
          the same fact in the same words on both surfaces (H-21). No tone
          mark: the word is the fact, and this surface draws its marks
          rather than typing them (slice 5d / decision 5). */}
      {minor && age !== null ? (
        <Badge tone="warning" size="sm" tabularNums toneMark={false}>
          {t("manifest.minorAge", { age })}
        </Badge>
      ) : null}
      {/* The one warm capsule on the ledger — drawn from the same words the
          manifest uses, subject included, since no cake glyph rides along
          to say what the timing is about (`birthdayCalloutText`). It also
          replaces the Celebrations panel that used to restate this fact
          above the roster (principle 9: say it once, on the person). */}
      {birthday ? (
        <Badge tone="primary" size="sm">
          {birthdayCalloutText(t, birthday)}
        </Badge>
      ) : null}
    </div>
  );
  // The name line's trailing capsules, as a list rather than a fragment so
  // the slot can tell when it has nothing to hold. `Children.toArray` drops
  // every `null` below, the same question `FormStatus` asks of its children.
  // A cleared seat with no notes and no arrival is the common row, and it
  // used to render the slot's wrapper empty: the pixel probe found that
  // `div` taking the line's 12px gap on every such row of ten trip
  // captures, and on a phone wrapping to a line of its own whose 4px row gap
  // put the name 2px above the row's centre.
  //
  // **The verdict leads a phone's line and ends a wide one** (K-364). It is
  // first here, so where the capsules wrap under the name on a phone and
  // start on its column (K-278) the verdict stands on that column, and a
  // screen reader hears it before the chips; from `sm` the capsules sit at
  // the line's end and `sm:order-last` puts it against the mark, so
  // "Blocked" keeps one x whether a "Depth advisory" chip rides with it or
  // not (it moved 136px with the chip).
  const headerBadges = Children.toArray([
    // The group band already says what the rows beneath it share, so a
    // capsule here marks only this diver's own exceptional state — the
    // word, never an emoji mark (readiness vocabulary:
    // src/i18n/readiness-labels.ts; "blocked is always danger").
    //
    // `lg`: the readiness word is the one fact on this row a staffer reads
    // to decide, which principle 2's own definition makes critical text —
    // 16px, not the pill default.
    readiness && readiness.status !== "ready" ? (
      <Badge
        key="readiness"
        tone={readinessStatusTone(readiness.status)}
        toneMark={false}
        size="lg"
        className="sm:order-last"
      >
        {readinessStatusText(t, readiness.status)}
      </Badge>
    ) : null,
    // A note nobody knows exists was never written: the one-line row still
    // says there are notes to read (dive-domain review, 2026-08-21).
    !holdOpen && notes.length > 0 ? (
      <span key="notes" className="text-sm text-muted">
        {t("trips.roster.noteCount", { count: notes.length })}
      </span>
    ) : null,
    // Arrived at the counter — display only, the same capsule the manifest
    // shows. It reads existing booking state and gates nothing.
    // Not where the row's own tap already says it: with the desk open, an
    // arrived diver's row ends in "Checked in", the control that undoes it.
    booking.status === "checked_in" && !arrivalControl ? (
      <Badge key="checked-in" tone="neutral">
        {t("trips.roster.checkedInPill")}
      </Badge>
    ) : null,
    // The boat-wide advisory's mark on this diver — the group's shared
    // line above carries the sentence once.
    depthShared ? (
      <Badge key="depth" tone="warning" size="sm">
        {t("trips.roster.depthChip")}
      </Badge>
    ) : null,
  ]);
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
  // What withholding dropped is still said to exist, never which: the
  // manifest's rule (dive-domain review 2026-10-06).
  const moreHoldsBehindConfirmation =
    identityUnconfirmed &&
    readiness !== undefined &&
    readiness.status !== "ready" &&
    heldSeatBlockers(readiness.blockers).length < readiness.blockers.length;
  const reasonLines: {
    key: string;
    text: string;
    tone: "danger" | "warning";
    actions?: ReactNode;
  }[] = [
    ...blockerTexts.map(({ blocker, text }) => ({
      key: text,
      text,
      tone: "danger" as const,
      actions:
        blocker.code === "medical_review" || blocker.code === "medical_not_cleared"
          ? medicalActions
          : undefined,
    })),
    ...(earlierRefusal
      ? [
          {
            key: "earlier-refusal",
            text: t("trips.roster.earlierRefusal", {
              date: formatShortDate(earlierRefusal.at, locale, shopTimezone),
            }),
            tone: "warning" as const,
            actions: (
              <Link
                href={shopPath(shopSlug, "divers", person.id, "waivers", earlierRefusal.recordId)}
                className={linkAction}
              >
                {t("trips.roster.viewSignedRecord")}
              </Link>
            ),
          },
        ]
      : []),
    ...(moreHoldsBehindConfirmation
      ? [
          {
            key: "more-holds",
            text: t("trips.roster.heldSeatMoreHolds"),
            tone: "danger" as const,
          },
        ]
      : []),
    ...(depthText !== null && !depthShared
      ? [{ key: "depth", text: depthText, tone: "warning" as const }]
      : []),
    ...(drysuitCard.status !== "ok"
      ? [
          {
            key: "drysuit",
            text: drysuitCardWarningText(t, drysuitCard),
            tone: "warning" as const,
          },
        ]
      : []),
    ...(recencyText !== null
      ? [{ key: "recency", text: recencyText, tone: "warning" as const }]
      : []),
    // A seat whose readiness is clear can still be filed under "Still to
    // clear" by its paperwork or its money, and a row in that group with no
    // stated reason trains a crew to stop reading the group (dive-domain
    // review 2026-10-05). A waiver blocker already says the first; this is
    // for the seat no blocker speaks for. Not on a held seat: the waiver
    // read is the matched person's, so its state is theirs to state.
    ...(waiverControl.action !== null && blockerTexts.length === 0 && showsPersonDetail
      ? [
          {
            key: "waiver",
            text: t("trips.roster.reasonWaiverNotSigned"),
            tone: "warning" as const,
          },
        ]
      : []),
    ...(requiresPayment &&
    paymentStatus !== "paid" &&
    paymentStatus !== "waived" &&
    paymentStatus !== "partly_refunded"
      ? [{ key: "payment", text: t("trips.roster.reasonUnpaid"), tone: "warning" as const }]
      : []),
    // Withheld on an unconfirmed row in both directions: the contact is the
    // matched person's own record (`showsPersonDetail`).
    ...(!hasEmergencyContact && showsPersonDetail
      ? [
          {
            key: "contact",
            text: `${t("trips.roster.emergencyContactHeading")} · ${t("trips.roster.emergencyContactMissing")}`,
            tone: "warning" as const,
          },
        ]
      : []),
  ];
  // Each line's mark is its first column, one line of the words tall, so it
  // centres on their first line whatever wraps below it (K-494).
  /**
   * **The matched record's contact stands beside the question** (Aaron,
   * 2026-10-06: "needs to show some information so you know what you're
   * comparing … show the contact info still so you can contact them and
   * ask"). The reason line names the two people; these are the two ways to
   * ask the person on file. Only the record's email and phone come out from
   * behind the flag: the diver record prints both in its header to every
   * staffer anyway, and for a shared-inbox match the email is the one the
   * booker typed. Medical answers, date of birth, emergency contact and
   * sizes still wait for "Same person" (security review 2026-09-11).
   *
   * While arrivals are open the screen faces the queue, so the line moves
   * behind the row's mark with the desk's other private lines rather than
   * printing a stranger's email and phone to whoever is next in line.
   */
  const identityContact = identityUnconfirmed ? (
    <div
      className={`flex flex-wrap items-center gap-x-3 text-sm ${arrival ? "mt-2" : "-mt-1 pb-2"}`}
      data-testid="identity-contact"
    >
      {person.email || person.phone ? (
        <>
          <span className="text-muted">
            {t("shared.identityCheck.contactOnFile", { name: person.fullName })}
          </span>
          {person.email ? (
            <a
              href={mailtoHref(person.email)}
              className={buttonClass({
                variant: "link",
                size: "sm",
                flush: true,
                className: "[overflow-wrap:anywhere]",
              })}
            >
              {person.email}
            </a>
          ) : null}
          {person.phone ? (
            <a
              href={telHref(person.phone)}
              className={buttonClass({ variant: "link", size: "sm", flush: true })}
            >
              {displayStoredPhoneWhole(person.phone)}
            </a>
          ) : null}
        </>
      ) : (
        <span className="text-muted">
          {t("shared.identityCheck.noContactOnFile", { name: person.fullName })}
        </span>
      )}
    </div>
  ) : null;
  /**
   * **A held seat's two answers stand in the open, under its reason line**
   * (Aaron, 2026-10-05). The seat attached itself to an existing diver on
   * something short of proof — a reused email under a different name
   * (H-13), or a name tapped off the counter's prompt (issue #1556) — and
   * the reason line names both people. "Same person" is a blocking confirm,
   * not an undo banner: it hands the matched diver's cards and waiver to
   * this seat (docs/design/principles.md §7). "Different person" splits the
   * seat into its own record. Like the medical hold, it is a decision about
   * who may board, so it does not wait behind the row's mark.
   */
  const sameNameSeats = sameNameHeldSeats?.get(booking.id) ?? [];
  const identityCheck = identityUnconfirmed ? (
    <IdentityCheck
      bookingId={booking.id}
      bookedAs={booking.identityBookedAs}
      words={identityCheckWords(t, person.fullName)}
      splitAction={splitIdentityAction}
      asksDateOfBirth={splitAsksDateOfBirth || sameNameSeats.some((seat) => seat.asksDateOfBirth)}
      maxDateOfBirth={maxPlausibleBirthDate()}
      sameNameSeats={
        sameNameSeats.length > 0 && booking.identityBookedAs
          ? {
              label: t("shared.identityCheck.sameNameSeats", {
                count: sameNameSeats.length,
                bookedAs: booking.identityBookedAs,
                departures: cachedListFormat(locale, { type: "conjunction" }).format(
                  sameNameSeats.map((seat) =>
                    t("shared.identityCheck.sameNameDeparture", {
                      date: formatShortDate(seat.startsAt, locale, shopTimezone),
                      // The time too, so a same-day morning and afternoon
                      // run can be told apart (dive-domain re-review).
                      time: formatTimeTz(seat.startsAt, locale, shopTimezone),
                      trip: seat.tripTitle,
                    }),
                  ),
                ),
              }),
              bookingIds: sameNameSeats.map((seat) => seat.bookingId),
            }
          : undefined
      }
      className="pb-3"
      confirm={
        <form action={confirmIdentityAction}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <InlineConfirm
            triggerLabel={t("shared.identityCheck.same")}
            ariaLabel={t("shared.identityCheck.sameAria", { name: person.fullName })}
            message={t("trips.roster.confirmIdentityMessage", { name: person.fullName })}
            confirmLabel={t("trips.roster.identityConfirmButton")}
            cancelLabel={t("trips.roster.neverMind")}
            pendingLabel={t("trips.roster.confirming")}
            triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
          />
        </form>
      }
    />
  ) : null;
  const privateAtDesk = (key: string) =>
    Boolean(arrival) && (key === "payment" || key === "recency");
  const openReasonLines = reasonLines.filter(({ key }) => !privateAtDesk(key));
  const deskPrivateLines = reasonLines.filter(({ key }) => privateAtDesk(key));
  const reasonList =
    openReasonLines.length === 0 ? null : (
      <ul className="-mt-1 grid gap-1 pb-2 text-sm">
        {openReasonLines.map(({ key, text, tone, actions }) => (
          <li
            key={key}
            className={`flex items-baseline gap-2 ${
              tone === "danger" ? "text-danger" : "text-warning-strong"
            }`}
          >
            <StatusMarkColumn variant={tone} />
            <span className="min-w-0">
              {text}
              {/* The line's doors, under its words and on its column, in the
                  page's link ink so they read as controls, not as more of
                  the reason. `-mb-3` hands back the 44px target's unseen
                  half so the next line does not drift away. */}
              {actions ? (
                <span className="-mb-3 flex flex-wrap items-center gap-x-4 text-foreground">
                  {actions}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    );
  /**
   * **Work**: the fix for everything this seat still owes, behind the row's
   * own mark — the sentences themselves are the reason lines under the name
   * (owner, 2026-10-05). Membership is decided by the kind of thing, never
   * by its current value, so a control can never leave from under the
   * finger that used it: payment, the contact form and the notes stay put in
   * both states, and a form that just answered holds its row open.
   */
  const outstanding = (
    <>
      {arrival ? identityContact : null}
      {deskPrivateLines.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-sm">
          {deskPrivateLines.map(({ key, text }) => (
            <li key={key} className="flex items-baseline gap-2 text-warning-strong">
              <StatusMarkColumn variant="warning" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {arrival && booking.reEntryAsk ? (
        <p className={`mt-3 ${INSET_NOTE_CLASS}`}>{t(STAFF_RE_ENTRY_KEYS[booking.reEntryAsk])}</p>
      ) : null}
      {flaggedPrompts.length > 0 ? (
        <div className="mt-3 text-sm">
          <GroupLabel as="p">{WAIVER_CONTROLS[waiverStatus].label}</GroupLabel>
          <ul className="mt-1 flex list-disc flex-col gap-1 ps-4">
            {flaggedPrompts.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {blockerTexts.length > 0 ? (
        <>
          {/* Every named problem carries its handle. The waiver, payment,
              and identity blockers already do — their controls are on this
              row — but a certification-family blocker's fix lives on the
              diver's record (design review 2026-08-21).

              Its 44px box carries 12px nobody sees under the words, and the
              next line's `mt-3` stacked on it: 45px of air between two text
              lines (K-551). `-mb-3 align-bottom` gives that half back, as
              `buttonClass`'s `outdent` does for a quiet button, so the next
              line's box meets this one's and the target stays whole. */}
          {blockerTexts.some(
            ({ blocker }) => BLOCKER_CATEGORY[blocker.code] === "certification",
          ) ? (
            <Link
              href={`/shop/${shopSlug}/divers/${person.id}#cards`}
              className="mt-2 -mb-3 inline-flex min-h-11 items-center align-bottom text-sm font-semibold text-primary hover:underline print:hidden"
            >
              {t("trips.roster.reviewCertificationsLink")}
            </Link>
          ) : null}
        </>
      ) : null}

      <SeatCourseControls
        bookingId={booking.id}
        personId={person.id}
        t={t}
        certifyDiverAction={certifyDiverAction}
        saveCourseNextStepAction={saveCourseNextStepAction}
        nextStep={courseNextStepByBooking?.get(booking.id) ?? ""}
      />

      {/* The waiver, when there is one to send. The control's own face is
          the status and its label is the next action; a signed waiver has
          no control at all — its date line is reference, in the panel. */}
      {waiverControl.action ? (
        <div className="mt-3">
          <WaiverSendControl
            surface="roster"
            tripId={tripId}
            bookingIds={[booking.id]}
            label={waiverControl.label}
            hint={waiverControl.hint}
            pendingLabel={
              waiverControl.action === "send"
                ? t("trips.roster.sending")
                : t("trips.roster.resending")
            }
            confirmMessage={
              waiverControl.confirm
                ? t("trips.roster.confirmResendWaiver", { name: person.fullName })
                : undefined
            }
            className={buttonClass({ variant: waiverControl.variant, size: "sm" })}
            wrapperClassName=""
            copy={waiverSendCopy(t)}
          />
          {/* A diver who signed on paper or on shore: let a non-diver
              record it so the waiver gate isn't held up by a signature the
              app never sees. */}
          <PaperWaiverControl
            action={markWaiverInPersonAction}
            bookingId={booking.id}
            copy={paperWaiverCopy(t, "roster")}
            requiresGuardian={requiresGuardian}
            // A diver is standing at this departure, so the staffer here can
            // truthfully say they watched both a namesake parent and child
            // sign — the counter is the other such door, the diver's record
            // deliberately not one.
            offersNamesake
            // Drawn on this row's own refusal, or on a page notice that
            // named this booking, and on no other minor on the boat.
            noticedNamesake={namesakeRefused}
            // A page-level notice that landed the staffer back here reopens
            // the form; a refusal of this form no longer navigates at all.
            defaultOpen={namesakeRefused}
            // The fallback under the row's leading action reads in quiet
            // ink — a teal link out-shouted the bordered send pill above it
            // (design review 2026-08-29).
            variant="ghost"
          />
        </div>
      ) : null}

      {/* Whenever this departure takes money — never relocated by what the
          status happens to be, so the control a staffer just used to mark a
          seat Paid cannot vanish into a collapsed panel at the instant it
          lands. */}
      {requiresPayment ? (
        <div className="mt-3">
          <PaymentStatusControl
            bookingId={booking.id}
            status={paymentStatus ?? "unpaid"}
            action={markPaymentAction}
            allowedStatuses={
              mayWriteOffPayment ? PAYMENT_STATUSES_ALL : PAYMENT_STATUSES_RECORDING_ONLY
            }
            sourceNote={paymentSource}
            refundNote={
              refundEligible && cancellationDeadline
                ? t("trips.roster.refundEligibleUntil", {
                    date: formatDateTimeTz(cancellationDeadline, locale, shopTimezone),
                  })
                : null
            }
            copy={paymentStatusCopy}
          />
        </div>
      ) : null}
    </>
  );

  // Whether the panel's first band has anything in it — every condition
  // `outstanding` draws on, so an empty band never leaves its rule behind.
  const certificationBlocked = blockerTexts.some(
    ({ blocker }) => BLOCKER_CATEGORY[blocker.code] === "certification",
  );
  const hasWork =
    Boolean(arrival && identityContact) ||
    deskPrivateLines.length > 0 ||
    Boolean(arrival && booking.reEntryAsk) ||
    flaggedPrompts.length > 0 ||
    certificationBlocked ||
    Boolean(certifyDiverAction) ||
    Boolean(saveCourseNextStepAction) ||
    waiverControl.action !== null ||
    requiresPayment;

  /**
   * **Reference**: what is merely true about this seat, one tap away.
   */
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
                rentalFitLine(rentalFitByBooking.get(booking.id) ?? null, shopRentalItems),
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
  const badgeCluster =
    headerBadges.length > 0 ? (
      <div className="ms-auto flex flex-wrap items-center justify-end gap-2 max-sm:ms-0 max-sm:justify-start">
        {headerBadges}
      </div>
    ) : null;
  const markSummary = (
    <summary
      aria-label={t("trips.roster.detailsSummaryLabel", { name: person.fullName })}
      className={`absolute top-1 end-2 flex size-11 cursor-pointer list-none items-center justify-center rounded-lg transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:end-3 ${
        settledRow && !arrivalControl ? "text-success" : "text-muted hover:text-foreground"
      }`}
    >
      {settledRow && !arrivalControl ? (
        <ReadyMark />
      ) : (
        <DisclosureCaret
          direction="down"
          className="size-4 transition-transform group-open:rotate-180"
        />
      )}
    </summary>
  );
  return (
    <li
      key={booking.id}
      // Today's queue deep-links straight to the diver it is about;
      // scroll-mt keeps the row clear of the sticky shop header.
      id={`booking-${booking.id}`}
      className="relative scroll-mt-24 px-4 py-1 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pe-11">
        {/* From `sm`, the line's end (`ms-auto`, `justify-end`). On a
            phone, where this wraps under the name, the row's
            `justify-between` still sends an unwrapped cluster to the end,
            and a wrapped one starts on the name's column like the name's
            own wrap (K-278: it right-aligned to the mark's edge, on no
            shared edge). */}
        {arrivalControl ? (
          <>
            {/* **The desk's tap keeps the name's line at every width**: the
                name, its chips and its capsules wrap inside their own
                column, so "Check in" stands at the same edge, on the first
                line, of every row a finger runs down. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {headerLeft}
              {badgeCluster}
            </div>
            <div className="shrink-0 self-start">{arrivalControl}</div>
          </>
        ) : (
          <>
            {headerLeft}
            {badgeCluster}
          </>
        )}
      </div>
      {/* **Every seat is one line** (owner, 2026-10-05). The group band says
          the state, the name line says who, the reason lines say what is in
          the way, and everything the row can do — the waiver, payment, the
          contact, notes, the reference facts — waits behind the row's mark.
          Only a flagged medical answer and a returning diver's own ask stand
          in the open beside them, with a held seat's identity answers.
          Deep links
          (Today, the manifest's "Resolve blockers") land mid-page at one
          diver; AutoOpenDetails opens on the hash, so the fold can never
          swallow what a link promised, and `holdOpen` keeps open the row a
          form on it just answered. */}
      {reasonList}
      {arrival ? null : identityContact}
      {identityCheck}
      {reEntryNote}
      {arrivalBelow}
      <AutoOpenDetails openOnHash={`booking-${booking.id}`} open={holdOpen} className="group">
        {markSummary}
        {/* **One panel per seat** (owner, 2026-10-05: "confusing and ugly").
            It used to be a loose stack — fixes, then facts, each fact with
            its own fold, a note fold, a rule and a lone Remove — read
            straight off the row's white. Now it is one sunken card: what
            the seat still needs, then what is true about it, then notes,
            then the seat's own actions, each a band of its own. */}
        <div className="mb-3 rounded-lg border border-border bg-surface-sunken/50 p-4 sm:p-5">
          {hasWork ? (
            <div className="mb-4 border-b border-border pb-4 [&>*:first-child]:mt-0">
              {outstanding}
            </div>
          ) : null}
          {reference}
        </div>
      </AutoOpenDetails>
    </li>
  );
}

/**
 * The seat's emergency contact: on file or not, with its form under it. Staff
 * record or correct a contact from the same form wherever it is rendered — in
 * the open when the seat has none (that is work), behind the disclosure when
 * it does (that is reference).
 */
function SeatEmergencyContact({
  bookingId,
  person,
  hasEmergencyContact,
  holdOpen,
  t,
  saveEmergencyContactAction,
}: {
  bookingId: string;
  person: RosterEntry["person"];
  hasEmergencyContact: boolean;
  holdOpen: boolean;
  t: StaffTranslator;
  saveEmergencyContactAction: (formData: FormData) => void;
}) {
  // Staff record or correct a contact from the same form wherever it is
  // rendered — in the open when the seat has none (that is work), behind
  // the disclosure when it does (that is reference).
  const contactForm = (
    <form
      action={saveEmergencyContactAction}
      className="mt-2 flex max-w-md flex-col gap-3 rounded-lg border border-border bg-surface-sunken/50 p-3"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <FieldGrid columns={2}>
        <Field label={t("trips.roster.emergencyContactNameLabel")}>
          <input
            name="emergencyContactName"
            autoComplete="name"
            maxLength={120}
            defaultValue={person.emergencyContactName ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("trips.roster.emergencyContactPhoneLabel")}>
          <input
            name="emergencyContactPhone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            defaultValue={person.emergencyContactPhone ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <div>
        <SubmitButton
          pendingLabel={t("trips.roster.savingContact")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("trips.roster.saveEmergencyContact")}
        </SubmitButton>
      </div>
    </form>
  );
  const emergencyContactForm = (
    <CompactDisclosureRow
      className="mt-1"
      bodyClassName="mt-0"
      label={
        hasEmergencyContact
          ? t("trips.roster.emergencyContactEdit")
          : t("trips.roster.emergencyContactAddFull")
      }
      // A refused save comes back to the form, not to its closed label.
      holdOpen={holdOpen && !hasEmergencyContact}
    >
      {contactForm}
    </CompactDisclosureRow>
  );
  // One fact, on file or not, with its form under it: a missing contact is
  // also a reason line under the name, so the fact says only "Not on file".
  return (
    <div>
      <GroupLabel as="p">{t("trips.roster.emergencyContactHeading")}</GroupLabel>
      {hasEmergencyContact ? (
        <p className="mt-1 text-sm text-muted">
          {t("trips.roster.emergencyContactOnFile", {
            name: person.emergencyContactName ?? "",
            phone: person.emergencyContactPhone ?? "",
          })}
        </p>
      ) : (
        <p className="mt-1 text-sm font-medium text-warning-strong">
          {t("trips.roster.emergencyContactMissing")}
        </p>
      )}
      {emergencyContactForm}
    </div>
  );
}

/**
 * The course session's two acts of teaching (issues #717, #975, #1196, #1205):
 * certify this student, and what they do next. Each renders only when its
 * action is present, which is only on a course session's own roster.
 */
function SeatCourseControls({
  bookingId,
  personId,
  t,
  certifyDiverAction,
  saveCourseNextStepAction,
  nextStep,
}: {
  bookingId: string;
  personId: string;
  t: StaffTranslator;
  certifyDiverAction?: (formData: FormData) => void;
  saveCourseNextStepAction?: (formData: FormData) => void;
  nextStep: string;
}) {
  return (
    <>
      {/* The one path from "this shop taught and ran this course" to a card
          row (issues #717 and #975) — a per-student tap, collapsed by
          default. Present only on a course session's own roster. */}
      {certifyDiverAction ? (
        <details className="mt-3">
          <summary
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "cursor-pointer list-none",
            })}
          >
            {t("trips.roster.certifyDiver")}
          </summary>
          <FieldGrid
            as="form"
            action={certifyDiverAction}
            columns={1}
            className="mt-2 gap-y-3 sm:w-72"
          >
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="personId" value={personId} />
            <Field
              label={t("trips.roster.certifyLevel")}
              description={t("trips.roster.certifyLevelHint")}
            >
              <select name="award" className={controlClass}>
                <optgroup label={t("trips.roster.certifyLevelGroup")}>
                  {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("trips.roster.certifySpecialtyGroup")}>
                  {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key)}
                    </option>
                  ))}
                  <option value="nitrox">{t("trips.roster.certifyNitrox")}</option>
                </optgroup>
              </select>
            </Field>
            <SubmitButton
              pendingLabel={t("trips.roster.certifying")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.roster.certifyConfirm")}
            </SubmitButton>
          </FieldGrid>
        </details>
      ) : null}

      {/* What this student does next, written once and read on their recap
          (issues #1196, #1205). Beside the card above and under the same
          condition: both are things only a course session's instructor has
          to say, and neither is offered on a fun dive. */}
      {saveCourseNextStepAction ? (
        <details className="mt-3">
          <summary
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "cursor-pointer list-none",
            })}
          >
            {t("trips.roster.nextStepSummary")}
          </summary>
          <FieldGrid
            as="form"
            action={saveCourseNextStepAction}
            columns={1}
            className="mt-2 gap-y-3 sm:w-72"
          >
            <input type="hidden" name="bookingId" value={bookingId} />
            <Field
              label={t("trips.roster.nextStepLabel")}
              description={t("trips.roster.nextStepDescription")}
            >
              <textarea
                name="note"
                rows={2}
                maxLength={280}
                defaultValue={nextStep}
                className={textareaClassFor(2)}
              />
            </Field>
            <SubmitButton
              pendingLabel={t("trips.roster.nextStepSaving")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.roster.nextStepSave")}
            </SubmitButton>
          </FieldGrid>
        </details>
      ) : null}
    </>
  );
}

/** Hotel pickup / lodging details, with the form that sets them. */
function SeatPickup({
  booking,
  t,
  updatePickupAction,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  updatePickupAction?: (bookingId: string, formData: FormData) => void;
}) {
  return (
    <div>
      <GroupLabel as="p">{t("trips.roster.hotelPickupHeading")}</GroupLabel>
      {booking.hotelPickupLocation || booking.pickupTime ? (
        <p className="mt-1 text-sm text-muted">
          {booking.hotelPickupLocation ?? t("trips.roster.hotelNotSpecified")}
          {booking.pickupTime ? ` · ${booking.pickupTime}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">{t("trips.roster.noPickupScheduled")}</p>
      )}
      {updatePickupAction ? (
        <CompactDisclosureRow
          className="mt-1"
          bodyClassName="mt-0"
          label={
            booking.hotelPickupLocation || booking.pickupTime
              ? t("trips.roster.editPickup")
              : t("trips.roster.setPickup")
          }
        >
          <form
            action={updatePickupAction.bind(null, booking.id)}
            className="mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-2"
          >
            <FieldGrid columns={2}>
              <Field label={t("trips.roster.pickupLocationLabel")}>
                <input
                  name="hotelPickupLocation"
                  maxLength={300}
                  defaultValue={booking.hotelPickupLocation ?? ""}
                  placeholder={t("trips.roster.pickupLocationPlaceholder")}
                  className={controlClass}
                />
              </Field>
              <Field label={t("trips.roster.pickupTimeLabel")}>
                <input
                  name="pickupTime"
                  maxLength={20}
                  defaultValue={booking.pickupTime ?? ""}
                  placeholder="07:15"
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <div>
              <SubmitButton
                pendingLabel={t("trips.roster.saving")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("trips.roster.savePickup")}
              </SubmitButton>
            </div>
          </form>
        </CompactDisclosureRow>
      ) : null}
    </div>
  );
}

/** The seat's private staff notes, and the form that adds one. */
/**
 * "Coming as": what this seat is for, and the door to change it (ADR
 * 20261007-participant-types). `certRefused` is the one row the card check
 * just refused on joining the dive; only it offers "Change anyway".
 */
function SeatComingAs({
  booking,
  t,
  certRefused,
  setParticipantTypeAction,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  certRefused: boolean;
  setParticipantTypeAction: (formData: FormData) => void;
}) {
  return (
    <div className="mt-5 border-t border-border pt-3">
      <CompactDisclosureRow
        bodyClassName="mt-2"
        open={certRefused ? true : undefined}
        label={t("participants.roster.comingAs", {
          type: staffParticipantTypeLabel(t, booking.participantType ?? "diver"),
        })}
      >
        <form action={setParticipantTypeAction} className="flex max-w-md flex-wrap items-end gap-2">
          <input type="hidden" name="bookingId" value={booking.id} />
          <Field label={t("participants.roster.typeLabel")}>
            <select
              name="participantType"
              defaultValue={booking.participantType ?? "diver"}
              className={controlClass}
            >
              {PARTICIPANT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {staffParticipantTypeLabel(t, type)}
                </option>
              ))}
            </select>
          </Field>
          <SubmitButton
            pendingLabel={t("trips.roster.saving")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("participants.roster.save")}
          </SubmitButton>
        </form>
        {/* The card check refused joining the dive; the notice above names
            the card. Only this row offers the way past it, only to a staffer
            who may make that call, and it only skips the booking-time check:
            the rail still asks for the card, and a seat already boarded is
            re-checked as a diver and refused. */}
        {certRefused ? (
          <form action={setParticipantTypeAction} className="mt-3">
            <input type="hidden" name="bookingId" value={booking.id} />
            <input type="hidden" name="participantType" value="diver" />
            <input type="hidden" name="confirmCertBlock" value="1" />
            <SubmitButton
              pendingLabel={t("trips.roster.saving")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("participants.roster.changeAnyway")}
            </SubmitButton>
          </form>
        ) : null}
      </CompactDisclosureRow>
    </div>
  );
}

function SeatNotes({
  bookingId,
  notes,
  t,
  locale,
  shopTimezone,
  addNoteAction,
  deleteNoteAction,
}: {
  bookingId: string;
  notes: RosterPrivateNote[];
  t: StaffTranslator;
  locale: string;
  shopTimezone: string;
  addNoteAction: (formData: FormData) => void;
  deleteNoteAction: (formData: FormData) => void;
}) {
  return (
    <div className="mt-5 border-t border-border pt-3">
      <CompactDisclosureRow
        bodyClassName="mt-2"
        label={
          // A zero count is the absence of information formatted as
          // information (principle 9) — with no notes the disclosure is
          // simply the door to writing the first one.
          notes.length === 0
            ? t("trips.roster.addFirstNoteSummary")
            : t("trips.roster.privateStaffNotes", { count: notes.length })
        }
      >
        <div className="grid gap-3">
          {notes.map((entry) => {
            const { note, authorName } = entry;
            return (
              <div
                key={note.id}
                className={`flex items-start justify-between gap-2 ${INSET_NOTE_BOX} bg-surface-sunken`}
              >
                <div className="min-w-0">
                  <p className="break-words whitespace-pre-wrap">{note.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {authorName} · {formatDateTimeTz(note.createdAt, locale, shopTimezone)}
                  </p>
                </div>
                {entry.deletable === false ? null : (
                  <form action={deleteNoteAction} className="shrink-0">
                    <input type="hidden" name="noteId" value={note.id} />
                    {/* No confirm dialog: the delete lands and a toast
                        offers a one-tap undo — a purely reversible edit,
                        not a real send (principle 7). */}
                    <SubmitButton
                      pendingLabel={t("trips.roster.deletingEllipsis")}
                      className={buttonClass({
                        variant: "danger-ghost",
                        size: "sm",
                        busy: true,
                      })}
                    >
                      {t("trips.roster.delete")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            );
          })}
          {/* Keyed on the note count so a landed note empties the box. */}
          <PrivateNoteForm
            action={addNoteAction}
            hiddenFields={{ bookingId }}
            resetKey={notes.length}
            rows={2}
            copy={{
              label: t("trips.roster.addNoteLabel"),
              add: t("trips.roster.addPrivateNote"),
              adding: t("trips.roster.adding"),
            }}
          />
        </div>
      </CompactDisclosureRow>
    </div>
  );
}

/** The seat's own actions: the orders door and Remove. */
function SeatFootActions({
  booking,
  person,
  t,
  shopSlug,
  offersCreateOrder,
  removeBookingAction,
}: {
  booking: RosterEntry["booking"];
  person: RosterEntry["person"];
  t: StaffTranslator;
  shopSlug: string;
  offersCreateOrder: boolean;
  removeBookingAction: (formData: FormData) => void;
}) {
  return (
    <div className="mt-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* One orders door per row, and only when the shop can take money
            at all (principle 9 — Settings and the Orders index own the
            "Connect payments" door). */}
        {offersCreateOrder ? (
          <Link
            href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("trips.roster.createOrder")}
          </Link>
        ) : null}
        {/* A cancel inside the shop's refund window fires an automatic
            Stripe refund that the Undo banner can't claw back — a real
            send of money — so this gets a blocking confirm
            (docs/design/principles.md §7). */}
        <form action={removeBookingAction}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <InlineConfirm
            triggerLabel={t("trips.roster.removeBooking")}
            message={t("trips.roster.confirmRemoveBooking", { name: person.fullName })}
            confirmLabel={t("trips.roster.removeBookingConfirmButton")}
            cancelLabel={t("trips.roster.neverMind")}
            pendingLabel={t("trips.roster.removing")}
            // `danger-ghost`, which is this variant's own stated case: a
            // destructive choice among quiet siblings. On `ghost` the
            // trigger rendered as muted body text at the foot of the
            // panel, indistinguishable from the sentences above it, so
            // the one irreversible act on the row was the only thing
            // there that did not read as a control.
            triggerClassName={buttonClass({
              variant: "danger-ghost",
              size: "sm",
              flush: !offersCreateOrder,
            })}
            confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
          />
        </form>
      </div>
    </div>
  );
}
