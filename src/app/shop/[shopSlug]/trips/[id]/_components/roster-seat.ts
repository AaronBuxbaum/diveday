import { depthWarningOrNull } from "@/i18n/depth-labels";
import { identityReasonText } from "@/i18n/identity-check-labels";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import { checkDrysuitCard } from "@/lib/drysuit-card";
import { formatDateTimeTz, formatMoneyCents } from "@/lib/format";
import { guardianSignatureOf, guardianSignatureRequired } from "@/lib/guardian";
import { heldSeatBlockers } from "@/lib/identity-match";
import { cachedListFormat } from "@/lib/intl-cache";
import { flaggedMedicalPrompts } from "@/lib/medical";
import { paymentSourceLine } from "@/lib/payment-source";
import { waiverState } from "@/lib/waivers";
import type { RosterRowContext } from "./RosterRow";
import { seatMoveForRow } from "./roster-model";
import type { RosterEntry } from "./types";

/**
 * **What one seat on the guests ledger knows about itself**, read once from
 * the row's context: its readiness, waiver, identity hold, the particulars a
 * held seat withholds, and the actions it can take. Every part of
 * `RosterRow` draws from this one object.
 */
export function rosterSeat(entry: RosterEntry, settled: boolean, context: RosterRowContext) {
  const settledRow = settled;
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
    record,
    recordBelow,
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
    certifyDefaultLevel = null,
    courseHasMaterials = false,
    courseMaterialsOpen = false,
  } = trip;
  const {
    readinessByBooking,
    waiverByBooking,
    rentalFitByBooking,
    nitroxByBooking,
    notesByBooking,
    courseNextStepByBooking,
    elearningQueryByBooking,
    elearningChecksOff,
    courseMaterialsDoneByPerson,
    issuedCardByPerson,
    sameNameHeldSeats,
    sameNamePeople,
    dependentCharters,
    heldSeatLastDiveDay,
    packageDivesByBooking,
    paymentMarksByBooking,
    aboardAtSea,
    keepOpenBookingId,
    paymentMarkRetry,
    partyPreview,
    namesakeRefusedBookingId,
    participantTypeCertBookingId,
  } = rows;
  const {
    markRosterWaiverInPersonAction,
    markPaymentAction,
    previewPartyPaymentAction,
    markPartyPaidAction,
    removeBookingAction,
    setParticipantTypeAction,
    confirmIdentityAction,
    splitIdentityAction,
    repointIdentityAction,
    sendNewWaiverAction,
    addNoteAction,
    deleteNoteAction,
    saveEmergencyContactAction,
    certifyDiverAction,
    saveCourseNextStepAction,
    markCardProcessedAction,
    setCourseMaterialsDoneAction,
    elearningCheckAction,
    recordPaperCourseFormAction,
    updatePickupAction,
    updateDietaryNoteAction,
    moveSeat,
  } = actions;
  // A course student whose learning materials nobody has marked done (ADR
  // 20261008-course-learning-materials). Bookkeeping, never a gate: it is a
  // quiet capsule on the name line and nothing in readiness reads it.
  // "Done" is the person's, across every departure of the course
  // (`courseMaterialsDoneByPerson`); this seat's own stamp is the fallback. The
  // capsule stops once the session's last day has ended.
  const materialsDone =
    courseMaterialsDoneByPerson?.get(person.id) ??
    (booking.courseMaterialsDoneAt
      ? { at: booking.courseMaterialsDoneAt, byName: null as string | null }
      : null);
  const materialsPending = courseHasMaterials && courseMaterialsOpen && !materialsDone;
  const readiness = readinessByBooking.get(booking.id)?.readiness;
  const paymentStatus = readinessByBooking.get(booking.id)?.paymentStatus;
  const paymentSourceCode = paymentSourceLine(
    paymentStatus,
    readinessByBooking.get(booking.id)?.paymentProvider,
  );
  // The Paid mark's own record (batch 6 item 1): a counter payment says how
  // much, how, and who took it, where it used to say only "at the counter".
  const markFacts = paymentMarksByBooking?.get(booking.id) ?? null;
  const counterMark =
    paymentSourceCode === "counter" && markFacts?.mark
      ? {
          amount: formatMoneyCents(markFacts.mark.amountCents, markFacts.mark.currency, locale),
          method: markFacts.mark.method,
        }
      : null;
  const markCurrency = markFacts?.shopCurrency ?? markFacts?.mark?.currency ?? "usd";
  const paymentMark = {
    amountCents: markFacts?.balanceOwedCents ?? markFacts?.mark?.amountCents ?? null,
    currency: markCurrency,
    locale,
    // On a deposit, the field opens on the balance; the hint says that is
    // what it is, so a staffer taking a different figure knows what is left.
    balanceHint:
      paymentStatus === "deposit_paid" && markFacts?.balanceOwedCents
        ? t("trips.roster.paymentBalanceOwed", {
            amount: formatMoneyCents(markFacts.balanceOwedCents, markCurrency, locale),
          })
        : null,
    handMarkRefused: paymentSourceCode === "online" || paymentSourceCode === "package",
    retry: paymentMarkRetry?.bookingId === booking.id ? paymentMarkRetry : null,
  };
  // Party payment is offered on the lead while two or more seats owe and
  // none was paid online; the server refuses those payments too (#2605).
  const partySeats = rows.roster.filter(
    (entry) => entry.booking.id === booking.id || entry.booking.partyLeadBookingId === booking.id,
  );
  const partyOwing = partySeats.filter(
    (entry) => (paymentMarksByBooking?.get(entry.booking.id)?.balanceOwedCents ?? 0) > 0,
  );
  const partyOwedCents = partyOwing.reduce(
    (sum, entry) => sum + (paymentMarksByBooking?.get(entry.booking.id)?.balanceOwedCents ?? 0),
    0,
  );
  const partyPay =
    requiresPayment &&
    partyOwing.length >= 2 &&
    !partyOwing.some((entry) => readinessByBooking.get(entry.booking.id)?.paymentProvider)
      ? {
          seatCount: partyOwing.length,
          owed: formatMoneyCents(partyOwedCents, markCurrency, locale),
          currency: markCurrency,
          locale,
          preview: partyPreview?.leadBookingId === booking.id ? partyPreview : null,
        }
      : null;
  const paymentSource = counterMark
    ? markFacts?.mark?.recordedByName
      ? t("trips.roster.paymentMarkLine", {
          ...counterMark,
          name: markFacts.mark.recordedByName,
        })
      : t("trips.roster.paymentMarkLineUnnamed", counterMark)
    : paymentSourceCode === "online"
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
  // The booker's "Under 18" on this seat stands in for a date the shop does
  // not hold, for the badge and the co-signature alike (decision 2026-10-13).
  const minorDeclared = Boolean(booking.minorDeclaredAt);
  const minor =
    showsPersonDetail && (dateOfBirth ? isMinorOnDate(dateOfBirth, tripDate) : minorDeclared);
  const requiresGuardian = guardianSignatureRequired(dateOfBirth, signedToday, minorDeclared);
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
  const depthText = depthWarningOrNull(t, depth);
  const depthShared = depthText !== null && sharedAdvisoryTexts.has(depthText);
  // A diver in a drysuit, theirs or ours, with no drysuit card on file
  // (H-78). Behind the same confirmation as the sizes and the nitrox word
  // below, because both halves of the question are the matched person's own
  // record.
  const drysuitCard = showsPersonDetail
    ? checkDrysuitCard(
        rentalFitByBooking.get(booking.id)?.divesDry ?? false,
        readinessByBooking.get(booking.id)?.specialtyCertifications ?? [],
        person.drysuitExperienceSeenAt ?? null,
      )
    : ({ status: "ok" } as const);
  // The namesake refusal (issue #1573) holds its row open for the same
  // reason a saved contact does: the way through is a control inside the
  // row, and a staffer sent back to a collapsed list has been told what
  // happened and not where to act on it.
  const namesakeRefused = namesakeRefusedBookingId === booking.id;
  const arrivalControl = arrival?.controls.get(booking.id);
  // A finished departure has no desk; its record carries the rebooking line
  // (fifth-loop ideas, item 4).
  const arrivalBelow = arrival?.below.get(booking.id) ?? recordBelow?.get(booking.id);
  // The charter seats sold only on this course seat (issue #2058), said in
  // its Remove confirm and its move: those seats stay booked, and still need
  // the card to board.
  const carried = dependentCharters?.get(booking.id) ?? [];
  const carriedChartersNote =
    carried.length > 0
      ? t("trips.roster.courseSeatCarriesCharters", {
          name: person.fullName,
          trips: cachedListFormat(locale, { type: "conjunction" }).format(
            carried.map(
              (charter) =>
                `${charter.title} · ${formatDateTimeTz(charter.startsAt, locale, shopTimezone)}`,
            ),
          ),
        })
      : undefined;
  const holdOpen =
    keepOpenBookingId === booking.id ||
    namesakeRefused ||
    participantTypeCertBookingId === booking.id;
  return {
    booking,
    person,
    t,
    actions,
    arrival,
    WAIVER_CONTROLS,
    paymentStatusCopy,
    refundEligible,
    offersCreateOrder,
    shopSlug,
    shopTimezone,
    locale,
    tripId,
    requiresPayment,
    cancellationDeadline,
    mayWriteOffPayment,
    shopRentalItems,
    splitAsksDateOfBirth,
    certifyDefaultLevel,
    courseHasMaterials,
    readinessByBooking,
    rentalFitByBooking,
    courseNextStepByBooking,
    elearningQueryByBooking,
    elearningChecksOff,
    sameNameHeldSeats,
    sameNamePeople,
    heldSeatLastDiveDay,
    packageDivesByBooking,
    participantTypeCertBookingId,
    markRosterWaiverInPersonAction,
    markPaymentAction,
    previewPartyPaymentAction,
    markPartyPaidAction,
    removeBookingAction,
    setParticipantTypeAction,
    confirmIdentityAction,
    splitIdentityAction,
    repointIdentityAction,
    sendNewWaiverAction,
    addNoteAction,
    deleteNoteAction,
    saveEmergencyContactAction,
    certifyDiverAction,
    saveCourseNextStepAction,
    markCardProcessedAction,
    issuedCard: issuedCardByPerson?.get(person.id) ?? null,
    setCourseMaterialsDoneAction,
    elearningCheckAction,
    recordPaperCourseFormAction,
    updatePickupAction,
    updateDietaryNoteAction,
    // A booked seat, or one turned away before the start (`seatMoveForRow`).
    moveSeat: seatMoveForRow(booking, moveSeat),
    // Marked aboard a boat that has left: Remove says so and changes nothing (H-133).
    removeRefusedAboard: aboardAtSea?.get(booking.id) ?? null,
    carriedChartersNote,
    materialsDone,
    materialsPending,
    readiness,
    paymentStatus,
    paymentSource,
    paymentMark,
    partyPay,
    currentWaiver,
    waiverStatus,
    refusalRetired,
    waiverControl,
    nitrox,
    identityUnconfirmed,
    showsPersonDetail,
    guardian,
    flaggedPrompts,
    age,
    minor,
    requiresGuardian,
    birthday,
    hasEmergencyContact,
    notes,
    blockerTexts,
    depthText,
    depthShared,
    drysuitCard,
    namesakeRefused,
    arrivalControl,
    arrivalBelow,
    holdOpen,
    settledRow,
    record,
  };
}

export type RosterSeat = ReturnType<typeof rosterSeat>;
