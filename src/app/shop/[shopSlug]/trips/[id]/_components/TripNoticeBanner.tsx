import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { type FormNotice, noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";

/**
 * One entry per notice code, carrying its own tone, message key(s), and the
 * **form it belongs to** — same shape as
 * `divers/[personId]/_components/NoticeBanner.tsx`'s `NOTICE_KEYS`, plus that
 * last field. A handful of refusals also carry a specific count (how many
 * divers are already booked, how many the last-minute deal reached); those get
 * a second, pluralized key used only once the count is known.
 *
 * `form` is what stopped this page answering six forms in one banner under the
 * `<h1>`. A trip has its details, its conditions, its recap note, its
 * requirements, its crew, and its series all on one long page, and the
 * last-minute deal blast even redirects to `#last-minute-deal` — scrolling the
 * banner that answered it off the top of the screen. Each code now names the
 * form it came from, `resolveTripNotice` resolves it once, and the section
 * renders it in its own action row (`FormStatus`). `"page"` is left for the
 * genuinely page-level ones: a permission refusal, and the generic `invalid`
 * fallback that any of a dozen actions can emit (those pass an explicit
 * `?form=` so they land home anyway — see `tripNoticeForm`).
 */
const NOTICE_KEYS: Record<
  string,
  {
    form: string;
    tone: "success" | "danger" | "warning";
    key: StaffMessageKey;
    countKey?: StaffMessageKey;
  }
> = {
  saved: { form: "details", tone: "success", key: "trips.notices.saved" },
  cancelled: { form: "lifecycle", tone: "danger", key: "trips.notices.cancelled" },
  reinstated: { form: "lifecycle", tone: "success", key: "trips.notices.reinstated" },
  crew: { form: "crew", tone: "success", key: "trips.notices.crew" },
  "crew-conflict": { form: "crew", tone: "danger", key: "trips.notices.crewConflict" },
  "note-added": { form: "roster", tone: "success", key: "trips.notices.noteAdded" },
  "note-deleted": { form: "roster", tone: "success", key: "trips.notices.noteDeleted" },
  "booking-removed": { form: "roster", tone: "success", key: "trips.notices.bookingRemoved" },
  "booking-removed-refunded": {
    form: "roster",
    tone: "success",
    key: "trips.notices.bookingRemovedRefunded",
  },
  "booking-removed-forfeit": {
    form: "roster",
    tone: "success",
    key: "trips.notices.bookingRemovedForfeit",
  },
  "booking-removed-refund-manual": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundManual",
  },
  "booking-removed-refund-failed": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundFailed",
  },
  "booking-removed-refund-review": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundReview",
  },
  "booking-removed-refund-owner": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundOwner",
  },
  "booking-restored": { form: "roster", tone: "success", key: "trips.notices.bookingRestored" },
  "booking-restore-full": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRestoreFull",
  },
  "booking-restore-ratio": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRestoreRatio",
  },
  "booking-restore-cancelled": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRestoreCancelled",
  },
  "diver-added": { form: "add-diver", tone: "success", key: "trips.notices.diverAdded" },
  // Seated, but the waiver never left the building. Warning rather than
  // success: the booking is real and nothing needs undoing, yet the staffer
  // still owes the diver a link (src/app/actions/seat-diver-surfaces.ts).
  "diver-added-waiver-undelivered": {
    form: "add-diver",
    tone: "warning",
    key: "trips.notices.diverAddedWaiverUndelivered",
  },
  "diver-waitlisted": { form: "add-diver", tone: "success", key: "trips.notices.diverWaitlisted" },
  "identity-confirmed": { form: "roster", tone: "success", key: "trips.notices.identityConfirmed" },
  certified: { form: "roster", tone: "success", key: "trips.notices.certified" },
  "certify-failed": { form: "roster", tone: "danger", key: "trips.notices.certifyFailed" },
  "contact-saved": { form: "roster", tone: "success", key: "trips.notices.contactSaved" },
  "contact-incomplete": { form: "roster", tone: "warning", key: "trips.notices.contactIncomplete" },
  "diver-invalid": { form: "add-diver", tone: "danger", key: "trips.notices.diverInvalid" },
  "diver-full": { form: "add-diver", tone: "danger", key: "trips.notices.diverFull" },
  "diver-waitlist-available": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverWaitlistAvailable",
  },
  "diver-already": { form: "add-diver", tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCourseUnstaffed",
  },
  "diver-course-prerequisite": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCoursePrerequisite",
  },
  "diver-course-ratio-full": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCourseRatioFull",
  },
  "diver-course-min-age": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCourseMinAge",
  },
  "diver-trip-prerequisite": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverTripPrerequisite",
  },
  "diver-unavailable": { form: "add-diver", tone: "danger", key: "trips.notices.diverUnavailable" },
  "waiver-complete": { form: "roster", tone: "success", key: "trips.notices.waiverComplete" },
  // No `waiver-in-person` entry: recording a paper signature no longer
  // navigates, so there is no notice to carry. The card says it instead — the
  // control becomes "Signed on paper · <date>" where the finger just was.
  "waiver-medical-attestation": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.waiverMedicalAttestation",
  },
  "waiver-error": { form: "roster", tone: "danger", key: "trips.notices.waiverError" },
  "series-applied": { form: "series", tone: "success", key: "tripSeries.notices.seriesApplied" },
  "series-applied-partial": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesAppliedPartial",
  },
  "series-cancelled": { form: "series", tone: "danger", key: "tripSeries.notices.seriesCancelled" },
  "series-repeating": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesRepeating",
  },
  "series-cadence-saved": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesCadenceSaved",
  },
  // Warning, not success: the cadence saved, but the shop is now looking at
  // dates on the board that it no longer describes, and the next tap is theirs.
  "series-cadence-narrowed": {
    form: "series",
    tone: "warning",
    key: "tripSeries.notices.seriesCadenceNarrowed",
  },
  "series-off-cadence-cancelled": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesOffCadenceCancelled",
  },
  "series-stopped": { form: "series", tone: "success", key: "tripSeries.notices.seriesStopped" },
  "series-error": { form: "series", tone: "danger", key: "tripSeries.notices.seriesError" },
  "recap-note": { form: "recap-note", tone: "success", key: "trips.notices.recapNote" },
  "recap-photo-removed": {
    form: "recap-photos",
    tone: "success",
    key: "trips.notices.recapPhotoRemoved",
  },
  requirements: { form: "requirements", tone: "success", key: "trips.notices.requirements" },
  // Saved, and it left booked divers behind. Warning rather than success: the
  // save worked and nothing needs undoing, but the staffer now owes those
  // divers a card, a conversation, or a different boat.
  "requirements-blocking": {
    form: "requirements",
    tone: "warning",
    key: "trips.notices.requirementsBlocking",
    countKey: "trips.notices.requirementsBlockingCount",
  },
  payment: { form: "roster", tone: "success", key: "trips.notices.payment" },
  conditions: { form: "conditions", tone: "success", key: "trips.notices.conditions" },
  "conditions-cleared": {
    form: "conditions",
    tone: "success",
    key: "trips.notices.conditionsCleared",
  },
  "not-authorized": { form: "page", tone: "danger", key: "trips.notices.notAuthorized" },
  invalid: { form: "page", tone: "danger", key: "trips.notices.invalid" },
  "end-before-start": { form: "details", tone: "danger", key: "trips.notices.endBeforeStart" },
  "capacity-below-booked": {
    form: "details",
    tone: "danger",
    key: "trips.notices.capacityBelowBooked",
    countKey: "trips.notices.capacityBelowBookedCount",
  },
  // This form has no boat field, so the refusal has to name the hull's number —
  // otherwise a staffer is told they are over a limit they cannot see.
  // A hull that is not this shop's live one. Reached only by a hand-built
  // submission or a boat deleted in another tab, so it reads as a plain
  // refusal rather than explaining a fleet the reader can see.
  "boat-not-found": { form: "details", tone: "danger", key: "trips.notices.boatNotFound" },
  "capacity-above-boat": {
    form: "details",
    tone: "danger",
    key: "trips.notices.capacityAboveBoat",
    countKey: "trips.notices.capacityAboveBoatCount",
  },
  // Both doors onto the same trap: a departure that demands payment and has no
  // price asks nobody for money and blocks every diver who books it, forever
  // (issue #692). Danger, not warning — the save was refused, so the staffer
  // has something to do before anything is stored.
  "price-required-by-gate": {
    form: "details",
    tone: "danger",
    key: "trips.notices.priceRequiredByGate",
  },
  "requirements-need-price": {
    form: "requirements",
    tone: "danger",
    key: "trips.notices.requirementsNeedPrice",
  },
  "last-minute-sent": {
    form: "last-minute-deal",
    tone: "success",
    key: "trips.notices.lastMinuteSent",
    countKey: "trips.notices.lastMinuteSentCount",
  },
  "last-minute-invalid-discount": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteInvalidDiscount",
  },
  "last-minute-trip-unavailable": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteTripUnavailable",
  },
  "last-minute-trip-full": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteTripFull",
  },
  "last-minute-not-connected": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteNotConnected",
  },
  "last-minute-no-recipients": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteNoRecipients",
  },
  "last-minute-stripe-failed": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteStripeFailed",
  },
  "planned-dives-below-history": {
    form: "details",
    tone: "danger",
    key: "trips.notices.plannedDivesBelowHistory",
    countKey: "trips.notices.plannedDivesBelowHistoryCount",
  },
};

