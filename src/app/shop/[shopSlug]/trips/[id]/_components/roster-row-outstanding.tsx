import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_CLASS } from "@/components/ui/card";
import { GroupLabel } from "@/components/ui/group-label";
import { StatusMarkColumn } from "@/components/ui/StatusMark";
import type { IssuedCard } from "@/db/agency-processing";
import { STAFF_RE_ENTRY_KEYS } from "@/i18n/dive-intent-labels";
import { COURSE_FORMS_BLOCK_BOARDING } from "@/lib/course-forms";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { isDiver } from "@/lib/participant-types";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import { CourseFormsRowControl } from "./CourseFormsRowControl";
import { ElearningCheck } from "./ElearningCheck";
import { elearningCheckCopy } from "./elearning-check-copy";
import { PartyPaymentSection } from "./PartyPaymentSection";
import { PaymentStatusControl } from "./PaymentStatusControl";
import {
  PAYMENT_STATUSES_ALL,
  PAYMENT_STATUSES_RECORDING_ONLY,
  type RosterRows,
} from "./roster-model";
import type { RowIdentity } from "./roster-row-identity";
import type { RowReasonList } from "./roster-row-reason-list";
import type { RosterSeat } from "./roster-seat";
import { SeatCourseControls } from "./SeatCourseControls";
import { TrainingMarkControl } from "./TrainingMarkControl";

/** **Outstanding**: what the seat still needs, the first band of its panel. */
/**
 * What `rowOutstanding` reads, and from which builder: the seat's facts, the contact and package lines `rowIdentity` drew, and the desk-private lines `rowReasonList` set aside. A test builds this
 * without running the chain.
 */
export type RowOutstandingInput = Pick<
  RosterSeat,
  | "booking"
  | "person"
  | "t"
  | "arrival"
  | "WAIVER_CONTROLS"
  | "paymentStatusCopy"
  | "refundEligible"
  | "shopSlug"
  | "shopTimezone"
  | "locale"
  | "tripId"
  | "requiresPayment"
  | "cancellationDeadline"
  | "mayWriteOffPayment"
  | "certifyDefaultLevel"
  | "courseHasMaterials"
  | "readinessByBooking"
  | "courseNextStepByBooking"
  | "elearningQueryByBooking"
  | "elearningChecksOff"
  | "markRosterWaiverInPersonAction"
  | "markPaymentAction"
  | "previewPartyPaymentAction"
  | "markPartyPaidAction"
  | "partyPay"
  | "certifyDiverAction"
  | "saveCourseNextStepAction"
  | "markCardProcessedAction"
  | "issuedCard"
  | "setCourseMaterialsDoneAction"
  | "elearningCheckAction"
  | "recordPaperCourseFormAction"
  | "actions"
  | "materialsDone"
  | "paymentStatus"
  | "paymentSource"
  | "paymentMark"
  | "waiverStatus"
  | "waiverControl"
  | "identityUnconfirmed"
  | "flaggedPrompts"
  | "requiresGuardian"
  | "blockerTexts"
  | "namesakeRefused"
> &
  Pick<RowIdentity, "identityContact" | "packageNote"> &
  Pick<RowReasonList, "deskPrivateLines"> &
  Pick<RosterRows, "trainingMarks">;

/** The agency a card goes to, by name; "the agency" where the course named none. */
function processingAgencyName(agency: IssuedCard["agency"], t: RosterSeat["t"]): string {
  return agency === "other" ? t("trips.roster.processedAgencyUnnamed") : t(AGENCY_KEYS[agency]);
}

