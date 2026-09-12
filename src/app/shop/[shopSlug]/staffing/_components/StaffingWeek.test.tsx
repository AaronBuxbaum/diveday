// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
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
  ariaLabel: "Who’s working",
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
  crewClash: "Also on {departure}: cannot be on both",
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
};

const GAP_WORDS: GapWords = {
  no_instructor: "This course session has no instructor yet",
  over_ratio: "More divers booked than the crew can supervise",
  over_intro_ratio: "Over intro ratio",
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

  /**
   * Issue #1339. "Ask for this one" beside "Over intro ratio" read, to a
   * divemaster, as the control that closes the gap. It is not: an intro
   * session's cap is instructor-to-student and a divemaster adds no seats.
   * The ask stays — the owner chose to warn, not to refuse — and the warning
   * is drawn in both layouts, because the phone loses the columns and never
   * the work.
   *
   * **The sentence claims the ratio, never the shop's options.** It shipped as
   * "Only another instructor closes this gap", which is false: the gap is
   * `booked > capacity` (src/lib/course-ratios.ts), so a manager also closes
   * it by moving one intro participant to the afternoon — which is exactly
   * what a one-instructor shop with three walk-ups does at 07:00. Told "only
   * another instructor" with no other instructor within forty minutes, a crew
   * learns to skim the warning channel. The siblings had it right all along
   * (`trips.pulse.overRatioWarningIntro`, `today.overRatioIntro`): what is
   * true of the cap is that a non-instructor adds no seats to it.
   */
  it("tells a divemaster their ask adds no seats to an intro-ratio gap", () => {
    const dm = renderWeek({
      gaps: [{ ...GAP, gap: "over_intro_ratio" }],
      viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: false },
    });

    // Both layouts render at once in jsdom; the note appears in each.
    expect(screen.getAllByText(WORDS.askWontClose).length).toBe(2);
    // The fixture is the shipped sentence, in both locales, and what each one
    // claims is the cap — what the reader does not add — never a monopoly on
    // the fix.
    expect(WORDS.askWontClose).toBe(staffTranslator("en-US")("staffing.week.askWontClose"));
    expect(WORDS.askWontClose).toContain("no seats");
    expect(WORDS.askWontClose).not.toMatch(/closes this gap/);
    const es = staffTranslator("es-ES")("staffing.week.askWontClose");
    expect(es).toContain("plazas");
    expect(es).not.toMatch(/cierra/);
    // And it is a note on the act, not a replacement for it.
    expect(screen.getAllByRole("button", { name: "Ask to work Spiegel Grove" }).length).toBe(2);
    dm.unmount();

    // The reader who can close it is told nothing.
    const instructor = renderWeek({
      gaps: [{ ...GAP, gap: "over_intro_ratio" }],
      viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: true },
    });
    expect(screen.queryByText(WORDS.askWontClose)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ask to work Spiegel Grove" }).length).toBe(2);
    instructor.unmount();

    // Neither is the entry-level cap, which a certified assistant does raise.
    renderWeek({
      gaps: [{ ...GAP, gap: "over_ratio" }],
      viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: false },
    });
    expect(screen.queryByText(WORDS.askWontClose)).toBeNull();
  });

  /**
   * Issue #1339's other reader. The decider is the one person on this surface
   * who can close an intro-ratio gap, and the queue told them nothing: a name,
   * Approve, Decline, and then "Approved, and they're on the crew" about a
   * session still over ratio.
   */
  it("tells the decider, beside Approve, when approving would not close the gap", () => {
    const ask = (overrides: Partial<CrewAssignmentRequest> = {}): CrewAssignmentRequest => ({
      id: "r1",
      tripId: GAP.tripId,
      personId: "person-2",
      personName: "Sal Moretti",
      inWaterRole: "certified_assistant",
      state: "pending",
      requestedAt: new Date("2026-08-20T00:00:00.000Z"),
      ...overrides,
    });
    const sentence = "Approving this one won’t close the gap. Only an instructor adds seats.";

    const divemaster = renderWeek({
      gaps: [{ ...GAP, gap: "over_intro_ratio" }],
      requests: [ask()],
    });
    // Both layouts, and the buttons are still there — it informs, never gates.
    expect(screen.getAllByText(sentence).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBe(2);
    divemaster.unmount();

    // An instructor's ask does close it, so nothing is said.
    const instructor = renderWeek({
      gaps: [{ ...GAP, gap: "over_intro_ratio" }],
      requests: [ask({ inWaterRole: "instructor" })],
    });
    expect(screen.queryByText(sentence)).toBeNull();
    instructor.unmount();

    // And the entry-level cap, which a certified assistant does raise.
    const entryLevel = renderWeek({
      gaps: [{ ...GAP, gap: "over_ratio" }],
      requests: [ask()],
    });
    expect(screen.queryByText(sentence)).toBeNull();
    entryLevel.unmount();

    // It is a note on Approve, so a reader with no Approve to press — the rest
    // of the crew, reading the same week — is told nothing.
    renderWeek({
      gaps: [{ ...GAP, gap: "over_intro_ratio" }],
      requests: [ask()],
      canDecide: false,
    });
    expect(screen.queryByText(sentence)).toBeNull();
  });

  it("names the current day with a word as well as an ink", () => {
    const { container } = renderWeek();

    const grid = within(container).getAllByText("Today");
    expect(grid.length).toBeGreaterThan(0);
  });
});