/** Every form name `NOTICE_KEYS` (or an action's `?form=`) may point at. */
const TRIP_FORMS = new Set([
  "page",
  "details",
  "conditions",
  "recap-note",
  "recap-photos",
  "requirements",
  "crew",
  "series",
  "lifecycle",
  "add-diver",
  "roster",
  "last-minute-deal",
]);

/**
 * Which form a `?form=` param names, ignoring anything not in `TRIP_FORMS` —
 * a query param is attacker-supplied, and an unknown name must degrade to the
 * code's own default home rather than swallowing the notice into a section
 * nothing renders.
 */
function tripNoticeForm(param: string | undefined, fallback: string): string {
  return param !== undefined && TRIP_FORMS.has(param) ? param : fallback;
}

export type TripNoticeInput = {
  notice?: string;
  /** The specific count behind a "-below-" refusal notice, e.g. the booked count or recorded dive number. */
  count?: string;
  /**
   * Which form on the page this notice answers, when the code alone cannot say
   * — `?notice=invalid` is emitted by the details editor, the conditions
   * briefing, the recap note, and the payment control alike.
   */
  form?: string;
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
};

/**
 * Resolves the page's `?notice=` to words and to the form those words belong
 * beside. Both trip pages call this once and hand the result to the section it
 * names (`noticeForForm`); whatever is left over — a genuinely page-level
 * refusal, or a section this staffer's role means the page never rendered —
 * falls through to `TripNoticeBanner`.
 */
