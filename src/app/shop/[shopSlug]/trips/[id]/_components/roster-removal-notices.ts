/** Refusals when a seat may still be on the water. */
export const ROSTER_REMOVAL_NOTICES = {
  "booking-remove-aboard": {
    form: "roster",
    tone: "danger",
    key: "trips.roster.removeAboard",
    named: true,
  },
  "booking-remove-uncounted": {
    form: "roster",
    tone: "danger",
    key: "trips.roster.removeUncounted",
    named: true,
  },
  "booking-remove-presence-uncertain": {
    form: "roster",
    tone: "danger",
    key: "trips.roster.removePresenceUncertain",
    named: true,
  },
} as const;
