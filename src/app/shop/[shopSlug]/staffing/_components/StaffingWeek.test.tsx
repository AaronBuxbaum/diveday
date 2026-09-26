// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ledgerRowBoxClass, ledgerRowRoomClass } from "@/components/ui/ledger";
import { staffTranslator } from "@/i18n/staff-messages";
import type { AvailabilityBlock, CrewAssignmentRequest } from "@/lib/crew-requests";
import { staffWeek, type WeekGap, type WeekPerson } from "@/lib/staffing-week";
import { rendersFlush } from "@/test/button-flush";
import {
  type GapWords,
  StaffingWeek,
  type StaffingWeekWords,
  weekTailRowClass,
} from "./StaffingWeek";

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
   *
   * **`canManage: false` in every fixture here**, which is what a divemaster
   * actually reads: the ask is the cell's act only for somebody who has no
   * assignment to make (`gapAct`). A managing viewer gets "Assign ›" and
   * nothing else.
   */
  it("tells a divemaster their ask adds no seats to an intro-ratio gap", () => {
    const dm = renderWeek({
      gaps: [{ ...GAP, gap: "over_intro_ratio" }],
      canManage: false,
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
      canManage: false,
      viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: true },
    });
    expect(screen.queryByText(WORDS.askWontClose)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ask to work Spiegel Grove" }).length).toBe(2);
    instructor.unmount();

    // Neither is the entry-level cap, which a certified assistant does raise.
    renderWeek({
      gaps: [{ ...GAP, gap: "over_ratio" }],
      canManage: false,
      viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: false },
    });
    expect(screen.queryByText(WORDS.askWontClose)).toBeNull();
  });

  /**
   * **One act per gap cell, and which one is a fact about the reader**
   * (principle 8; the `20260908-one-hand` canvas). A ~120px cell used to draw
   * "Assign ›" and "Ask for this one" beside each other at link weight on
   * every gap, in both layouts — two doors onto the same short-handed
   * departure with nothing saying which one was the reader's to press.
   */
  it("gives a manager the assignment and a crew member the ask, never both", () => {
    const crewViewer = { personId: "person-1", isCrew: true, holdsInstructorRole: false };

    const manager = renderWeek({ gaps: [GAP], canManage: true, viewer: crewViewer });
    expect(screen.getAllByRole("link", { name: "Assign crew to Spiegel Grove" }).length).toBe(2);
    expect(screen.queryByRole("button", { name: "Ask to work Spiegel Grove" })).toBeNull();
    manager.unmount();

    renderWeek({ gaps: [GAP], canManage: false, viewer: crewViewer });
    expect(screen.getAllByRole("button", { name: "Ask to work Spiegel Grove" }).length).toBe(2);
    expect(screen.queryByRole("link", { name: "Assign crew to Spiegel Grove" })).toBeNull();
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

/**
 * **The week's geometry, pinned as classes** (docs/design/pixel-craft.md). The
 * probe's `small-target` runs at 390 and 820, where the grid is `hidden`, and
 * shared edges are leads it cannot confirm, so what was measured on the 1280
 * and 390 captures is held here instead.
 */
describe("StaffingWeek geometry", () => {
  function branches(container: HTMLElement) {
    const grid = container.querySelector<HTMLElement>('[class~="lg:block"]');
    const list = container.querySelector<HTMLElement>('[class~="lg:hidden"]');
    if (!grid || !list) throw new Error("the week should render a grid and a day list");
    return { grid, list };
  }
  const horizontalInset = (element: Element | undefined) =>
    [...(element?.classList ?? [])].filter((token) => /^p[xse]-/.test(token));

  /**
   * K-239: the names and "Needs crew" started 8px inside the column every
   * other line on the page starts on (the pager, the h1, the ledger's words).
   * The day columns need an inset for their left rule; the person column has
   * no rule on its left, so it keeps only the 8px before the first day's.
   */
  it("starts the person column's words on the page's own edge", () => {
    const { container } = renderWeek({ gaps: [GAP] });
    const rows = [...branches(container).grid.children];
    expect(rows).toHaveLength(3);
    expect(within(rows[2] as HTMLElement).getByText("Needs crew")).toBeVisible();
    for (const row of rows) {
      expect(row.firstElementChild).toHaveClass("pe-2");
      expect(row.firstElementChild).not.toHaveClass("px-2");
    }
  });

  /**
   * And its rules are a ledger row's. Every rule under the grid (the doors,
   * the credentials) runs 8px past the column with its row's room
   * (`FILL_ROOM`), so a grid drawing its hairlines on the column stepped 8px
   * where the two met.
   */
  it("draws each grid row on the ledger's box, so its rules end where the page's do", () => {
    const { container } = renderWeek({ gaps: [GAP] });
    const { grid } = branches(container);
    expect(grid).not.toHaveClass("border-t");
    expect(grid).not.toHaveClass("border-b");
    for (const row of grid.children) expect(row).toHaveClass(...ledgerRowBoxClass.split(" "));
  });

  /**
   * K-240: a day's label started 2px right of its chips' painted edge and
   * 6–8px left of their words. The header takes the day cells' inset, so each
   * label starts on its chips' edge.
   */
  it("insets each day's label as its day cells inset their chips", () => {
    const { container } = renderWeek({ gaps: [GAP] });
    const [header, person, gapRow] = branches(container).grid.children;
    const heads = [...header.children].slice(1);
    expect(heads).toHaveLength(7);
    for (const [index, head] of heads.entries()) {
      expect(horizontalInset(head)).toEqual(["px-1.5"]);
      expect(horizontalInset(head)).toEqual(horizontalInset(person.children[index + 1]));
      expect(horizontalInset(head)).toEqual(horizontalInset(gapRow.children[index + 1]));
    }
  });

  /**
   * K-499: `pt-3 pb-2` set the band's caps 15px under its top rule and 12px
   * over its bottom one, 1.5px below the band's centre. One inset each side.
   */
  it("centres the day-header band's labels between its rules", () => {
    const { container } = renderWeek();
    const [header] = branches(container).grid.children;
    for (const cell of header.children) {
      expect(cell).toHaveClass("py-2.5");
      expect(cell).not.toHaveClass("pt-3");
      expect(cell).not.toHaveClass("pb-2");
    }
  });

  /** One of each chip kind, in Thursday's column and Wednesday's. */
  function renderEveryChip({ canManage = true } = {}) {
    const rendered = renderWeek({
      canManage,
      people: [
        {
          ...KEIKO,
          crewingTrips: [
            {
              tripId: "trip-drift",
              title: "Reef drift",
              meetings: [
                {
                  startsAt: new Date("2026-08-27T13:00:00.000Z"),
                  endsAt: new Date("2026-08-27T17:00:00.000Z"),
                },
              ],
            },
          ],
        },
      ],
      blocks: [
        {
          id: "away-1",
          personId: KEIKO.personId,
          startsOn: "2026-08-26",
          endsOn: "2026-08-26",
          note: null,
        },
      ],
      gaps: [GAP],
    });
    const { grid } = branches(rendered.container);
    const chips = {
      shift: canManage
        ? grid.querySelector("summary")
        : within(grid).getByText("6:30 AM – 12:00 PM").closest("span.flex-col")?.parentElement,
      crew: grid.querySelector('a[href="/shop/blue-mantis/trips/trip-drift#crew"]'),
      away: within(grid).getByText("Away").parentElement,
      gap: within(grid).getByText("Nobody in the water").parentElement,
    };
    return { ...rendered, grid, chips };
  }

  /**
   * K-498: the crew and away chips carried a 1px border and the shift and gap
   * chips none, so in one day column the chips' words started 1px apart and a
   * bordered chip stood 2px taller for the same lines. Every kind reserves the
   * pixel; a kind only colours it.
   */
  it("reserves one 1px border on every chip kind, so their words share an edge", () => {
    for (const canManage of [true, false]) {
      const { chips, unmount } = renderEveryChip({ canManage });
      for (const [kind, chip] of Object.entries(chips)) {
        expect(chip, kind).not.toBeNull();
        expect(chip, kind).toHaveClass("border", "rounded-lg", "px-2", "py-1.5");
      }
      unmount();
    }
  });

  /** A box's start inset, in px, from its classes: its 1px edge, then its padding. */
  function startInset(element: Element | null | undefined) {
    const tokens = [...(element?.classList ?? [])];
    const edge = tokens.some((token) => ["border", "border-x", "border-s"].includes(token)) ? 1 : 0;
    const padding = tokens.map((token) => /^p[xs]-(\d+(?:\.\d+)?)$/.exec(token)).find(Boolean);
    return edge + (padding ? Number(padding[1]) * 4 : 0);
  }

  /**
   * K-498, carried into the opened shift. The chip reserves a 1px edge
   * before its 8px, so its words start 9px in; the disclosure under it (the
   * zoned range, then Remove flush on the column) started at 8px, so the
   * opened shift was 1px ragged, the defect K-498 removed moved down a line.
   * The disclosure reserves the same edge, transparent, on its start side.
   */
  it("starts the opened shift's words on the chip's own inset", () => {
    const { chips } = renderEveryChip();
    const disclosure = chips.shift?.nextElementSibling;
    expect(disclosure).not.toBeNull();
    expect(startInset(chips.shift)).toBe(9);
    expect(startInset(disclosure)).toBe(startInset(chips.shift));
    expect(disclosure).toHaveClass("border-transparent");
  });

  /**
   * K-535, K-501: the two chips a manager can press hovered to a translucent
   * copy of their own fill, which over the page's ground is lighter, not
   * deeper — `#e6f0ff` to `#eaf1fd` on the crew chip, `#ececf1` to `#eeeef3`
   * on the shift chip, 0px changed at the state atlas's threshold. Each now
   * hovers one step past where it rests, and the step is the chip's edge,
   * never its fill: a fill under the words moves their contrast, and
   * `bg-border` did — under `prefers-contrast: more` (light) the hovered
   * shift's time fell to 3.10:1 and a past shift's to 1.84:1, for exactly the
   * readers who asked for more.
   */
  it("hovers each chip a person can press a step past its rest, never a fainter copy of it", () => {
    const { chips } = renderEveryChip();
    for (const [kind, chip] of [
      ["shift", chips.shift],
      ["crew", chips.crew],
    ] as const) {
      const tokens = [...(chip?.classList ?? [])];
      const rest = tokens.filter((token) => /^(?:bg|border)-/.test(token));
      const hover = tokens.filter((token) => token.startsWith("hover:"));
      expect(hover.length, kind).toBeGreaterThan(0);
      expect(
        hover.filter((token) => token.startsWith("hover:bg-")),
        kind,
      ).toEqual([]);
      for (const paint of rest) {
        for (const token of hover) {
          expect(token, kind).not.toBe(`hover:${paint}`);
          expect(token.startsWith(`hover:${paint}/`), `${kind}: ${token}`).toBe(false);
        }
      }
    }
    expect(chips.shift).toHaveClass("hover:border-border-strong");
    expect(chips.crew).toHaveClass("hover:border-primary/50");
  });

  /**
   * K-241: the week's one warning glyph was drawn at 10px beside a 4px gap on
   * the crew chip, 12px beside 6px on the gap chip, and nudged down `mt-0.5`
   * on both, which set it 1–1.5px below its line's capitals. One line piece
   * now: the glyph centred in a box its line tall (`h-lh`), at one size and
   * gap per type size — 12px and 4px beside the chips' `text-xs`, 14px and
   * 6px beside the phone list's `text-sm`.
   */
  it("draws the warning glyph one way per type size, centred on its line", () => {
    const { container } = renderWeek({
      people: [
        {
          ...KEIKO,
          crewingTrips: [
            {
              tripId: "trip-drift",
              title: "Reef drift",
              meetings: [
                {
                  startsAt: new Date("2026-08-27T13:00:00.000Z"),
                  endsAt: new Date("2026-08-27T17:00:00.000Z"),
                },
              ],
            },
            {
              tripId: "trip-wreck",
              title: "Wreck charter",
              meetings: [
                {
                  startsAt: new Date("2026-08-27T14:00:00.000Z"),
                  endsAt: new Date("2026-08-27T18:00:00.000Z"),
                },
              ],
            },
          ],
        },
      ],
      blocks: [
        {
          id: "away-1",
          personId: KEIKO.personId,
          startsOn: THURSDAY,
          endsOn: THURSDAY,
          note: null,
        },
      ],
      gaps: [GAP],
    });
    const { grid, list } = branches(container);
    const lineOf = (words: HTMLElement) => words.parentElement as HTMLElement;
    const chipLines = [
      ...within(grid)
        .getAllByText(/cannot be on both/)
        .map(lineOf),
      ...within(grid)
        .getAllByText(/^Away /)
        .map(lineOf),
      grid.querySelector<HTMLElement>(".bg-warning-tint > span") as HTMLElement,
    ];
    const listLines = within(list)
      .getAllByText(/cannot be on both/)
      .map(lineOf);
    expect(chipLines).toHaveLength(5);
    expect(listLines).toHaveLength(2);

    for (const [lines, gap, glyph] of [
      [chipLines, "gap-1", "size-3"],
      [listLines, "gap-1.5", "size-3.5"],
    ] as const) {
      for (const line of lines) {
        expect(line).toHaveClass("flex", "items-start", gap);
        const box = line.firstElementChild;
        expect(box).toHaveClass("flex", "h-lh", "shrink-0", "items-center");
        const mark = box?.querySelector("svg");
        expect(mark).toHaveClass(glyph);
        expect(mark).not.toHaveClass("mt-0.5");
      }
    }
  });

  /**
   * K-273: the grid's "Assign ›" was the `text-xs` line box, about 52×16px,
   * four or five to a week. The probe cannot see it — `small-target` runs at
   * 390 and 820, where this grid is hidden — so the floor is pinned here. It
   * is drawn as its slot-mate, the crew member's "Ask for this one", already
   * is: a flush `sm` link, 44px tall with the button's corner and ring.
   */
  it("gives the grid's Assign a 44px target, spelled as the ask beside it is", () => {
    const { container } = renderWeek({ gaps: [GAP] });
    const { grid } = branches(container);
    const assign = within(grid).getByRole("link", { name: "Assign crew to Spiegel Grove" });
    expect(assign).toHaveClass("min-h-11");
    expect(rendersFlush(assign, "link", "sm")).toBe(true);
    cleanup();

    const crew = renderWeek({
      gaps: [GAP],
      canManage: false,
      viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: false },
    });
    const ask = within(branches(crew.container).grid).getByRole("button", {
      name: "Ask to work Spiegel Grove",
    });
    expect(rendersFlush(ask, "link", "sm")).toBe(true);
  });

  /** Thursday on the phone: a shift, a crewed boat the person is away for, and the away line. */
  function renderPhoneDay({ canManage }: { canManage: boolean }) {
    const rendered = renderWeek({
      canManage,
      people: [
        {
          ...KEIKO,
          crewingTrips: [
            {
              tripId: "trip-drift",
              title: "Reef drift",
              meetings: [
                {
                  startsAt: new Date("2026-08-27T13:00:00.000Z"),
                  endsAt: new Date("2026-08-27T17:00:00.000Z"),
                },
              ],
            },
          ],
        },
      ],
      blocks: [
        {
          id: "away-1",
          personId: KEIKO.personId,
          startsOn: THURSDAY,
          endsOn: THURSDAY,
          note: null,
        },
      ],
    });
    const { list } = branches(rendered.container);
    const name = within(list).getByText("Keiko Tanaka");
    const entries = name.nextElementSibling as HTMLElement;
    return { ...rendered, list, entries };
  }

  /**
   * K-213: each departure a person crews was one line of blue text, 358×20
   * (or ×40 wrapped), 4px from the next: a thumb aimed at one landed on its
   * neighbour. Each is now a 44px target, and the day's entries abut, so the
   * list keeps one pitch — every entry a 44px line, as a manager's shift
   * already was beside its Remove.
   */
  it("makes each crewed departure on the phone a 44px target in a list of 44px lines", () => {
    for (const canManage of [true, false]) {
      const { list, entries, unmount } = renderPhoneDay({ canManage });
      expect(entries.className).not.toMatch(/(?:^|\s)gap-/);
      expect(entries.children.length).toBe(3);
      for (const entry of entries.children) expect(entry).toHaveClass("min-h-11");
      const door = within(list).getByRole("link", { name: /Reef drift/ });
      expect(door).toHaveClass("flex", "flex-col", "min-h-11", "justify-center");
      unmount();
    }
  });

  /** K-489: "· Away" broke between its dot and its word, the word alone on a line. */
  it("keeps the phone list's away marker whole", () => {
    const { list } = renderPhoneDay({ canManage: true });
    const marker = within(list).getByText((_, element) => element?.textContent === "· Away");
    expect(marker).toHaveClass("whitespace-nowrap");
  });

  /**
   * K-195: the page's doors drew a ledger row's box under a week that had
   * already closed itself, so the rule above "Add a shift" was two 1px rules
   * stacked, and with the consent row after them `last:border-b` never fired
   * under "Tell the shop you're away". Both renderings of the week close
   * themselves; a row hung under them draws its closing rule alone, with a
   * ledger row's room so the rule ends where the week's do.
   */
  it("closes itself in both renderings, and hangs a row under it on its closing rule alone", () => {
    const { container } = renderWeek({ gaps: [GAP] });
    const { grid, list } = branches(container);
    expect(grid.lastElementChild).toHaveClass("last:border-b");
    const lastRows = list.querySelectorAll("ul > li:last-child");
    expect(lastRows.length).toBeGreaterThan(0);
    expect(lastRows[lastRows.length - 1]).toHaveClass("last:border-b");

    const tail = weekTailRowClass.split(" ");
    expect(tail).toEqual(expect.arrayContaining([...ledgerRowRoomClass.split(" "), "border-b"]));
    expect(tail.filter((token) => /(?:^|:)border-t$/.test(token))).toEqual([]);
    expect(tail).not.toContain("last:border-b");
  });
});