export function resolveTripNotice({
  notice,
  count,
  form,
  gate,
  tripId,
  locale,
}: TripNoticeInput): FormNotice | undefined {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return undefined;
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
  return { form: tripNoticeForm(form, banner.form), tone: banner.tone, text };
}

/**
 * The page-level banner, now only for what has no form to sit beside: a
 * permission refusal, and the roster's per-diver outcomes, whose undo control
 * this still carries.
 */
export function TripNoticeBanner({
  notice,
  locale,
  undoBookingId,
  undoAction,
}: {
  notice?: FormNotice;
  locale: string;
  undoBookingId?: string;
  // Only the roster's reversible removals carry an undo; Overview's config
  // notices render the same banner without one.
  undoAction?: (formData: FormData) => void;
}) {
  if (!notice) return null;
  const t = staffTranslator(locale);
  return (
    <div className="mt-6">
      <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
        <div className="flex items-center justify-between gap-3">
          <span>{notice.text}</span>
          {undoBookingId && undoAction ? (
            <form action={undoAction}>
              <input type="hidden" name="bookingId" value={undoBookingId} />
              {/* The `link` variant is exactly what this hand-rolled string was
                  reaching for — reads as inline text, still claims a full 44px
                  target — so it goes through `buttonClass` like every other
                  button-shaped thing (docs/design/forms-and-controls.md).
                  `busy`, because a `SubmitButton` disables itself only while its
                  own submit is in flight, and the default not-allowed cursor
                  reads as a refusal at the moment the undo was accepted. The one
                  thing that changes on screen: the label now takes the link
                  colour rather than inheriting the notice's tone, which is how
                  every other undo/inline action in the app already reads. */}
              <SubmitButton
                pendingLabel={t("trips.notices.undoing")}
                className={buttonClass({
                  variant: "link",
                  size: "sm",
                  busy: true,
                  className: "font-semibold underline-offset-2",
                })}
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
