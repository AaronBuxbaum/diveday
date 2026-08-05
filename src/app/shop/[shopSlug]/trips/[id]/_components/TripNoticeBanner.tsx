import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";

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
  saved: { form: "details", tone: "success", key: "trips.notices.saved" },
  cancelled: { form: "lifecycle", tone: "danger", key: "trips.notices.cancelled" },
  reinstated: { form: "lifecycle", tone: "success", key: "trips.notices.reinstated" },
  crew: { form: "crew", tone: "success", key: "trips.notices.crew" },
  "crew-conflict": { form: "crew", tone: "danger", key: "trips.notices.crewConflict" },
  "note-added": { form: "roster", tone: "success", key: "trips.notices.noteAdded" },
  "note-deleted": { form: "roster", tone: "success", key: "trips.notices.noteDeleted" },
  "booking-removed": { form: "roster", tone: "success", key: "trips.notices.bookingRemoved" },
  "booking-removed-refunded": { form: "roster", tone: "success", key: "trips.notices.bookingRemovedRefunded" },
  "booking-removed-forfeit": { form: "roster", tone: "success", key: "trips.notices.bookingRemovedForfeit" },
  "booking-removed-refund-manual": { form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundManual",
  },
  "booking-removed-refund-failed": { form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundFailed",
  },
  "booking-removed-refund-review": { form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundReview",
  },
  "booking-removed-refund-owner": { form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundOwner",
  },
  "booking-restored": { form: "roster", tone: "success", key: "trips.notices.bookingRestored" },
  "booking-restore-full": { form: "roster", tone: "danger", key: "trips.notices.bookingRestoreFull" },
  "booking-restore-ratio": { form: "roster", tone: "danger", key: "trips.notices.bookingRestoreRatio" },
  "booking-restore-cancelled": { form: "roster", tone: "danger", key: "trips.notices.bookingRestoreCancelled" },
  "diver-added": { form: "add-diver", tone: "success", key: "trips.notices.diverAdded" },
  // Seated, but the waiver never left the building. Warning rather than
  // success: the booking is real and nothing needs undoing, yet the staffer
  // still owes the diver a link (src/app/actions/seat-diver-surfaces.ts).
  "diver-added-waiver-undelivered": { form: "add-diver",
    tone: "warning",
    key: "trips.notices.diverAddedWaiverUndelivered",
  },
  "diver-waitlisted": { form: "add-diver", tone: "success", key: "trips.notices.diverWaitlisted" },
  "identity-confirmed": { form: "roster", tone: "success", key: "trips.notices.identityConfirmed" },
  "contact-saved": { form: "roster", tone: "success", key: "trips.notices.contactSaved" },
  "contact-incomplete": { form: "roster", tone: "warning", key: "trips.notices.contactIncomplete" },
  "diver-invalid": { form: "add-diver", tone: "danger", key: "trips.notices.diverInvalid" },
  "diver-full": { form: "add-diver", tone: "danger", key: "trips.notices.diverFull" },
  "diver-waitlist-available": { form: "add-diver", tone: "danger", key: "trips.notices.diverWaitlistAvailable" },
  "diver-already": { form: "add-diver", tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": { form: "add-diver", tone: "danger", key: "trips.notices.diverCourseUnstaffed" },
  "diver-course-prerequisite": { form: "add-diver", tone: "danger", key: "trips.notices.diverCoursePrerequisite" },
  "diver-course-ratio-full": { form: "add-diver", tone: "danger", key: "trips.notices.diverCourseRatioFull" },
  "diver-course-min-age": { form: "add-diver", tone: "danger", key: "trips.notices.diverCourseMinAge" },
  "diver-trip-prerequisite": { form: "add-diver", tone: "danger", key: "trips.notices.diverTripPrerequisite" },
  "diver-unavailable": { form: "add-diver", tone: "danger", key: "trips.notices.diverUnavailable" },
  "waiver-complete": { form: "roster", tone: "success", key: "trips.notices.waiverComplete" },
  "waiver-in-person": { form: "roster", tone: "success", key: "trips.notices.waiverInPerson" },
  "waiver-medical-attestation": { form: "roster", tone: "danger", key: "trips.notices.waiverMedicalAttestation" },
  "waiver-error": { form: "roster", tone: "danger", key: "trips.notices.waiverError" },
  "series-applied": { form: "series", tone: "success", key: "trips.notices.seriesApplied" },
  "series-applied-partial": { form: "series", tone: "success", key: "trips.notices.seriesAppliedPartial" },
  "series-cancelled": { form: "series", tone: "danger", key: "trips.notices.seriesCancelled" },
  "series-extended": { form: "series", tone: "success", key: "trips.notices.seriesExtended" },
  "series-error": { form: "series", tone: "danger", key: "trips.notices.seriesError" },
  "recap-note": { form: "recap-note", tone: "success", key: "trips.notices.recapNote" },
  "recap-photo-removed": { form: "recap-photos", tone: "success", key: "trips.notices.recapPhotoRemoved" },
  requirements: { form: "requirements", tone: "success", key: "trips.notices.requirements" },
  // Saved, and it left booked divers behind. Warning rather than success: the
  // save worked and nothing needs undoing, but the staffer now owes those
  // divers a card, a conversation, or a different boat.
  "requirements-blocking": { form: "requirements",
    tone: "warning",
    key: "trips.notices.requirementsBlocking",
    countKey: "trips.notices.requirementsBlockingCount",
  },
  payment: { form: "roster", tone: "success", key: "trips.notices.payment" },
  conditions: { form: "conditions", tone: "success", key: "trips.notices.conditions" },
  "conditions-cleared": { form: "conditions", tone: "success", key: "trips.notices.conditionsCleared" },
  "not-authorized": { form: "page", tone: "danger", key: "trips.notices.notAuthorized" },
  invalid: { form: "page", tone: "danger", key: "trips.notices.invalid" },
  "end-before-start": { form: "details", tone: "danger", key: "trips.notices.endBeforeStart" },
  "capacity-below-booked": { form: "details",
    tone: "danger",
    key: "trips.notices.capacityBelowBooked",
    countKey: "trips.notices.capacityBelowBookedCount",
  },
  "last-minute-sent": { form: "last-minute-deal",
    tone: "success",
    key: "trips.notices.lastMinuteSent",
    countKey: "trips.notices.lastMinuteSentCount",
  },
  "last-minute-invalid-discount": { form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteInvalidDiscount",
  },
  "last-minute-trip-unavailable": { form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteTripUnavailable",
  },
  "last-minute-trip-full": { form: "last-minute-deal", tone: "danger", key: "trips.notices.lastMinuteTripFull" },
  "last-minute-not-connected": { form: "last-minute-deal", tone: "danger", key: "trips.notices.lastMinuteNotConnected" },
  "last-minute-no-recipients": { form: "last-minute-deal", tone: "danger", key: "trips.notices.lastMinuteNoRecipients" },
  "last-minute-stripe-failed": { form: "last-minute-deal", tone: "danger", key: "trips.notices.lastMinuteStripeFailed" },
  "planned-dives-below-history": { form: "details",
    tone: "danger",
    key: "trips.notices.plannedDivesBelowHistory",
    countKey: "trips.notices.plannedDivesBelowHistoryCount",
  },
};

export function TripNoticeBanner({
  notice,
  count,
  gate,
  tripId,
  locale,
  undoBookingId,
  undoAction,
}: {
  notice?: string;
  /** The specific count behind a "-below-" refusal notice, e.g. the booked count or recorded dive number. */
  count?: string;
  /**
   * The signed `TripAdmissionRefusal` behind `diver-trip-prerequisite` — which
   * requirement the trip's cert gate failed on and what the diver holds
   * (src/lib/trip-admission-gate.ts). Absent, unsigned, or signed for a
   * different departure all fall back to the notice's own generic sentence,
   * never to a blank banner and never to the specific one. Typed to admit the
   * `string[]` a repeated `?gate=` really delivers.
   */
  gate?: string | string[];
  /**
   * The departure this page *is*, read from its own path — what the signature
   * is checked against, so a genuine refusal from another boat cannot be
   * pasted onto this one.
   */
  tripId: string;
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
  const refusal =
    notice === "diver-trip-prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "trip", id: tripId })
      : null;
  const text = refusal
    ? tripAdmissionRefusalText(t, refusal, locale)
    : parsedCount !== undefined && banner.countKey
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
