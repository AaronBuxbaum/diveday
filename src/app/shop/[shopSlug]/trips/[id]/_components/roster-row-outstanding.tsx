import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_CLASS } from "@/components/ui/card";
import { GroupLabel } from "@/components/ui/ledger";
import { StatusMarkColumn } from "@/components/ui/StatusMark";
import { STAFF_RE_ENTRY_KEYS } from "@/i18n/dive-intent-labels";
import { COURSE_FORMS_BLOCK_BOARDING } from "@/lib/course-forms";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import { CourseFormsRowControl } from "./CourseFormsRowControl";
import { ElearningCheck } from "./ElearningCheck";
import { elearningCheckCopy } from "./elearning-check-copy";
import { PaymentStatusControl } from "./PaymentStatusControl";
import { PAYMENT_STATUSES_ALL, PAYMENT_STATUSES_RECORDING_ONLY } from "./roster-model";
import type { RowHeader } from "./roster-row-header";
import type { RowIdentity } from "./roster-row-identity";
import type { RowNotices } from "./roster-row-notices";
import type { RowReasonList } from "./roster-row-reason-list";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";
import { SeatCourseControls } from "./SeatCourseControls";

/** **Outstanding**: what the seat still needs, the first band of its panel. */
export function rowOutstanding(
  seat: RosterSeat & RowHeader & RowNotices & RowReasonLines & RowIdentity & RowReasonList,
) {
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
    markWaiverInPersonAction,
    markPaymentAction,
    certifyDiverAction,
    saveCourseNextStepAction,
    setCourseMaterialsDoneAction,
    elearningCheckAction,
    recordPaperCourseFormAction,
    materialsDone,
    paymentStatus,
    paymentSource,
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
        certifyDefaultLevel={certifyDefaultLevel}
        saveCourseNextStepAction={saveCourseNextStepAction}
        nextStep={courseNextStepByBooking?.get(booking.id) ?? ""}
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
      {/* The materials tick, read off PADI's own eLearning page when the
          DiveDay browser extension is here (H-106). */}
      {elearningCheckAction ? (
        <ElearningCheck
          query={elearningQueryByBooking?.get(booking.id) ?? null}
          bookingId={booking.id}
          materialsDone={Boolean(materialsDone)}
          action={elearningCheckAction}
          copy={elearningCheckCopy(t)}
        />
      ) : null}

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

      {/* The course's own forms, which the release's control above does not
          speak for (ADR 20261008-course-forms). Withheld on a held seat, like
          every other write onto the diver's record from this row. */}
      {identityUnconfirmed ? null : (
        <CourseFormsRowControl
          tripId={tripId}
          bookingId={booking.id}
          owed={readinessByBooking.get(booking.id)?.owedCourseForms ?? []}
          warnOnly={!COURSE_FORMS_BLOCK_BOARDING}
          offerSend={!waiverControl.action}
          requiresGuardian={requiresGuardian}
          recordAction={recordPaperCourseFormAction}
          t={t}
        />
      )}

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
    Boolean(setCourseMaterialsDoneAction) ||
    waiverControl.action !== null ||
    requiresPayment;

  /**
   * **Reference**: what is merely true about this seat, one tap away.
   */
  return { outstanding, hasWork };
}

export type RowOutstanding = ReturnType<typeof rowOutstanding>;
