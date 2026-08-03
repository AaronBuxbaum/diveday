import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";

/**
 * One entry per notice code, carrying its own tone and message key(s) — same
 * shape as `divers/[personId]/_components/NoticeBanner.tsx`'s `NOTICE_KEYS`.
 * A handful of refusals also carry a specific count (how many divers are
 * already booked, how many the last-minute deal reached); those get a second,
 * pluralized key used only once the count is known.
 */
const NOTICE_KEYS: Record<
  string,
  { tone: "success" | "danger" | "warning"; key: StaffMessageKey; countKey?: StaffMessageKey }
> = {
  saved: { tone: "success", key: "trips.notices.saved" },
  cancelled: { tone: "danger", key: "trips.notices.cancelled" },
  reinstated: { tone: "success", key: "trips.notices.reinstated" },
  crew: { tone: "success", key: "trips.notices.crew" },
  "crew-conflict": { tone: "danger", key: "trips.notices.crewConflict" },
  "note-added": { tone: "success", key: "trips.notices.noteAdded" },
  "note-deleted": { tone: "success", key: "trips.notices.noteDeleted" },
  "booking-removed": { tone: "success", key: "trips.notices.bookingRemoved" },
  "booking-removed-refunded": { tone: "success", key: "trips.notices.bookingRemovedRefunded" },
  "booking-removed-forfeit": { tone: "success", key: "trips.notices.bookingRemovedForfeit" },
  "booking-removed-refund-manual": {
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundManual",
  },
  "booking-removed-refund-failed": {
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundFailed",
  },
  "booking-removed-refund-review": {
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundReview",
  },
  "booking-removed-refund-owner": {
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundOwner",
  },
  "booking-restored": { tone: "success", key: "trips.notices.bookingRestored" },
  "booking-restore-full": { tone: "danger", key: "trips.notices.bookingRestoreFull" },
  "booking-restore-ratio": { tone: "danger", key: "trips.notices.bookingRestoreRatio" },
  "booking-restore-cancelled": { tone: "danger", key: "trips.notices.bookingRestoreCancelled" },
  "diver-added": { tone: "success", key: "trips.notices.diverAdded" },
  // Seated, but the waiver never left the building. Warning rather than
  // success: the booking is real and nothing needs undoing, yet the staffer
  // still owes the diver a link (src/app/actions/seat-diver-surfaces.ts).
  "diver-added-waiver-undelivered": {
    tone: "warning",
    key: "trips.notices.diverAddedWaiverUndelivered",
  },
  "diver-waitlisted": { tone: "success", key: "trips.notices.diverWaitlisted" },
  "identity-confirmed": { tone: "success", key: "trips.notices.identityConfirmed" },
  "contact-saved": { tone: "success", key: "trips.notices.contactSaved" },
  "contact-incomplete": { tone: "warning", key: "trips.notices.contactIncomplete" },
  "diver-invalid": { tone: "danger", key: "trips.notices.diverInvalid" },
  "diver-full": { tone: "danger", key: "trips.notices.diverFull" },
  "diver-waitlist-available": { tone: "danger", key: "trips.notices.diverWaitlistAvailable" },
  "diver-already": { tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": { tone: "danger", key: "trips.notices.diverCourseUnstaffed" },
  "diver-course-prerequisite": { tone: "danger", key: "trips.notices.diverCoursePrerequisite" },
  "diver-course-ratio-full": { tone: "danger", key: "trips.notices.diverCourseRatioFull" },
  "diver-course-min-age": { tone: "danger", key: "trips.notices.diverCourseMinAge" },
  "diver-unavailable": { tone: "danger", key: "trips.notices.diverUnavailable" },
  "waiver-complete": { tone: "success", key: "trips.notices.waiverComplete" },
  "waiver-in-person": { tone: "success", key: "trips.notices.waiverInPerson" },
  "waiver-medical-attestation": { tone: "danger", key: "trips.notices.waiverMedicalAttestation" },
  "waiver-error": { tone: "danger", key: "trips.notices.waiverError" },
  "series-applied": { tone: "success", key: "trips.notices.seriesApplied" },
  "series-applied-partial": { tone: "success", key: "trips.notices.seriesAppliedPartial" },
  "series-cancelled": { tone: "danger", key: "trips.notices.seriesCancelled" },
  "series-extended": { tone: "success", key: "trips.notices.seriesExtended" },
  "series-error": { tone: "danger", key: "trips.notices.seriesError" },
  "recap-note": { tone: "success", key: "trips.notices.recapNote" },
  "recap-photo-removed": { tone: "success", key: "trips.notices.recapPhotoRemoved" },
  requirements: { tone: "success", key: "trips.notices.requirements" },
  payment: { tone: "success", key: "trips.notices.payment" },
  conditions: { tone: "success", key: "trips.notices.conditions" },
  "conditions-cleared": { tone: "success", key: "trips.notices.conditionsCleared" },
  "not-authorized": { tone: "danger", key: "trips.notices.notAuthorized" },
  invalid: { tone: "danger", key: "trips.notices.invalid" },
  "end-before-start": { tone: "danger", key: "trips.notices.endBeforeStart" },
  "capacity-below-booked": {
    tone: "danger",
    key: "trips.notices.capacityBelowBooked",
    countKey: "trips.notices.capacityBelowBookedCount",
  },
  "last-minute-sent": {
    tone: "success",
    key: "trips.notices.lastMinuteSent",
    countKey: "trips.notices.lastMinuteSentCount",
  },
  "last-minute-invalid-discount": {
    tone: "danger",
    key: "trips.notices.lastMinuteInvalidDiscount",
  },
  "last-minute-trip-unavailable": {
    tone: "danger",
    key: "trips.notices.lastMinuteTripUnavailable",
  },
  "last-minute-trip-full": { tone: "danger", key: "trips.notices.lastMinuteTripFull" },
  "last-minute-not-connected": { tone: "danger", key: "trips.notices.lastMinuteNotConnected" },
  "last-minute-no-recipients": { tone: "danger", key: "trips.notices.lastMinuteNoRecipients" },
  "last-minute-stripe-failed": { tone: "danger", key: "trips.notices.lastMinuteStripeFailed" },
  "planned-dives-below-history": {
    tone: "danger",
    key: "trips.notices.plannedDivesBelowHistory",
    countKey: "trips.notices.plannedDivesBelowHistoryCount",
  },
};

export function TripNoticeBanner({
  notice,
  count,
  locale,
  undoBookingId,
  undoAction,
}: {
  notice?: string;
  /** The specific count behind a "-below-" refusal notice, e.g. the booked count or recorded dive number. */
  count?: string;
  locale: string;
  undoBookingId?: string;
  // Only the roster's reversible removals carry an undo; Overview's config
  // notices render the same banner without one.
  undoAction?: (formData: FormData) => void;
}) {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return null;
  const t = staffTranslator(locale);
  const parsedCount = count !== undefined && /^\d+$/.test(count) ? Number(count) : undefined;
  const text =
    parsedCount !== undefined && banner.countKey
      ? t(banner.countKey, { count: parsedCount })
      : t(banner.key);
  return (
    <div className="mt-6">
      <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)}>
        <div className="flex items-center justify-between gap-3">
          <span>{text}</span>
          {undoBookingId && undoAction ? (
            <form action={undoAction}>
              <input type="hidden" name="bookingId" value={undoBookingId} />
              <SubmitButton
                pendingLabel={t("trips.notices.undoing")}
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 font-semibold underline-offset-2 hover:underline"
              >
                {t("trips.notices.undo")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </ShopNotice>
    </div>
  );
}
