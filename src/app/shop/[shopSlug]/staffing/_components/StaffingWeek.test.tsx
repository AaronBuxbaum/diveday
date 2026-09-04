// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailabilityBlock, CrewAssignmentRequest } from "@/lib/crew-requests";
import { staffWeek, type WeekGap, type WeekPerson } from "@/lib/staffing-week";
import { type GapWords, StaffingWeek, type StaffingWeekWords } from "./StaffingWeek";

afterEach(cleanup);

/**
 * Slice 9e of ADR 20260827-the-shops-shelves, pinned as rules rather than
 * pixels. The decision this file guards, in its own words: "a departure
 * needing crew renders in its day cell with the warning word **and its act**
 * (Assign → the trip's crew section)". Everything below is one half of that
 * sentence.
 */

const TZ = "America/New_York";
const MONDAY = "2026-08-24";
const THURSDAY = "2026-08-27";

const WORDS: StaffingWeekWords = {
  ariaLabel: "Who's working",
  previous: "Previous week",
  next: "Next week",
  thisWeek: "This week",
  today: "Today",
  person: "Person",
  needsCrew: "Needs crew",
  assign: "Assign",
  assignAria: "Assign crew to {trip}",
  crewing: "Crewing",
  remove: "Remove",
  removing: "Removing…",
  shiftAria: "Shift for {person} on {day}",
  empty: "Nothing scheduled this week.",
  away: "Away",
  awayConflict: "Away {dates}",
  request: "Ask for this one",
  requestAria: "Ask to work {trip}",
  requesting: "Asking…",
  requested: "{person} asked",
  approve: "Approve",
  decline: "Decline",
  deciding: "Saving…",
  requestApproved: "Approved",
  requestDeclined: "Declined",
};

const GAP_WORDS: GapWords = {
  no_instructor: "This course session has no instructor yet",
  over_ratio: "More divers booked than the crew can supervise",
  uncrewed_course: "No instructor or crew",
  uncrewed_departure: "Nobody in the water",
  crew_below_target: "Under target",
};

const KEIKO: WeekPerson = {
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

function renderWeek({
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
  viewer?: { personId: string; isCrew: boolean };
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
      locale="en-US"
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

const GAP: WeekGap = {
  tripId: "trip-gap",
  title: "Spiegel Grove",
  gap: "uncrewed_departure",
  // 1:00 PM Thursday, Key Largo.
  meetings: [
    {
      startsAt: new Date("2026-08-27T17:00:00.000Z"),
      endsAt: new Date("2026-08-27T21:00:00.000Z"),
    },
  ],
};

describe("StaffingWeek", () => {
  it("renders a crew gap with its word and its act, in the day it sails", () => {
    renderWeek({ gaps: [GAP] });

    // The word, not the hue: every colour-carried state also carries one.
    expect(screen.getAllByText("Nobody in the water").length).toBeGreaterThan(0);
    // And the act, named for the departure it belongs to, pointing at that
    // trip's crew section rather than at a nav tab.
    for (const link of screen.getAllByRole("link", { name: "Assign crew to Spiegel Grove" })) {
      expect(link).toHaveAttribute("href", "/shop/blue-mantis/trips/trip-gap#crew");
    }
    // Thursday, in the shop's zone — not the 5:00 PM the host would read.
    expect(screen.getAllByText("1:00 PM").length).toBeGreaterThan(0);
  });

  it("says nothing about crew when every departure has some", () => {
    renderWeek();

    // The gap row is absent rather than empty: seven blank cells under
    // "Needs crew" is the page saying nothing at the volume of something.
    expect(screen.queryByText("Needs crew")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Assign crew to/ })).toBeNull();
  });

  it("renders a shift in the shop's own zone, under the day it starts in", () => {
    renderWeek();

    // 10:30 UTC is 6:30 AM in Key Largo. A host-zone render would say 10:30 AM
    // and no test on a UTC box would notice.
    expect(screen.getAllByText("6:30 AM – 12:00 PM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dock").length).toBeGreaterThan(0);
  });

  it("gives a manager the shift's one act and everyone else none", () => {
    const managed = renderWeek({ canManage: true });
    expect(screen.getAllByRole("button", { name: "Remove" }).length).toBeGreaterThan(0);
    managed.unmount();

    renderWeek({ canManage: false });
    // A control that refuses is worse than a control that is not there.
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    // The week itself is still readable — the crew needs to see who is on.
    expect(screen.getAllByText("6:30 AM – 12:00 PM").length).toBeGreaterThan(0);
  });

  it("puts a crewed departure in its person's day cell, with a door to the boat", () => {
    renderWeek({
      people: [
        {
          ...KEIKO,
          shifts: [],
          crewingTrips: [
            {
              tripId: "trip-7",
              title: "Dawn Two-Tank",
              meetings: [
                {
                  startsAt: new Date("2026-08-27T11:00:00.000Z"),
                  endsAt: new Date("2026-08-27T15:00:00.000Z"),
                },
              ],
            },
          ],
        },
      ],
    });

    // A boat somebody crews with no shift against it is exactly the state the
    // cross-link exists to show; it must not be swallowed by the empty cell.
    const doors = screen.getAllByRole("link", { name: /Dawn Two-Tank/ });
    expect(doors.length).toBeGreaterThan(0);
    for (const door of doors) {
      expect(door).toHaveAttribute("href", "/shop/blue-mantis/trips/trip-7#crew");
    }
  });

  /**
   * The shop's own divemaster target "binds nothing"
   * (src/lib/divemaster-ratio.ts) — Today ranks it with the advisory rows and
   * gives it a neutral tone. Drawn here in the warning fill reserved for a boat
   * with nobody in the water, it would spend the one alarm channel this surface
   * has on a nudge, which is the failure `crewShiftCoverage` already guards
   * against next door.
   */
  it("draws the shop's own target quietly and an uncrewed boat loudly", () => {
    const under = renderWeek({
      gaps: [{ ...GAP, gap: "crew_below_target" }],
    });
    expect(screen.getAllByText("Under target").length).toBeGreaterThan(0);
    // The word is always present; only the volume changes. No warning fill and
    // no warning glyph on advice.
    expect(under.container.querySelector(".bg-warning-tint")).toBeNull();
    under.unmount();

    const uncrewed = renderWeek({ gaps: [GAP] });
    expect(uncrewed.container.querySelector(".bg-warning-tint")).not.toBeNull();
  });

  it("names the current day with a word as well as an ink", () => {
    const { container } = renderWeek();

    const grid = within(container).getAllByText("Today");
    expect(grid.length).toBeGreaterThan(0);
  });
});
