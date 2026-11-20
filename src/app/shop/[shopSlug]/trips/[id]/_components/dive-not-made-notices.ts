/**
 * The notices a dive recorded not made, or undone, answers with from Wrapped up
 * (issue #4681). Their own file keeps `trip-notice-resolution.ts` under the
 * file-length limit.
 */
export const DIVE_NOT_MADE_NOTICES = {
  "dive-not-made": { form: "close-out", tone: "success", key: "trips.notices.diveNotMade" },
  "dive-not-made-undone": {
    form: "close-out",
    tone: "success",
    key: "trips.notices.diveNotMadeUndone",
  },
  "dive-not-made-not-crew": {
    form: "close-out",
    tone: "danger",
    key: "trips.notices.diveNotMadeNotCrew",
  },
  "dive-not-made-counted": {
    form: "close-out",
    tone: "danger",
    key: "trips.notices.diveNotMadeCounted",
  },
  "dive-not-made-logged": {
    form: "close-out",
    tone: "danger",
    key: "trips.notices.diveNotMadeLogged",
  },
  "dive-not-made-not-left": {
    form: "close-out",
    tone: "danger",
    key: "trips.notices.diveNotMadeNotLeft",
  },
  "dive-not-made-stale": {
    form: "close-out",
    tone: "danger",
    key: "trips.notices.diveNotMadeStale",
  },
} as const;
