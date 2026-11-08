/** Registry inverse refusals must remain visible even when a feature is now hidden. */
export const TRIP_UNDO_NOTICES = {
  "conservation-undo-failed": {
    form: "page",
    tone: "danger",
    key: "trips.conservation.undoFailed",
  },
  "teaching-note-undo-failed": {
    form: "page",
    tone: "danger",
    key: "trips.coursePulse.undoFailed",
  },
} as const;
