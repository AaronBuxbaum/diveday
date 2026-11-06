/**
 * The departure details form's save refusals (`editTrip`, `tripDetailsPatch`),
 * spread into `trip-notice-resolution.ts`'s `NOTICE_KEYS`. Each answers the
 * details form, and the ones that carry a number name it, because the form
 * shows neither the booked count nor the hull's limits.
 */
export const DETAILS_SAVE_NOTICES = {
  "end-before-start": { form: "details", tone: "danger", key: "trips.notices.endBeforeStart" },
  "days-out-of-order": { form: "details", tone: "danger", key: "trips.notices.daysOutOfOrder" },
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
  // H-20261009-certificate-caps-seats: the hull's certificate is a ceiling too, and this form shows
  // neither number, so the refusal names the limit.
  "capacity-above-certificate": {
    form: "details",
    tone: "danger",
    key: "trips.notices.capacityAboveCertificate",
    countKey: "trips.notices.capacityAboveCertificateCount",
  },
  // Loop 5, row 5: the hull is in the yard on a day this departure holds it,
  // named when the redirect carries it (issue #4026): it need not be the day
  // the departure leaves.
  "boat-out-of-service": {
    form: "details",
    tone: "danger",
    key: "trips.notices.boatOutOfService",
    onKey: "trips.notices.boatOutOfServiceOn",
  },
  "planned-dives-below-history": {
    form: "details",
    tone: "danger",
    key: "trips.notices.plannedDivesBelowHistory",
    countKey: "trips.notices.plannedDivesBelowHistoryCount",
  },
  "meeting-day-has-roll-call": {
    form: "details",
    tone: "danger",
    key: "trips.notices.meetingDayHasRollCall",
    countKey: "trips.notices.meetingDayHasRollCallCount",
  },
} as const;