export function rowOutstanding(seat: RowOutstandingInput) {
  const {
    booking,
    person,
    t,
    arrival,
    WAIVER_CONTROLS,
    paymentStatusCopy,
    refundEligible,
    shopSlug,
    shopTimezone,
    locale,
    tripId,
    requiresPayment,
    cancellationDeadline,
    mayWriteOffPayment,
    certifyDefaultLevel,
    courseHasMaterials,
    readinessByBooking,
    courseNextStepByBooking,
    elearningQueryByBooking,
    elearningChecksOff,
    markRosterWaiverInPersonAction,
    markPaymentAction,
    previewPartyPaymentAction,
    markPartyPaidAction,
    partyPay,
    certifyDiverAction,
    saveCourseNextStepAction,
    markCardProcessedAction,
    issuedCard,
    setCourseMaterialsDoneAction,
    elearningCheckAction,
    recordPaperCourseFormAction,
    actions,
    trainingMarks,
    materialsDone,
    paymentStatus,
    paymentSource,
    paymentMark,
    waiverStatus,
    waiverControl,
    identityUnconfirmed,
    flaggedPrompts,
    requiresGuardian,
    blockerTexts,
    namesakeRefused,
    identityContact,
    packageNote,
    deskPrivateLines,
  } = seat;
  // This seat's training mark on a charter (issue #2275); none on a course session.
  const trainingMark = trainingMarks?.bySeat.get(booking.id) ?? null;
  // Only a seat in the water on a medical hold: a rider is never held on one.
  const snorkelerMedicalHold =
    booking.participantType === "snorkeler" &&
    blockerTexts.some(
      ({ blocker }) => blocker.code === "medical_review" || blocker.code === "medical_not_cleared",
    );
  const waiverRemedy = waiverControl.action ? (
    <div className="mt-3">
      <WaiverSendControl
        surface="roster"
        tripId={tripId}
        bookingIds={[booking.id]}
        label={waiverControl.label}
        hint={waiverControl.hint}
        pendingLabel={
          waiverControl.action === "send" ? t("trips.roster.sending") : t("trips.roster.resending")
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
        action={markRosterWaiverInPersonAction}
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
  ) : null;
  const certificationRemedy = blockerTexts.some(
    ({ blocker }) => BLOCKER_CATEGORY[blocker.code] === "certification",
  ) ? (
    <Link
      href={`/shop/${shopSlug}/divers/${person.id}#cards`}
      className="mt-2 -mb-3 inline-flex min-h-11 items-center align-bottom text-sm font-semibold text-primary hover:underline print:hidden"
    >
      {t("trips.roster.reviewCertificationsLink")}
    </Link>
  ) : null;
  const courseFormsRemedy = identityUnconfirmed ? null : (
    <CourseFormsRowControl
      tripId={tripId}
      bookingId={booking.id}
      personName={person.fullName}
      owed={readinessByBooking.get(booking.id)?.owedCourseForms ?? []}
      warnOnly={!COURSE_FORMS_BLOCK_BOARDING}
      offerSend={!waiverControl.action}
      requiresGuardian={requiresGuardian}
      recordAction={recordPaperCourseFormAction}
      t={t}
    />
  );
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
          {/* A snorkeler is held on the dive medical exactly as a diver is (H-109).
              The way aboard without it is a rider's seat, whose chip carries the
              warning; this only points at that switch, it clears nothing. */}
          {snorkelerMedicalHold ? (
            <p className="mt-2 text-sm text-muted">
              {t("participants.roster.snorkelerMedicalHint")}
            </p>
          ) : null}
        </>
      ) : null}

      {/* A course's student is its diver: a snorkeler or a rider on the
          session is not certified, nudged or ticked off (issue #2226). */}
      {isDiver(booking.participantType) ? (
        <SeatCourseControls
          bookingId={booking.id}
          personId={person.id}
          t={t}
          certifyDiverAction={certifyDiverAction}
          certifyDefaultLevel={certifyDefaultLevel}
          saveCourseNextStepAction={saveCourseNextStepAction}
          nextStep={courseNextStepByBooking?.get(booking.id) ?? ""}
          markCardProcessedAction={markCardProcessedAction}
          processedCard={
            issuedCard
              ? {
                  kind: issuedCard.kind,
                  certificationId: issuedCard.certificationId,
                  agency: processingAgencyName(issuedCard.agency, t),
                  doneLine: issuedCard.processedAt
                    ? t("trips.roster.processedLine", {
                        agency: processingAgencyName(issuedCard.agency, t),
                        date: formatShortDate(issuedCard.processedAt, locale, shopTimezone),
                      })
                    : null,
                }
              : null
          }
          setCourseMaterialsDoneAction={setCourseMaterialsDoneAction}
          materialsDoneLine={
            materialsDone
              ? materialsDone.byName
                ? t("trips.roster.materialsDoneLineBy", {
                    date: formatShortDate(materialsDone.at, locale, shopTimezone),
                    name: materialsDone.byName,
                  })
                : t("trips.roster.materialsDoneLine", {
                    date: formatShortDate(materialsDone.at, locale, shopTimezone),
                  })
              : null
          }
          certifyMaterialsNote={
            courseHasMaterials && !materialsDone ? t("trips.roster.certifyMaterialsNote") : null
          }
        />
      ) : null}
      {/* The materials tick, read off PADI's own eLearning page when the
          DiveDay browser extension is here (H-106). */}
      {elearningCheckAction && isDiver(booking.participantType) ? (
        <ElearningCheck
          query={elearningQueryByBooking?.get(booking.id) ?? null}
          bookingId={booking.id}
          materialsDone={Boolean(materialsDone)}
          action={elearningCheckAction}
          copy={elearningCheckCopy(t)}
          offNote={elearningChecksOff ? t("shared.padiChecksOff") : null}
        />
      ) : null}

      {/* The waiver, when there is one to send. The control's own face is
          the status and its label is the next action; a signed waiver has
          no control at all — its date line is reference, in the panel. */}

      {/* A training dive on a charter (issue #2275): the mark, or the course
          seats it may name. Before the forms it brings with it. */}
      {trainingMark ? (
        <TrainingMarkControl
          bookingId={booking.id}
          training={trainingMark}
          markAction={actions.markTrainingDiveAction}
          clearAction={actions.clearTrainingDiveAction}
          locale={locale}
          timezone={shopTimezone}
          t={t}
        />
      ) : null}

      {/* The course's own forms, which the release's control above does not
          speak for (ADR 20261008-course-forms). Withheld on a held seat, like
          every other write onto the diver's record from this row. */}

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
            mark={paymentMark}
            packageNote={packageNote}
            refundNote={
              refundEligible && cancellationDeadline
                ? t("trips.roster.refundEligibleUntil", {
                    date: formatDateTimeTz(cancellationDeadline, locale, shopTimezone),
                  })
                : null
            }
            copy={paymentStatusCopy}
          />
          {partyPay ? (
            <PartyPaymentSection
              bookingId={booking.id}
              party={partyPay}
              previewAction={previewPartyPaymentAction}
              confirmAction={markPartyPaidAction}
              copy={paymentStatusCopy}
              t={t}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );

  // Whether the panel's first band has anything in it — every condition
  // `outstanding` draws on, so an empty band never leaves its rule behind.
  const hasWork =
    Boolean(arrival && identityContact) ||
    deskPrivateLines.length > 0 ||
    Boolean(arrival && booking.reEntryAsk) ||
    flaggedPrompts.length > 0 ||
    snorkelerMedicalHold ||
    Boolean(certifyDiverAction) ||
    Boolean(saveCourseNextStepAction) ||
    Boolean(setCourseMaterialsDoneAction) ||
    trainingMark !== null ||
    requiresPayment;

  /**
   * **Reference**: what is merely true about this seat, one tap away.
   */
  return {
    outstanding,
    hasWork,
    waiverRemedy,
    certificationRemedy,
    courseFormsRemedy,
    hasCourseForms:
      !identityUnconfirmed &&
      (readinessByBooking.get(booking.id)?.owedCourseForms?.length ?? 0) > 0,
  };
}

export type RowOutstanding = ReturnType<typeof rowOutstanding>;
