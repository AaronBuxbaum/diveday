// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleBuilder } from "./ScheduleBuilder";
import {
  actions,
  COPY,
  loadMovePreflight,
  loadOptions,
  MORE,
  PRICE,
  resetScheduleBuilderFixtures,
} from "./schedule-builder-test-fixtures";
import type { BuilderWeek, WeekEntry, WeekSpan } from "./WeekBoard";

vi.mock("next/navigation", async () => {
  const navigation = await import("./schedule-builder-test-fixtures");
  return {
    usePathname: navigation.usePathname,
    useRouter: navigation.useRouter,
    useSearchParams: navigation.useSearchParams,
  };
});

afterEach(resetScheduleBuilderFixtures);

/**
 * **The week, at `xl` and up** — ADR 20260827-clearwater-surface-language,
 * decision 5, and the width floor H-20260827-clearwater-week-board-roadmap set on 2026-08-27.
 *
 * The floor itself is a real-viewport fact and is pinned where a viewport
 * exists (`e2e/schedule-builder.spec.ts`, "the board is the stream below
 * 1280px and the week at 1280"). What is pinned here is everything jsdom can
 * answer: that the two compositions declare the floor at all, that a course
 * spanning three days is drawn once, and the silences the design depends on.
 */
describe("ScheduleBuilder week board", () => {
  const DAY_ISOS = [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ] as const;

  function weekEntry(overrides: Partial<WeekEntry> & { tripId: string; dateIso: string }) {
    return {
      startTime: "07:00",
      title: "Two-Tank Reef",
      time: "7:00 AM",
      meta: "$95",
      seats: { booked: 10, capacity: 12 },
      seatsLabel: "10 of 12",
      // Unstaffed by default, which is the loud case: a factory that defaulted
      // to a crew would let a row quietly stop printing its gap.
      crew: [] as string[],
      dayCount: 1,
      status: "upcoming" as const,
      unpriced: false,
      rehearsal: false,
      rollCallOpen: null,
      ref: "Two-Tank Reef, Thu, Aug 27 7:00 AM – 10:30 AM",
      ...overrides,
    };
  }

  function weekSpan(overrides: Partial<WeekSpan> & { tripId: string }): WeekSpan {
    return {
      title: "Open Water Diver — three-day course",
      meta: "$595 · Marcus Webb",
      seats: { booked: 4, capacity: 5 },
      seatsLabel: "4 of 5",
      runsLabel: "3 days",
      time: "8:00 AM",
      dateIso: "2026-08-28",
      startTime: "08:00",
      dayCount: 3,
      status: "upcoming" as const,
      unpriced: false,
      rehearsal: false,
      rollCallOpen: null,
      ref: "Open Water Diver — three-day course, Aug 28 – 30, 2026",
      startColumn: 5,
      columnSpan: 3,
      ...overrides,
    };
  }

  function week(overrides: Partial<BuilderWeek> = {}): BuilderWeek {
    return {
      ariaLabel: "The week",
      rangeLabel: "Aug 24 – 30, 2026",
      previousHref: "/shop/blue-mantis/schedule/board?week=2026-08-17",
      nextHref: "/shop/blue-mantis/schedule/board?week=2026-08-31",
      thisWeekHref: null,
      allUnpriced: false,
      nextDeparture: null,
      seatTally: "14 of 17 seats",
      asked: [],
      askedCount: "0 days",
      words: {
        previous: "Previous week",
        next: "Next week",
        thisWeek: "This week",
        today: "Today",
      },
      days: DAY_ISOS.map((dateIso, index) => ({
        dateIso,
        weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] ?? "",
        dayNumber: String(24 + index),
        label: `Day ${24 + index}`,
        paperLabel: `${dateIso} · America/New_York`,
        isToday: dateIso === "2026-08-27",
        isPast: dateIso < "2026-08-27",
        boatWarning: null,
        entries: [],
      })),
      spans: [],
      ...overrides,
    };
  }

  function board(weekProps: BuilderWeek | null, canConfigure = true) {
    return render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
          loadOptions,
          loadMovePreflight,
          price: PRICE,
          actions,
          defaultDateIso: "2026-08-27",
          canConfigure,
          locale: "en-US",
          copy: COPY,
          more: MORE,
          initialCourse: null,
          openAdd: "closed",
          week: weekProps,
        }}
      />,
    );
  }

  /** The one grid on the page, whatever else shares its words. */
  const grid = () => screen.getByRole("region", { name: "The week" });

  it("is the board's one reading, at every width, with no stream beneath it", () => {
    // **The point of #1923.** The board composed the same departures twice —
    // this grid from 1280 up, a vertical day stream below it — and a
    // breakpoint decided which one a reader, a test or a screen reader got.
    // A day is a row on a phone and a row on a desk, so there is no floor to
    // declare any more.
    //
    // Exact class tokens, never a substring: `toContain("xl:block")` is
    // satisfied by `2xl:block`, so a floor could come back under a different
    // name with a looser assertion still green.
    const { container } = board(
      weekWithThursday([weekEntry({ tripId: "t1", dateIso: "2026-08-27" })]),
    );

    expect(grid().classList.contains("hidden")).toBe(false);
    expect(grid().classList.contains("xl:block")).toBe(false);
    // And the composition it replaced leaves no second copy of the same
    // departure behind it — which is the regression a deletion this size is
    // most likely to leave.
    expect(container.querySelector("[data-day-stream]")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Two-Tank Reef" })).toHaveLength(1);
  });

  it("renders no grid at all on a board with nothing upcoming", () => {
    // The terminal empty state is the whole page at every width; seven empty
    // columns beneath it would be the same nothing said twice.
    board(null);

    expect(screen.queryByRole("region", { name: "The week" })).toBeNull();
  });

  it("draws a multi-day course once, as a bar, and never in the days it covers", () => {
    board(week({ spans: [weekSpan({ tripId: "course-1" })] }));

    const bars = within(grid()).getAllByRole("link", {
      name: "Open Water Diver — three-day course",
    });
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("href", "/shop/blue-mantis/trips/course-1");
    // **Once, on the day it starts** (slice 23f). A course owns the days it
    // covers rather than repeating in them, so the whole week holds exactly
    // one row for it — the bar it used to be drawn as was the same claim in
    // the grid's geometry. It says how long it runs where a boat says when it
    // leaves, which is what a reader loses when the bar stops spanning
    // columns.
    expect(within(grid()).queryAllByRole("listitem")).toHaveLength(1);
    expect(within(grid()).getByText("3 days")).toBeVisible();
  });

  it("says a day with no departures has none, and still offers to fill it", () => {
    board(week());

    expect(within(grid()).queryAllByRole("listitem")).toHaveLength(0);
    // **Seven rows saying "No boats", where the grid said nothing at all.**
    // An empty *column* is read against the six beside it, which is what gave
    // the blank its meaning; one empty row in a run of rows is just a gap, so
    // the week says it in words.
    // Five of them now: the three days already behind fold into one row
    // ("Mon–Wed · No boats", UX review 2026-10-10, item 24).
    expect(within(grid()).getAllByText("No boats")).toHaveLength(5);
    // What an empty day still ahead does carry is its own way to fill it —
    // and a day already behind carries none, because a departure is put on
    // the board and the board is ahead. Aug 27 is "today" in this fixture, so
    // four of the seven can take one.
    expect(within(grid()).getAllByRole("link", { name: /^Add a departure on Day / })).toHaveLength(
      4,
    );
    for (const past of ["Day 24", "Day 25", "Day 26"]) {
      expect(within(grid()).queryByRole("link", { name: `Add a departure on ${past}` })).toBeNull();
    }
  });

  /**
   * **A day somebody asked for, read against the week it belongs to** (ADR
   * 20260919-one-idea, slice 23f) — which is the one thing a week can say that
   * the Requests page cannot, and the reason this is not a second copy of it.
   */
  it("draws the days somebody asked for, and the act that answers one", () => {
    board(
      week({
        asked: [
          {
            dateIso: "2026-08-26",
            lead: "Wed, Aug 26 · 4 people",
            who: "Marta Ruiz and Leo Fisher",
            href: "/shop/blue-mantis/schedule/board?add=full&date=2026-08-26&requests=r1%2Cr2",
          },
        ],
        askedCount: "1 day",
      }),
    );

    expect(within(grid()).getByText("Wed, Aug 26 · 4 people")).toBeVisible();
    expect(within(grid()).getByText("Marta Ruiz and Leo Fisher")).toBeVisible();
    expect(within(grid()).getByText("1 day")).toBeVisible();
    expect(within(grid()).getByRole("link", { name: "Add a departure" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board?add=full&date=2026-08-26&requests=r1%2Cr2",
    );
  });

  /**
   * A week nobody asked anything of says nothing about it — the heading is not
   * a permanent fixture waiting to be filled (design/principles.md #9).
   */
  it("says nothing about asks on a week that has none", () => {
    board(week());
    expect(within(grid()).queryByText("Asked for")).toBeNull();
  });

  it("offers a boat already home no move, copy, remove or price warning", () => {
    board(
      week({
        days: week().days.map((day) =>
          day.dateIso === "2026-08-24"
            ? {
                ...day,
                entries: [
                  weekEntry({
                    tripId: "sailed-1",
                    dateIso: "2026-08-24",
                    title: "Benwood & Elbow",
                    status: "sailed",
                    unpriced: true,
                    meta: "Sailed",
                    ref: "Benwood & Elbow, Mon, Aug 24 11:30 AM – 3:00 PM",
                  }),
                ],
              }
            : day,
        ),
      }),
    );

    expect(within(grid()).getByText("Sailed")).toBeTruthy();
    // Every one of the three is refused by src/db/trips-schedule.ts for a
    // departure that has already sailed, so none of them is offered.
    expect(
      within(grid()).queryByRole("button", { name: /^Move, copy, or remove Benwood/ }),
    ).toBeNull();
    // And the price flag is silent: an unpriced boat that has already sailed
    // cannot be booked, so its missing price is nobody's morning.
    expect(within(grid()).queryByText("No price set")).toBeNull();
  });

  it("carries the price warning, with its own drawn mark, on a departure still to sail", async () => {
    board(
      week({
        days: week().days.map((day) =>
          day.dateIso === "2026-08-30"
            ? {
                ...day,
                entries: [
                  weekEntry({
                    tripId: "sunday-1",
                    dateIso: "2026-08-30",
                    title: "Christ of the Abyss",
                    unpriced: true,
                    meta: "",
                    ref: "Christ of the Abyss, Sun, Aug 30 11:30 AM – 3:00 PM",
                  }),
                ],
              }
            : day,
        ),
      }),
    );

    // J5: Dana sees Sunday's unpriced entry on the week and opens it through
    // the departure's own editor — the panel that already exists.
    const flag = within(grid()).getByRole("link", {
      name: "Set a price for Christ of the Abyss, Sun, Aug 30 11:30 AM – 3:00 PM",
    });
    expect(flag).toHaveAttribute("href", "/shop/blue-mantis/trips/sunday-1?view=details#details");
    expect(flag.textContent).toContain("No price set");
    expect(flag.querySelector("svg")).not.toBeNull();
  });

  it("opens move, copy and remove from a cell, keyed apart from the stream's own", async () => {
    const user = userEvent.setup();
    board(
      week({
        days: week().days.map((day) =>
          day.dateIso === "2026-08-27"
            ? {
                ...day,
                entries: [
                  weekEntry({ tripId: "trip-1", dateIso: "2026-08-27", title: "Two-Tank Reef" }),
                ],
              }
            : day,
        ),
      }),
    );

    // The stream renders the same departure; only one of the two can ever be
    // on screen, and each hands focus back to its own control.
    await user.click(
      within(grid()).getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Move Two-Tank Reef/ }));
    // A move form is two date/time fields; it opens full width beneath the
    // grid rather than inside a 160px column.
    expect(screen.getByLabelText("New date")).toHaveValue("2026-08-27");
    // The time box settles to what it reads and a hidden control submits the
    // HH:MM the server expects (ADR 20260906-before-you-ask, decision 3).
    expect(screen.getByLabelText("New departure time (America/New_York)")).toHaveValue("7:00 AM");
    expect(document.querySelector('input[type="hidden"][name="startTime"]')).toHaveValue("07:00");
  });

  /**
   * **The "⋯" opens where the reader is looking** (the "..." bugs, 2026-10).
   *
   * The list and every form it opened rendered at the foot of the whole week
   * and took focus there, so a tap on a Friday "⋯" scrolled the page down to a
   * strip that named the departure in words. A second tap on the same "⋯"
   * re-opened the strip instead of closing it, because the outside-tap
   * listener did not count the trigger as inside.
   */
  describe("a row's ⋯", () => {
    const friday = () =>
      week({
        days: week().days.map((day) =>
          day.dateIso === "2026-08-28"
            ? {
                ...day,
                entries: [
                  weekEntry({ tripId: "trip-1", dateIso: "2026-08-28", title: "Two-Tank Reef" }),
                  weekEntry({
                    tripId: "trip-2",
                    dateIso: "2026-08-28",
                    title: "Night Dive",
                    time: "7:30 PM",
                    ref: "Night Dive, Fri, Aug 28 7:30 PM – 9:30 PM",
                  }),
                ],
              }
            : day,
        ),
      });
    const trigger = (title: string) =>
      screen.getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title}`) });
    const rowOf = (title: string) => trigger(title).closest("li") as HTMLElement;

    it("drops its list inside the departure's own row", async () => {
      const user = userEvent.setup();
      board(friday());
      await user.click(trigger("Two-Tank Reef"));
      const move = screen.getByRole("button", { name: /^Move Two-Tank Reef/ });
      expect(rowOf("Two-Tank Reef").contains(move)).toBe(true);
      expect(trigger("Two-Tank Reef")).toHaveAttribute("aria-expanded", "true");
      expect(move).toHaveFocus();
    });

    it("closes on a second tap of the same ⋯", async () => {
      const user = userEvent.setup();
      board(friday());
      await user.click(trigger("Two-Tank Reef"));
      await user.click(trigger("Two-Tank Reef"));
      expect(screen.queryByRole("button", { name: /^Move Two-Tank Reef/ })).toBeNull();
      expect(trigger("Two-Tank Reef")).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on Escape, handing focus back to the ⋯, and on a tap anywhere else", async () => {
      const user = userEvent.setup();
      board(friday());
      await user.click(trigger("Two-Tank Reef"));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("button", { name: /^Move Two-Tank Reef/ })).toBeNull();
      expect(trigger("Two-Tank Reef")).toHaveFocus();

      await user.click(trigger("Two-Tank Reef"));
      await user.click(screen.getByText("Aug 24 – 30, 2026"));
      expect(screen.queryByRole("button", { name: /^Move Two-Tank Reef/ })).toBeNull();
    });

    it("moves to another row's ⋯ in one tap", async () => {
      const user = userEvent.setup();
      board(friday());
      await user.click(trigger("Two-Tank Reef"));
      await user.click(trigger("Night Dive"));
      expect(screen.queryByRole("button", { name: /^Move Two-Tank Reef/ })).toBeNull();
      expect(
        rowOf("Night Dive").contains(screen.getByRole("button", { name: /^Move Night Dive/ })),
      ).toBe(true);
    });

    it("opens the chosen form under the row that asked for it, once", async () => {
      const user = userEvent.setup();
      board(friday());
      for (const verb of ["Move", "Copy", "Remove"]) {
        await user.click(trigger("Night Dive"));
        await user.click(screen.getByRole("button", { name: new RegExp(`^${verb} Night Dive`) }));
        // The list gives way to the form; it does not stay open over it.
        expect(trigger("Night Dive")).toHaveAttribute("aria-expanded", "false");
        const form = document.querySelector("form") as HTMLFormElement;
        expect(document.querySelectorAll("form")).toHaveLength(1);
        expect(rowOf("Night Dive").contains(form)).toBe(true);
        expect(rowOf("Two-Tank Reef").contains(form)).toBe(false);
        // Focus is in the form, never dropped to the top of the page.
        expect(form.contains(document.activeElement)).toBe(true);
      }
    });
  });

  it("opens move, copy and remove from a multi-day course bar too", async () => {
    // **The bar replaces the entries for the days it covers.** So if it did
    // not carry the same "⋯" a day cell does, the desktop board would be the
    // one place in the app where a multi-day course cannot be moved, copied or
    // removed at all — a capability the stream underneath still has. The panels
    // are the shared ones, opened with the course's own first day, its
    // departure time and how many days move together.
    const user = userEvent.setup();
    board(
      week({
        spans: [
          weekSpan({
            tripId: "course-1",
            dateIso: "2026-08-28",
            startTime: "08:00",
            dayCount: 3,
          }),
        ],
      }),
    );

    await user.click(
      within(grid()).getByRole("button", { name: /^Move, copy, or remove Open Water Diver/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Move Open Water Diver/ }));
    expect(screen.getByLabelText("New date")).toHaveValue("2026-08-28");
    expect(screen.getByLabelText("New departure time (America/New_York)")).toHaveValue("8:00 AM");
    expect(document.querySelector('input[type="hidden"][name="startTime"]')).toHaveValue("08:00");
    // Three days move together, and the form says so — the same note the
    // stream's own move panel carries for a course.
    expect(screen.getByText("All 3 days move together, keeping their gaps.")).toBeTruthy();

    // Copy and remove reach the course from the same menu.
    await user.click(
      within(grid()).getByRole("button", { name: /^Move, copy, or remove Open Water Diver/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Copy Open Water Diver/ }));
    expect(screen.getByLabelText("Copy to")).toHaveValue("2026-09-04");
    // The crew comes along unless unticked (fifth-loop ideas, item 53).
    expect(screen.getByRole("checkbox", { name: "Same crew" })).toBeChecked();

    await user.click(
      within(grid()).getByRole("button", { name: /^Move, copy, or remove Open Water Diver/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Remove Open Water Diver/ }));
    expect(
      screen.getByText("Take “Open Water Diver — three-day course” off the board for good?"),
    ).toBeTruthy();
  });

  it("offers a course already finished no move, copy or remove", () => {
    // Same refusal as a boat already home: src/db/trips-schedule.ts declines
    // all three, so the bar is offered none of them.
    board(week({ spans: [weekSpan({ tripId: "course-1", status: "sailed" })] }));

    expect(
      within(grid()).queryByRole("button", { name: /^Move, copy, or remove Open Water Diver/ }),
    ).toBeNull();
  });

  it("carries the price warning on an unpriced course bar", () => {
    // The bar is a departure like any other: unpriced, still to run, and
    // divers can already see it. Without this the one shape that *replaces*
    // its day entries is also the one shape that says nothing about a missing
    // price.
    board(
      week({
        spans: [weekSpan({ tripId: "course-1", unpriced: true, meta: "Marcus Webb" })],
      }),
    );

    const flag = within(grid()).getByRole("link", {
      name: "Set a price for Open Water Diver — three-day course, Aug 28 – 30, 2026",
    });
    expect(flag).toHaveAttribute("href", "/shop/blue-mantis/trips/course-1?view=details#details");
    expect(flag.textContent).toContain("No price set");
    expect(flag.querySelector("svg")).not.toBeNull();
  });

  it("pages by week, and never mixes a cursor into that URL", () => {
    board(week({ thisWeekHref: "/shop/blue-mantis/schedule/board" }));

    const previous = within(grid()).getByRole("link", { name: "Previous week" });
    const next = within(grid()).getByRole("link", { name: "Next week" });
    expect(previous).toHaveAttribute("href", "/shop/blue-mantis/schedule/board?week=2026-08-17");
    expect(next).toHaveAttribute("href", "/shop/blue-mantis/schedule/board?week=2026-08-31");
    // The stream's keyset cursor is a different reading of the same rows and
    // keeps its own parameters; a week link that carried one would make the
    // two argue about where the board is.
    for (const link of [previous, next]) {
      expect(link.getAttribute("href")).not.toContain("after=");
      expect(link.getAttribute("href")).not.toContain("back=");
    }
    expect(within(grid()).getByRole("link", { name: "This week" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board",
    );
  });

  it("hides the week's own controls from a staffer who cannot schedule", () => {
    board(
      week({
        days: week().days.map((day) =>
          day.dateIso === "2026-08-27"
            ? {
                ...day,
                entries: [
                  weekEntry({ tripId: "trip-1", dateIso: "2026-08-27", title: "Two-Tank Reef" }),
                ],
              }
            : day,
        ),
      }),
      false,
    );

    // Trip definition is owner/manager/instructor work (H-20260724-staff-role-reach); the crew read
    // the week and run the day from each departure's own page.
    expect(within(grid()).queryAllByRole("link", { name: /^Add a departure on / })).toHaveLength(0);
    expect(within(grid()).queryByRole("button", { name: /^Move, copy, or remove / })).toBeNull();
    expect(within(grid()).getByRole("link", { name: "Two-Tank Reef" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1",
    );
  });

  /** One helper for "a week whose Thursday holds these departures". */
  function weekWithThursday(entries: WeekEntry[], rest: Partial<BuilderWeek> = {}) {
    return week({
      days: week().days.map((day) => (day.dateIso === "2026-08-27" ? { ...day, entries } : day)),
      ...rest,
    });
  }

  it("carries an open roll call into the week, where the stream cannot be seen", () => {
    // **The loudest thing the board can say** (DOM-H3): the boat is back and
    // somebody on its list was never counted. It shouted in the stream and
    // rendered nowhere at all from 1280px up, which made the desktop board
    // the quietest place in the app to notice an uncounted diver.
    board(
      weekWithThursday([
        weekEntry({
          tripId: "trip-home",
          dateIso: "2026-08-27",
          title: "Dawn Two-Tank",
          status: "sailed",
          rollCallOpen: { diveNumber: 2, uncounted: 3 },
        }),
      ]),
    );

    const flag = within(grid()).getByRole("link", {
      name: "Finish the dive 2 roll call for Two-Tank Reef, Thu, Aug 27 7:00 AM – 10:30 AM",
    });
    expect(flag).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-home/manifest?checkpoint=after_dive_2",
    );
    // Never hue alone: the count is in the words, not only in the ink.
    expect(flag).toHaveTextContent("Roll call · 3 not counted");
  });

  it("lets the open roll call outrank the price flag rather than stacking two marks", () => {
    // One slot, one grammar (issue 758) — the same call the stream made. In a
    // 150px column two stacked marks are two alarms competing.
    board(
      weekWithThursday([
        weekEntry({
          tripId: "trip-home",
          dateIso: "2026-08-27",
          status: "sailed",
          unpriced: true,
          rollCallOpen: { diveNumber: 1, uncounted: 2 },
        }),
      ]),
    );

    expect(within(grid()).getByText("Roll call · 2 not counted")).toBeInTheDocument();
    expect(within(grid()).queryByText("No price set")).toBeNull();
  });

  it("asks each column the board's own question: more departures than boats", () => {
    // The collision the ADR calls the board's whole question. It was computed
    // for the stream's days only, so it vanished with the stream at desktop.
    board(
      week({
        days: week().days.map((day) =>
          day.dateIso === "2026-08-27"
            ? { ...day, boatWarning: "Reef Runner is on two departures at once." }
            : day,
        ),
      }),
    );

    expect(within(grid()).getByText("Reef Runner is on two departures at once.")).toBeVisible();
    // Only on the day it is about — a warning repeated under all seven
    // numerals would name nothing.
    expect(within(grid()).getAllByText(/is on two departures at once\./)).toHaveLength(1);
  });

  it("names the next departure when the week on screen has none, instead of dead-ending", () => {
    // The stream that would have listed them is display:none at this width,
    // so seven blank columns and a "›" is the whole affordance without this.
    board(
      week({
        nextDeparture: {
          label: "Nothing this week. The next departure is Thu, Sep 10.",
          href: "/shop/blue-mantis/schedule/board?week=2026-09-10",
        },
      }),
    );

    expect(
      within(grid()).getByRole("link", {
        name: "Nothing this week. The next departure is Thu, Sep 10.",
      }),
    ).toHaveAttribute("href", "/shop/blue-mantis/schedule/board?week=2026-09-10");
  });

  it("says nothing about a next departure while the week has departures of its own", () => {
    // The page decides this once, over the whole week; the grid never
    // second-guesses it. Pinning the silence is the point: a line reading
    // "nothing this week" above a full week is worse than no line.
    board(weekWithThursday([weekEntry({ tripId: "trip-1", dateIso: "2026-08-27" })]));

    expect(within(grid()).queryByText(/next departure/)).toBeNull();
  });

  it("names each day's list by its own column header, not seven anonymous lists", () => {
    board(weekWithThursday([weekEntry({ tripId: "trip-1", dateIso: "2026-08-27" })]));

    // A screen reader walking the grid reads "Mon 24 … Sun 30" and then seven
    // lists; without this, none of them says which day it belongs to.
    const list = within(grid()).getByRole("list", { name: "Day 27" });
    expect(within(list).getByRole("link", { name: "Two-Tank Reef" })).toBeInTheDocument();
  });

  /**
   * **The crew answer, which the week did not have** (#1923).
   *
   * A stream row printed who was crewing a departure and a week row printed
   * nothing, so deleting the stream would have taken the question a manager
   * opens the board on a Thursday to answer — *which boat has no divemaster* —
   * off the board entirely, with nothing going red for it.
   *
   * The rule is `src/lib/usual-crew.ts` and is tested there. What these pin is
   * that the grid asks it, and asks it of the week it is drawing.
   */
  describe("the week says who is crewing, and only where it differs", () => {
    /** Four boats crewed alike, which is a habit by both thresholds. */
    const usualWeek = (odd: Partial<WeekEntry>[]) =>
      weekWithThursday([
        weekEntry({ tripId: "u1", dateIso: "2026-08-27", crew: ["Keiko Tanaka"] }),
        weekEntry({ tripId: "u2", dateIso: "2026-08-27", crew: ["Keiko Tanaka"] }),
        weekEntry({ tripId: "u3", dateIso: "2026-08-27", crew: ["Keiko Tanaka"] }),
        weekEntry({ tripId: "u4", dateIso: "2026-08-27", crew: ["Keiko Tanaka"] }),
        ...odd.map((over, index) =>
          weekEntry({ tripId: `odd-${index}`, dateIso: "2026-08-27", ...over }),
        ),
      ]);

    it("keeps quiet on the rows that run with the week's usual crew", () => {
      board(usualWeek([{ crew: ["Sal Moretti"] }]));

      // One line, not five. The exception is the whole point of printing any.
      expect(within(grid()).getAllByText(/^Crew:/)).toHaveLength(1);
      expect(within(grid()).getByText("Crew: Sal Moretti")).toBeInTheDocument();
    });

    it("prints every row's crew on a week that has no usual crew", () => {
      // Two departures is not a habit (`mostCommonCrew` wants three and a
      // majority), so there is nothing for a row to be an exception to and
      // every row states its own.
      board(
        weekWithThursday([
          weekEntry({ tripId: "a", dateIso: "2026-08-27", crew: ["Keiko Tanaka"] }),
          weekEntry({ tripId: "b", dateIso: "2026-08-27", crew: ["Sal Moretti"] }),
        ]),
      );

      expect(within(grid()).getByText("Crew: Keiko Tanaka")).toBeInTheDocument();
      expect(within(grid()).getByText("Crew: Sal Moretti")).toBeInTheDocument();
    });

    it("shouts about a departure nobody is on, even where there is a habit", () => {
      // The one case that must never be silenced by a usual crew: an empty
      // assignment can neither win the vote nor pass as usual, because this
      // gap is what the line exists to show.
      board(usualWeek([{ crew: [] }]));

      const gap = within(grid()).getByText("nobody yet");
      expect(gap).toBeInTheDocument();
      // In words and in warning ink, never hue alone.
      expect(gap).toHaveClass("text-warning");
    });

    it("names several crew in the shop's own order", () => {
      board(
        weekWithThursday([
          weekEntry({ tripId: "a", dateIso: "2026-08-27", crew: ["Keiko Tanaka", "Sal Moretti"] }),
        ]),
      );

      // One line, the order it was given — lead first is the shop's fact, not
      // the query's accident, which is why `isUsualCrew` compares it.
      expect(within(grid()).getByText("Crew: Keiko Tanaka, Sal Moretti")).toBeInTheDocument();
    });

    it("says nothing about crew on a course bar, which already names its teacher", () => {
      // A span's own meta carries `instructorName`. A crew line beside it
      // would say one fact twice on the one shape that has no hull to be
      // about — principle 9, and the reason spans pass `crewLine={null}`.
      board(
        week({
          spans: [weekSpan({ tripId: "course-1", meta: "$595 · Marcus Webb" })],
          days: week().days.map((day) => ({ ...day, entries: [] })),
        }),
      );

      expect(within(grid()).getByText("$595 · Marcus Webb")).toBeInTheDocument();
      expect(within(grid()).queryByText(/^Crew:/)).toBeNull();
    });
  });
});
