import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { NoticeTone } from "@/lib/staff-notices";

export const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  duplicate: { tone: "danger", key: "divers.page.noticeDuplicate" },
  invalid: { tone: "danger", key: "divers.page.noticeInvalid" },
  "diver-full": { tone: "danger", key: "trips.notices.diverFull" },
  "diver-divers-full": { tone: "danger", key: "participants.notices.diversFull" },
  "diver-type-unavailable": { tone: "danger", key: "participants.notices.typeUnavailable" },
  "diver-already": { tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": { tone: "danger", key: "trips.notices.diverCourseUnstaffed" },
  "diver-course-prerequisite": { tone: "danger", key: "trips.notices.diverCoursePrerequisite" },
  "diver-course-ratio-full": { tone: "danger", key: "trips.notices.diverCourseRatioFull" },
  "diver-course-min-age": { tone: "danger", key: "trips.notices.diverCourseMinAge" },
  "diver-trip-prerequisite": { tone: "danger", key: "trips.notices.diverTripPrerequisite" },
  "diver-unavailable": { tone: "danger", key: "trips.notices.diverUnavailable" },
  "diver-date-request-conflict": {
    tone: "danger",
    key: "trips.notices.diverDateRequestConflict",
  },
  "diver-date-request-unavailable": {
    tone: "danger",
    key: "trips.notices.diverDateRequestUnavailable",
  },
  "diver-date-request-full": {
    tone: "danger",
    key: "trips.notices.diverDateRequestFull",
  },
  "diver-invalid": { tone: "danger", key: "divers.page.noticeInvalid" },
  "seat-busy": { tone: "danger", key: "seatDiver.busy" },
  // A walk-in party with names that read like somebody on file (fifth loop,
  // item 9): each such row is settled on its own, below.
  "party-on-file": { tone: "danger", key: "divers.page.partyOnFile" },
};
