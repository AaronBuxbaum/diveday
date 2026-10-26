// i18n-exempt-file: test fixture; only the staffing week's tests import it, and its words are the bundle's English.
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import type { AvailabilityBlock, CrewAssignmentRequest } from "@/lib/crew-requests";
import { staffWeek, type WeekGap, type WeekPerson } from "@/lib/staffing-week";
import { type GapWords, StaffingWeek, type StaffingWeekWords } from "./StaffingWeek";

/** The staffing week's shared fixtures: a Key Largo week, its words, and one render. */
export const TZ = "America/New_York";
export const MONDAY = "2026-08-24";
export const THURSDAY = "2026-08-27";

export const WORDS: StaffingWeekWords = {
  ariaLabel: "Who’s working",
  previous: "Previous week",
  next: "Next week",
  thisWeek: "This week",
  today: "Today",
  print: "Print",
  person: "Person",
  needsCrew: "Needs crew",
  shiftsAndAway: "Shifts and days away",
  assign: "Assign",
  assignAria: "Assign crew to {trip}",
  crewing: "Crewing",
  remove: "Remove",
  removing: "Removing…",
  shiftAria: "Shift for {person} on {day}",
  empty: "Nothing scheduled this week.",
  away: "Away",
  awayConflict: "Away {dates}",
  crewClash: "Also rostered on {departure}",
  request: "Ask for this one",
  requestAria: "Ask to work {trip}",
  requesting: "Asking…",
  requested: "{person} asked",
  approve: "Approve",
  decline: "Decline",
  deciding: "Saving…",
  requestApproved: "Approved",
  requestDeclined: "Declined",
  askWontClose: "You add no seats to this session. Only another instructor does.",
  requestWontClose: "Approving this one won’t close the gap. Only an instructor adds seats.",
  ratingLapsed: "A crew rating isn’t current",
  continuedUntil: "until {time} · from {day}",
  continuedFrom: "from {day}",
};

export const GAP_WORDS: GapWords = {
  no_instructor: "This course session has no instructor yet",
  over_ratio: "More divers booked than the crew can supervise",
  over_intro_ratio: "Over intro ratio",
  over_ratio_instructor: "Over student ratio: add an instructor",
  uncrewed_course: "No instructor or crew",
  uncrewed_departure: "No divemaster",
  crew_below_target: "Under target",
};

export const KEIKO: WeekPerson = {
  personId: "person-1",
  name: "Keiko Tanaka",
  roles: ["Divemaster"],
  // Thursday 6:30 AM – 12:00 PM, Key Largo.
  shifts: [
    {
      id: "shift-1",
      startsAt: new Date("2026-08-27T10:30:00.000Z"),
      endsAt: new Date("2026-08-27T16:00:00.000Z"),
      note: "Dock",
    },
  ],
  crewingTrips: [],
};

export function renderWeek({
  people = [KEIKO],
  gaps = [],
  canManage = true,
  canDecide = true,
  blocks = [],
  requests = [],
  viewer,
}: {
  people?: WeekPerson[];
  gaps?: WeekGap[];
  canManage?: boolean;
  canDecide?: boolean;
  blocks?: AvailabilityBlock[];
  requests?: CrewAssignmentRequest[];
  viewer?: { personId: string; isCrew: boolean; holdsInstructorRole: boolean };
} = {}) {
  const week = staffWeek({
    people,
    gaps,
    weekStart: MONDAY,
    timeZone: TZ,
    today: THURSDAY,
    blocks,
    requests,
    viewer,
    // Before every meeting in these fixtures, so a departure is never "past".
    now: new Date("2026-08-20T00:00:00.000Z"),
  });
  return render(
    <StaffingWeek
      week={week}
      gapWords={GAP_WORDS}
      words={WORDS}
      links={{
        rangeLabel: "Aug 24 – 30, 2026",
        previousHref: "/shop/blue-mantis/staffing?week=2026-08-17",
        nextHref: "/shop/blue-mantis/staffing?week=2026-08-31",
        thisWeekHref: null,
      }}
      // The source locale: these tests read the English bundle.
      locale={DEFAULT_DIVER_LOCALE}
      timeZone={TZ}
      shopSlug="blue-mantis"
      canManage={canManage}
      canDecide={canDecide}
      deleteShiftAction={vi.fn()}
      requestAction={vi.fn()}
      decideRequestAction={vi.fn()}
    />,
  );
}
