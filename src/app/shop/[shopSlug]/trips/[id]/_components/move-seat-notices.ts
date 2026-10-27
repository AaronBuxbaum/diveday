export const MOVE_SEAT_NOTICES = {
  "seat-moved-fly-safe-unreached": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.seatMovedFlySafeUnreached",
  },
  "seat-moved-owed-fly-safe-unreached": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.seatMovedOwedFlySafeUnreached",
  },
  "seat-moved": { form: "roster", tone: "success", key: "trips.notices.seatMoved" },
  "seat-moved-untold": { form: "roster", tone: "warning", key: "trips.notices.seatMovedUntold" },
  "seat-moved-owed": { form: "roster", tone: "warning", key: "trips.notices.seatMovedOwed" },
} as const;