/**
 * **The clash a week-planning manager was never shown** (issue #1695). One
 * divemaster on two hulls at the same hours is a state `setTripCrew` refuses to
 * write, so a shop only reaches it through a write that moves the **boat**
 * without reading the roster — `moveTrip`, the departure's own Details form, or
 * reinstating a called-off boat (`crewClashes` names all three) — and the Move
 * panel that warned about the first of those closed the moment the move went
 * through, leaving the surface a shop actually plans the week on showing the
 * same person on both boats as if that were a shift pattern.
 */
describe("StaffingWeek standing crew clash", () => {
  /** Thursday, Key Largo: the 9:00 AM reef drift and the 10:00 AM wreck. */
  const DRIFT = {
    tripId: "trip-drift",
    title: "Reef drift",
    meetings: [
      {
        startsAt: new Date("2026-08-27T13:00:00.000Z"),
        endsAt: new Date("2026-08-27T17:00:00.000Z"),
      },
    ],
  };
  const WRECK = {
    tripId: "trip-wreck",
    title: "Spiegel Grove",
    meetings: [
      {
        startsAt: new Date("2026-08-27T14:00:00.000Z"),
        endsAt: new Date("2026-08-27T18:00:00.000Z"),
      },
    ],
  };
  /** The same Thursday, 3:00 PM: an ordinary second shift, not a clash. */
  const AFTERNOON = {
    tripId: "trip-afternoon",
    title: "Afternoon single",
    meetings: [
      {
        startsAt: new Date("2026-08-27T19:00:00.000Z"),
        endsAt: new Date("2026-08-27T22:00:00.000Z"),
      },
    ],
  };

  /**
   * **Both renderings, asserted separately** (dive-domain-expert review,
   * 2026-09-12). This component draws the week twice — the seven-column grid
   * from `lg` up and a day list below it — and jsdom renders both subtrees
   * whatever the viewport says, so a singular `getByText` here *passed because
   * the phone branch was missing the line*: two matches throw. The list is the
   * whole week on a phone and on the portrait tablet a counter actually runs
   * on, so the branch that was silent is the one that mattered most.
   */
  function branches(container: HTMLElement) {
    const grid = container.querySelector<HTMLElement>('[class~="lg:block"]');
    const list = container.querySelector<HTMLElement>('[class~="lg:hidden"]');
    if (!grid || !list) throw new Error("the week should render a grid and a day list");
    return { grid, list };
  }

  it("names the other departure on each chip, in the day the overlap falls", () => {
    const { container } = renderWeek({ people: [{ ...KEIKO, crewingTrips: [DRIFT, WRECK] }] });
    const { grid, list } = branches(container);

    // Both hulls say it, because a manager fixes this from whichever one they
    // opened, and each names the *other* boat. The word is what carries it —
    // this grid's own rule, and the reason the chip is the blackout's chip
    // rather than a second warning grammar.
    for (const branch of [grid, list]) {
      expect(within(branch).getByText("Also on Spiegel Grove: cannot be on both")).toBeVisible();
      expect(within(branch).getByText("Also on Reef drift: cannot be on both")).toBeVisible();
    }
  });

  /**
   * The clash rides inside the day list's own link, so the sentence joins that
   * link's accessible name — which is why neither rendering needs a live region
   * of its own, and why the departure page's line is the only announced copy of
   * this fact.
   */
  it("carries the clash inside the phone list's departure link", () => {
    const { container } = renderWeek({ people: [{ ...KEIKO, crewingTrips: [DRIFT, WRECK] }] });
    const { list } = branches(container);

    const link = within(list).getByText("Also on Spiegel Grove: cannot be on both").closest("a");
    expect(link).toHaveAttribute("href", "/shop/blue-mantis/trips/trip-drift#crew");
    expect(within(list).queryByRole("alert")).toBeNull();
    expect(within(list).queryByRole("status")).toBeNull();
  });

  /**
   * The silent case, and the assertion most likely to be dropped: a morning
   * boat and an afternoon boat are how a divemaster works a day, and the roster
   * allows it on purpose (#757, #1203).
   */
  it("says nothing about an ordinary double shift", () => {
    const { container } = renderWeek({ people: [{ ...KEIKO, crewingTrips: [DRIFT, AFTERNOON] }] });
    const { grid, list } = branches(container);

    for (const branch of [grid, list]) {
      expect(within(branch).queryByText(/cannot be on both/)).toBeNull();
      // The chips themselves are both there — the absence above is about the
      // warning, not about a week that failed to render.
      expect(within(branch).getAllByText(/Reef drift/).length).toBeGreaterThan(0);
      expect(within(branch).getAllByText(/Afternoon single/).length).toBeGreaterThan(0);
    }
  });
});
