// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  type BuilderCopy,
  type BuilderDay,
  type BuilderMoreOptions,
  type BuilderPriceInput,
  ScheduleBuilder,
} from "./ScheduleBuilder";
import type { BuilderWeek, WeekEntry, WeekSpan } from "./WeekBoard";

// The board route has no dynamic id, so `usePathname()` is what
// ScheduleBuilder keys its disarm-on-revisit effect on (see the component's
// own doc comment). `setMockPathname` simulates a navigation event —
// including an Activity-preserved show/hide cycle, should
// `cacheComponents: true` be re-enabled — without a real Next.js router.
const { usePathname, setMockPathname, useRouter, useSearchParams, routerReplace } = vi.hoisted(
  () => {
    let current = "/shop/blue-mantis/schedule/board";
    const replace = vi.fn();
    return {
      usePathname: vi.fn(() => current),
      setMockPathname: (next: string) => {
        current = next;
      },
      routerReplace: replace,
      // The top add panel's Cancel clears the `?add` that opened it via
      // router.replace; the tests only need the calls to exist, not a router.
      useRouter: vi.fn(() => ({ replace })),
      useSearchParams: vi.fn(() => new URLSearchParams()),
    };
  },
);
vi.mock("next/navigation", () => ({ usePathname, useRouter, useSearchParams }));

const COPY: BuilderCopy = {
  ariaLabel: "Schedule builder",
  addDepartureOnDay: "Add a departure on {day}",
  add: "Add",
  cancel: "Cancel",
  noSiteSetYet: "No site set yet",
  courseLabel: "Course · {title}",
  dayCountLabelOne: "{count} day",
  dayCountLabelOther: "{count} days",
  crewLabel: "Crew:",
  crewNobodyYet: "nobody yet",
  crewMostlyAll: "Crew: {names} unless a departure says otherwise.",
  windLabel: "Wind:",
  noPriceSet: "No price set",
  noPriceSetAria: "Set a price for {ref}",
  noPriceSetAll:
    "None of these departures has a price yet — divers already see them on the schedule. Open a departure to set one.",
  rollCallOpen: "Roll call · {count} not counted",
  rollCallOpenAria: "Finish the dive {dive} roll call for {ref}",
  rollCallOpenNote: "Back at the dock with the dive {dive} roll call still open.",
  rowActionsAria: "Move, copy, or remove {ref}",
  move: "Move",
  moveAria: "Move {ref}",
  copy: "Copy",
  copyAria: "Copy {ref}",
  remove: "Remove",
  removeAria: "Remove {ref}",
  removeConfirm: "Take “{title}” off the board for good?",
  removeConfirmButton: "Yes, remove the trip",
  removeCancel: "Never mind",
  removePending: "…",
  whatIsIt: "What is it",
  titlePlaceholder: "Two-Tank Reef",
  date: "Date",
  departs: "Departs",
  returns: "Returns",
  seats: "Seats",
  dives: "Dives",
  price: "Price per diver",
  priceDescription: "Divers see this on the public page.",
  course: "Course",
  optional: "(optional)",
  courseAgencyLabels: { padi: "PADI", ssi: "SSI", other: "Other agency" },
  diveSite: "Dive site",
  ordinaryTrip: "Fun dive",
  decideLater: "Decide later",
  optionsLoading: "Loading…",
  adding: "Adding…",
  putOnBoard: "Put it on the board",
  newDate: "New date",
  multiDayNote: "All {count} days move together, keeping their gaps.",
  newDepartureTime: "New departure time",
  moving: "Moving…",
  moveIt: "Move it",
  copyTo: "Copy to",
  copyDescription: "Same dive, same seats, same price — no divers and no crew.",
  departureTime: "Departure time",
  copying: "Copying…",
  copyIt: "Copy it",
  viewOnlyNotice: "Scheduling and editing trips is limited to owners, managers, and instructors.",
  moreOptions: "More options",
  fewerOptions: "Fewer options",
  moreOptionsDescription: "Description, multi-day, deposit, cancellation window, repeat.",
  titlePlaceholderCourse: "{courseTitle} — Session 1",
  courseNote: "{requirement} · add an instructor before sharing the session",
  courseCertRequired: "{level} card required at enrollment",
  courseNoCardRequired: "No existing C-card required",
  descriptionLabel: "Description",
  descriptionPlaceholder: "Sites, conditions, who it's for.",
  isPrivateLabel: "Private charter",
  selfGuidedLabel: "Self-guided dive",
  selfGuidedHint: "Buddy pairs go in without a guide.",
  isPrivateHint: "Off the public schedule — only divers with the link can book it.",
  daysLabel: "How many days",
  daysDescription: "Most departures are one day.",
  payAtBookingLegend: "Pay at booking",
  payAtBookingDescription: "Optional.",
  depositLabel: "Deposit per diver",
  depositDescription: "Charged now.",
  depositTitle: "Only applies when set below the trip price.",
  cancellationWindowLabel: "Free cancellation window",
  cancellationWindowDescription: "Hours before departure.",
  hoursSuffix: "hours",
  minimumBookingsLabel: "Minimum to run",
  minimumBookingsDescription: "Blank means the boat goes with whoever books.",
  minimumDecisionLabel: "Decide by",
  minimumDecisionDescription: "How long before departure the call is made.",
  diversSuffix: "divers",
  hoursBeforeSuffix: "hours before",
  repeatLegend: "Repeat",
  repeatDescription: "Put a standing departure on the board and leave it there.",
  howOftenLabel: "How often",
  doesntRepeat: "Doesn't repeat",
  everyWeek: "Every week",
  every2Weeks: "Every 2 weeks",
  every4Weeks: "Every 4 weeks",
  repeatsOnLabel: "Repeats on",
  everyDay: "Every day",
  endsLabel: "Ends",
  endsNever: "Keeps repeating",
  endsOnChoice: "On a date",
  endsOnLabel: "Last date",
};

/** The bounds and shared dive-card words the expanded half of the panel needs. */
const MORE: BuilderMoreOptions = {
  weekdayNames: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  minDays: 1,
  maxDays: 7,
  diveFields: {
    heading: "The dive plan",
    description: "A {tripShape}.",
    twoTankTrip: "two-tank trip",
    diveCountTripOne: "{count}-dive trip",
    diveCountTripOther: "{count}-dive trip",
    numberOfDivesLabel: "Number of dives",
    diveOptionOne: "{count} dive",
    diveOptionOther: "{count} dives",
    diveLegend: "Dive {number}",
    nameLabel: "Name",
    optionalHint: "(optional)",
    namePlaceholderFirst: "Morning reef",
    namePlaceholderOther: "Second tank",
    diveSiteLabel: "Dive site",
    noSiteChosen: "Decide later",
    travelLabelFirst: "Minutes out from the dock",
    travelLabelOther: "Minutes from the previous site",
    travelHint: "(blank uses your usual ride out)",
    diverFacingDetailsLabel: "Diver-facing details",
    footerNote: "Divers see this on the booking page.",
  },
};

function baseTrip(overrides: Partial<BuilderDay["trips"][number]> = {}) {
  return {
    id: "trip-1",
    title: "Two-Tank Reef",
    dateIso: "2026-08-01",
    startTime: "08:30",
    timeRange: "8:30 AM – 12:30 PM",
    capacity: 12,
    booked: 3,
    courseTitle: null,
    diveSiteName: "Molasses Reef",
    dayCount: 1,
    crew: ["Dana Reyes"],
    priceCents: 8500,
    rollCallOpen: null,
    ...overrides,
  };
}

const noop = vi.fn();
const actions = { add: noop, move: noop, duplicate: noop, remove: noop };

/** Already resolved server-side from the shop's currency and the reader's locale. */
const PRICE: BuilderPriceInput = { step: "0.01", max: 100_000, placeholder: "$0.00" };

/**
 * The board no longer ships the catalogue with every render: the add panel
 * asks for its two option lists when it opens. Every test here gets the same
 * stub, and the one that cares asserts it is not called until then.
 */
const loadOptions = vi.fn(async () => ({
  courses: [{ id: "course-1", title: "Open Water Diver", agency: "padi" }],
  diveSites: [{ id: "site-1", title: "Molasses Reef" }],
}));

afterEach(() => {
  cleanup();
  loadOptions.mockClear();
  routerReplace.mockClear();
  useSearchParams.mockReturnValue(new URLSearchParams());
  setMockPathname("/shop/blue-mantis/schedule/board");
});

/**
 * **The crew line, said once** (issue #757). A shop rosters the same two or
 * three people onto nearly everything, so this line printed the identical
 * names on ten of fourteen rows of the seeded board. What is asserted here is
 * both halves: the usual crew moves up, and the rows that differ — above all
 * the one with nobody on it — keep theirs.
 */
describe("ScheduleBuilder crew line", () => {
  function board(trips: { id: string; crew: string[] }[]) {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: trips.map((trip) => baseTrip(trip)),
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );
  }

  const USUAL = ["Keiko Tanaka", "Sal Moretti"];

  it("states the usual crew once and drops it from the rows that run with it", () => {
    board([
      { id: "t1", crew: USUAL },
      { id: "t2", crew: USUAL },
      { id: "t3", crew: USUAL },
      { id: "t4", crew: ["Marcus Webb", "Sal Moretti"] },
    ]);

    expect(
      screen.getByText("Crew: Keiko Tanaka, Sal Moretti unless a departure says otherwise."),
    ).toBeInTheDocument();
    // Once, above the list — and nowhere on the three rows it speaks for.
    expect(screen.queryByText("Crew: Keiko Tanaka, Sal Moretti")).toBeNull();
    // The one that differs still says who is on it.
    expect(screen.getByText("Crew: Marcus Webb, Sal Moretti")).toBeInTheDocument();
  });

  /**
   * The case this change must never cause: a departure with nobody on it is
   * not "the usual crew", and hiding it behind a header would turn a staffing
   * gap into a silent one.
   */
  it("never hides a departure with nobody assigned", () => {
    board([
      { id: "t1", crew: USUAL },
      { id: "t2", crew: USUAL },
      { id: "t3", crew: USUAL },
      { id: "t4", crew: [] },
    ]);

    expect(screen.getByText("nobody yet")).toBeInTheDocument();
  });

  it("hoists nothing when two crews split the board evenly", () => {
    // 3/3 is not a majority, so there is no "usual" to state — and a header
    // claiming one would be wrong on half the rows.
    board([
      { id: "t1", crew: USUAL },
      { id: "t2", crew: USUAL },
      { id: "t3", crew: USUAL },
      { id: "t4", crew: ["Marcus Webb", "Sal Moretti"] },
      { id: "t5", crew: ["Marcus Webb", "Sal Moretti"] },
      { id: "t6", crew: ["Marcus Webb", "Sal Moretti"] },
    ]);

    expect(screen.queryByText(/unless a departure says otherwise/)).toBeNull();
    expect(screen.getAllByText("Crew: Keiko Tanaka, Sal Moretti")).toHaveLength(3);
  });

  it("leaves a short board alone, where a per-row line is still the exception", () => {
    board([
      { id: "t1", crew: USUAL },
      { id: "t2", crew: USUAL },
    ]);

    expect(screen.queryByText(/unless a departure says otherwise/)).toBeNull();
    expect(screen.getAllByText("Crew: Keiko Tanaka, Sal Moretti")).toHaveLength(2);
  });
});

describe("ScheduleBuilder unpriced-trip flag (task 150)", () => {
  it("flags a trip with no price set and links to its Details form", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip({ id: "trip-unpriced", priceCents: null })],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    const flag = screen.getByRole("link", { name: /set a price for/i });
    expect(flag).toHaveTextContent("No price set");
    expect(flag).toHaveAttribute("href", "/shop/blue-mantis/trips/trip-unpriced#details");
  });

  it("does not flag a trip that already has a price", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip({ id: "trip-priced", priceCents: 8500 })],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    expect(screen.queryByText("No price set")).toBeNull();
  });

  it("collapses the pill into one notice when every departure in the window is unpriced", () => {
    // A brand-new board (or an imported season) shares the fact on every row —
    // it moves up to one group-level notice instead of wallpapering the list
    // (design/principles.md #9).
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip({ id: "t1", priceCents: null }), baseTrip({ id: "t2", priceCents: null })],
      },
      {
        dateIso: "2026-08-02",
        label: "Sun, Aug 2",
        parts: { weekday: "Sun", day: "2", month: "Aug" },
        trips: [baseTrip({ id: "t3", priceCents: null })],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    expect(screen.getByText(/None of these departures has a price yet/)).toBeInTheDocument();
    expect(screen.queryByText("No price set")).toBeNull();
  });

  it("keeps per-row pills while the fact still distinguishes rows (some priced, some not)", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [
          baseTrip({ id: "t1", priceCents: null }),
          baseTrip({ id: "t2", priceCents: null }),
          baseTrip({ id: "t3", priceCents: null }),
          baseTrip({ id: "t4", priceCents: 8500 }),
        ],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    expect(screen.getAllByText("No price set")).toHaveLength(3);
    expect(screen.queryByText(/None of these departures/)).toBeNull();
  });
});

describe("ScheduleBuilder wind line (issue #722)", () => {
  function renderDay(trips: ReturnType<typeof baseTrip>[]) {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips,
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );
  }

  it("shows the server-formatted wind numbers when the row carries them", () => {
    renderDay([baseTrip({ id: "trip-wind", windSummary: "18 kt NE (gusts 22 kt)" })]);

    expect(screen.getByText("Wind: 18 kt NE (gusts 22 kt)")).toBeInTheDocument();
  });

  it("renders no wind line when the row has no forecast", () => {
    renderDay([baseTrip({ id: "trip-no-wind", windSummary: null })]);

    expect(screen.queryByText(/^Wind:/)).toBeNull();
  });
});

describe("ScheduleBuilder add panel: price, and options fetched on open", () => {
  const days: BuilderDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];

  function renderBuilder() {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );
  }

  it("offers an optional price box, currency-shaped by the server", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));

    const price = screen.getByLabelText(/Price per diver/);
    expect(price).toHaveAttribute("name", "priceDollars");
    // Optional in the honest sense: empty is a valid submission, and the row
    // then wears the "No price set" badge until somebody prices it.
    expect(price).not.toBeRequired();
    expect(price).toHaveValue(null);
    expect(price).toHaveAttribute("step", "0.01");
    expect(price).toHaveAttribute("placeholder", "$0.00");
  });

  it("asks for the course and dive-site lists only once a panel is open", async () => {
    renderBuilder();
    // Closed panel, no catalogue: the whole point of the change.
    expect(loadOptions).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    expect(loadOptions).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("option", { name: "Open Water Diver" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Molasses Reef" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Fun dive" })).toBeInTheDocument();

    // Reopening reuses what it already has — the catalogue does not change
    // while somebody schedules a week.
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    expect(loadOptions).toHaveBeenCalledTimes(1);
  });

  it("groups course choices by agency while keeping each agency's order", async () => {
    loadOptions.mockResolvedValueOnce({
      courses: [
        { id: "padi-ow", title: "Open Water Diver", agency: "padi" },
        { id: "ssi-ow", title: "SSI Open Water Diver", agency: "ssi" },
        { id: "other", title: "Custom Course", agency: "naui" },
      ],
      diveSites: [],
    });
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));

    const courseSelect = await vi.waitFor(() => {
      const select = container.querySelector('select[name="courseId"]');
      if (!select) throw new Error("course selector is not mounted yet");
      return select;
    });
    expect(courseSelect.querySelectorAll("optgroup")).toHaveLength(3);
    expect(courseSelect.querySelector('optgroup[label="PADI"]')).toHaveTextContent(
      "Open Water Diver",
    );
    expect(courseSelect.querySelector('optgroup[label="SSI"]')).toHaveTextContent(
      "SSI Open Water Diver",
    );
    expect(courseSelect.querySelector('optgroup[label="NAUI"]')).toHaveTextContent("Custom Course");
  });
});

describe("ScheduleBuilder row status slot — one grammar (issue 758)", () => {
  it("states a full boat in the same tabular text as every other count, not a success pill", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip({ id: "trip-full", capacity: 6, booked: 6 })],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    // A sold-out boat is the *expected* good outcome of a departure, not an
    // exception needing a staffer — so it keeps full-strength ink and weight
    // and gives up the pill, which was spending the currency the board's real
    // alerts use (design/principles.md #9, and #3's settled "good news is not
    // a row kind"). It used to be the single loudest mark on a board carrying
    // seven amber warnings.
    const count = screen.getByText("6/6");
    expect(count.className).not.toContain("bg-success-tint");
    expect(count.className).toContain("font-medium");
    expect(count.className).toContain("text-foreground");
    expect(count.className).toContain("tabular-nums");
  });

  it("keeps the count on a flagged row, and renders one pill rather than two", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [
          baseTrip({ id: "trip-unpriced", capacity: 12, booked: 5, priceCents: null }),
          // A second priced row keeps `allUnpriced` false, so the per-row pill
          // is the thing under test rather than the group-level notice.
          baseTrip({ id: "trip-priced", capacity: 8, booked: 2 }),
        ],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    // The flag names work to do; the count is still the row's own fact, so a
    // flagged row is not the one row on the board that cannot say how full it
    // is. One pill, one count — the same two-part shape every row wears.
    expect(screen.getByRole("link", { name: /set a price for/i })).toBeInTheDocument();
    expect(screen.getByText("5/12").className).toContain("text-muted");
  });

  it("lets an open roll call outrank the price flag instead of stacking two pills", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [
          baseTrip({
            id: "trip-back",
            capacity: 10,
            booked: 9,
            priceCents: null,
            rollCallOpen: { diveNumber: 2, uncounted: 3 },
          }),
          baseTrip({ id: "trip-priced", capacity: 8, booked: 2 }),
        ],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    // The boat is back with somebody uncounted. A departure that has already
    // sailed cannot be booked, so its missing price is not this morning's
    // problem — a second pill beside the loudest thing the board can say only
    // dilutes it.
    expect(screen.getByRole("link", { name: /finish the dive 2 roll call/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /set a price for/i })).toBeNull();
  });

  it("renders the count as quiet muted text — not a badge — while seats remain", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip({ id: "trip-open", capacity: 6, booked: 3 })],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    // Counts are facts, not alerts (design/principles.md #9): a routine 3/6
    // reads in the muted register, and no count on this board wears a pill.
    const count = screen.getByText("3/6");
    expect(count.className).toContain("text-muted");
    expect(count.className).not.toContain("bg-primary-tint");
  });
});

describe("ScheduleBuilder open-panel reset on revisit", () => {
  it("closes an expanded add/move/copy panel on a pathname change, instead of resurfacing it with stale defaults", async () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip()],
      },
    ];
    const { rerender } = render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toBeInTheDocument();

    // Simulate a navigate-away-and-back: the pathname changes and this
    // instance's effects re-run (an Activity re-show, should cacheComponents
    // be re-enabled, behaves like a fresh mount for effects, even though
    // state survived) — the schedule route has no dynamic id to key a fresh
    // instance by otherwise.
    setMockPathname("/shop/blue-mantis/schedule/board?foo=bar");
    rerender(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    expect(screen.queryByPlaceholderText(COPY.titlePlaceholder)).not.toBeInTheDocument();
  });
});

describe("ScheduleBuilder top add panel opened by link (?add=)", () => {
  const days: BuilderDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];
  const props = {
    shopSlug: "blue-mantis",
    days,
    loadOptions,
    price: PRICE,
    actions,
    defaultDateIso: "2026-08-01",
    canConfigure: true,
    copy: COPY,
    more: MORE,
    initialCourse: null,
  } as const;

  it("opens when the openAdd prop changes after mount, so the header link works twice", async () => {
    // The header's "Add a departure" is a Link to `?add=1` on this same
    // route — a client navigation that re-renders this instance with a new
    // prop rather than remounting it. Without the prop-change effect the
    // link opened the panel exactly once per mount.
    const { rerender } = render(<ScheduleBuilder {...props} openAdd="closed" />);
    expect(screen.queryByPlaceholderText(COPY.titlePlaceholder)).not.toBeInTheDocument();

    rerender(<ScheduleBuilder {...props} openAdd="quick" />);
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toBeInTheDocument();
  });

  it("stays open through a StrictMode double-invoke, so a cross-route link lands on the form", () => {
    // Every door into this form from *another* route — the catalogue's
    // "schedule a session of this course", the `/trips/new` 308, a pasted
    // `?add=full` — arrives as a fresh mount carrying `openAdd`, and React
    // runs every effect twice on mount in development. The disarm-on-revisit
    // effect used to close unconditionally on its second pass, so the panel
    // opened and shut again before anyone saw it and the whole catalogue
    // button read as dead. StrictMode here reproduces that second pass.
    render(
      <StrictMode>
        <ScheduleBuilder {...props} openAdd="quick" />
      </StrictMode>,
    );
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toBeInTheDocument();
  });

  it("clears the opening params on Cancel, keeping the rest of the URL", async () => {
    // Not `...Once`: the mount renders more than once (the open-panel state
    // settles in an effect), and Cancel's closure reads the *latest* render's
    // params. afterEach restores the empty default.
    useSearchParams.mockReturnValue(new URLSearchParams("add=1&after=cursor-2"));
    render(<ScheduleBuilder {...props} openAdd="quick" />);
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText(COPY.titlePlaceholder)).not.toBeInTheDocument();
    expect(routerReplace).toHaveBeenCalledWith("/shop/blue-mantis/schedule/board?after=cursor-2", {
      scroll: false,
    });
  });
});

describe("ScheduleBuilder panel focus management (accessibility audit §3)", () => {
  it("moves focus into the add panel's first field on open, and back to the toggle on cancel", async () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    const toggle = screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" });
    await userEvent.click(toggle);
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText(COPY.titlePlaceholder)).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("moves focus into the move panel's date field on open, and back to the row's actions control on cancel", async () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip()],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: /^Move Two-Tank Reef/ }));
    expect(screen.getByLabelText(COPY.newDate)).toHaveFocus();

    // The Move item lives inside the now-closed menu, so Cancel hands focus to
    // the control that is actually still on screen: the row's "⋯" trigger.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(COPY.newDate)).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("ScheduleBuilder row actions disclosure (design principles #8)", () => {
  const days: BuilderDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [baseTrip(), baseTrip({ id: "trip-2", title: "Night Dive" })],
    },
  ];

  function renderBoard() {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );
  }

  it("keeps the board quiet at rest: no per-verb buttons until a row is asked", () => {
    renderBoard();

    expect(screen.getAllByRole("button", { name: /^Move, copy, or remove / })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Move Two-Tank/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("opens the list with focus on its first action, and Escape hands focus back", async () => {
    renderBoard();

    const trigger = screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const move = screen.getByRole("button", { name: /^Move Two-Tank Reef/ });
    expect(move).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Move Two-Tank Reef/ })).toBeNull(),
    );
    expect(trigger).toHaveFocus();
  });

  it("dismisses on a click anywhere else, and only one row's list is ever open", async () => {
    renderBoard();

    await userEvent.click(
      screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
    );
    expect(screen.getByRole("button", { name: /^Move Two-Tank Reef/ })).toBeInTheDocument();

    // Opening the other row's list closes this one — same exclusivity the
    // panels already have.
    await userEvent.click(
      screen.getByRole("button", { name: /^Move, copy, or remove Night Dive/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Move Two-Tank Reef/ })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: /^Move Night Dive/ })).toBeInTheDocument();

    // A stray click on the page is a dismissal, never swallowed work — the
    // list holds no typed state.
    await userEvent.click(screen.getByRole("heading", { name: "Sat, Aug 1" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Move Night Dive/ })).toBeNull(),
    );
  });

  it("choosing an action closes the list and opens that action's panel", async () => {
    renderBoard();

    await userEvent.click(
      screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Copy Two-Tank Reef/ }));

    expect(screen.queryByRole("button", { name: /^Move Two-Tank Reef/ })).toBeNull();
    expect(screen.getByLabelText(COPY.copyTo)).toHaveFocus();
  });
});

describe("ScheduleBuilder unfinished after-dive roll call (DOM-H3)", () => {
  const returnedDay = (
    rollCallOpen: { diveNumber: number; uncounted: number } | null,
  ): BuilderDay[] => [
    {
      dateIso: "2026-07-31",
      label: "Fri, Jul 31",
      parts: { weekday: "Fri", day: "31", month: "Jul" },
      trips: [baseTrip({ id: "trip-returned", rollCallOpen })],
    },
  ];

  function renderBoard(days: BuilderDay[], actionOverrides: Partial<typeof actions> = {}) {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={{ ...actions, ...actionOverrides }}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );
  }

  it("flags a returned departure whose head count is still open, linking to that checkpoint", () => {
    renderBoard(returnedDay({ diveNumber: 2, uncounted: 3 }));

    const flag = screen.getByRole("link", { name: /finish the dive 2 roll call for/i });
    expect(flag).toHaveTextContent("Roll call · 3 not counted");
    // Straight to the open checkpoint, not the manifest's default departure tab.
    expect(flag).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-returned/manifest?checkpoint=after_dive_2",
    );
    // Says why a boat that already sailed is still sitting on the board.
    expect(
      screen.getByText("Back at the dock with the dive 2 roll call still open."),
    ).toBeInTheDocument();
  });

  it("never carries the danger tone on hue alone", () => {
    const { container } = renderBoard(returnedDay({ diveNumber: 1, uncounted: 1 }));

    // Badge's own aria-hidden mark for the three status tones — a colorblind
    // scan gets the mark before it gets to the words (design/principles.md #6).
    const badge = container.querySelector("a span.bg-danger-tint");
    expect(badge?.textContent).toContain("❌");
  });

  it("confirms a removal in a panel below the row, and only submits on the second press", async () => {
    // The confirmation used to be an `InlineConfirm` message card rendered
    // *inside* the inline Move/Copy/Remove cluster: arming it inflated a
    // padded, bordered box into a button row and shoved the badges and every
    // row beneath it around while the staffer read the sentence. It is a panel
    // now, like Move and Copy, and still two deliberate presses.
    const remove = vi.fn();
    renderBoard(returnedDay(null), { remove });

    const row = screen.getByRole("listitem");
    await userEvent.click(within(row).getByRole("button", { name: /^Move, copy, or remove / }));
    await userEvent.click(within(row).getByRole("button", { name: /^Remove / }));

    const panel = within(row).getByRole("alert");
    expect(panel).toHaveTextContent("Take “Two-Tank Reef” off the board for good?");
    // Arming submits nothing at all.
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(within(row).getByRole("button", { name: "Never mind" }));
    expect(within(row).queryByRole("alert")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("hides the actions control on a returned row, whose mutations all refuse", () => {
    renderBoard(returnedDay({ diveNumber: 1, uncounted: 2 }));

    expect(screen.queryByRole("button", { name: /^Move, copy, or remove / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("says nothing on an ordinary upcoming departure", () => {
    renderBoard(returnedDay(null));

    expect(screen.queryByText(/not counted/)).toBeNull();
    expect(screen.queryByText(/roll call still open/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
    ).toBeInTheDocument();
  });
});

describe("ScheduleBuilder add panel: one form, two depths (ADR 20260806-one-trip-create-form)", () => {
  const days: BuilderDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];

  function renderBuilder(overrides: Partial<ComponentProps<typeof ScheduleBuilder>> = {}) {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
        {...overrides}
      />,
    );
  }

  /** What the form would actually post right now. */
  const submittedKeys = (container: HTMLElement) => {
    const form = container.querySelector("form");
    if (!form) throw new Error("the add panel is not open");
    return [...new FormData(form).keys()];
  };

  it("keeps the rare half collapsed, and reveals the whole trip form on request", async () => {
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));

    // Collapsed: the questions the board is for are live, the rest inert.
    // (Inert, not absent — the disclosure hides rather than unmounts. What is
    // *on screen* is a stylesheet's job and the visual specs' to prove; what
    // this asserts is the half that decides the payload.)
    expect(screen.getByLabelText("What is it")).toBeEnabled();
    expect(screen.getByLabelText("Seats")).toBeEnabled();
    expect(screen.getByLabelText("Dives")).toBeEnabled();
    expect(screen.getByLabelText(/^Description/)).toBeDisabled();
    expect(screen.getByLabelText("How many days")).toBeDisabled();
    expect(screen.getByLabelText(/Deposit per diver/)).toBeDisabled();
    expect(screen.getByLabelText("How often")).toBeDisabled();

    const more = screen.getByRole("button", { name: /More options/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);

    // Expanded: everything /trips/new used to ask, on the same form.
    expect(screen.getByLabelText(/^Description/)).toBeEnabled();
    expect(screen.getByLabelText("How many days")).toBeEnabled();
    expect(screen.getByLabelText(/Deposit per diver/)).toBeEnabled();
    expect(screen.getByLabelText(/Free cancellation window/)).toBeEnabled();
    expect(screen.getByLabelText("How often")).toBeEnabled();
    expect(screen.getByLabelText("Number of dives")).toBeEnabled();
    // …and the quick dive box has handed over rather than vanished.
    expect(screen.getByLabelText("Dives")).toBeDisabled();
    // Still one submit — expanding deepens the form, it never forks it.
    expect(screen.getAllByRole("button", { name: "Put it on the board" })).toHaveLength(1);
    expect(submittedKeys(container)).toContain("dayCount");
  });

  it("posts only the quick fields while collapsed, though the rest stay mounted", async () => {
    // The disclosure hides rather than unmounts (nothing typed is ever lost),
    // so "not on screen" has to mean "disabled" or a collapsed submission would
    // carry a hidden `dayCount`, deposit, and cadence nobody chose.
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));
    await userEvent.click(screen.getByRole("button", { name: /Fewer options/ }));

    const keys = submittedKeys(container);
    expect(keys).toContain("plannedDives");
    expect(keys).toContain("diveSiteId");
    for (const hidden of [
      "description",
      "dayCount",
      "depositDollars",
      "cancellationWindowHours",
      "repeatIntervalWeeks",
      "dive-1-siteId",
    ]) {
      expect(keys).not.toContain(hidden);
    }
  });

  it("never posts two dive counts: the quick box gives way to the dive plan's own", async () => {
    // `plannedDives` decides how many dive cards render, so two *enabled*
    // controls sharing the name would make the last in the DOM win silently.
    const { container } = renderBuilder();
    const enabled = (name: string) =>
      container.querySelectorAll(`[name="${name}"]:not(:disabled)`).length;

    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    expect(enabled("plannedDives")).toBe(1);
    expect(enabled("diveSiteId")).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: /More options/ }));
    expect(enabled("plannedDives")).toBe(1);
    // One site for the day, or one per dive — never both.
    expect(enabled("diveSiteId")).toBe(0);
    expect(enabled("dive-1-siteId")).toBe(1);
  });

  it("carries the quick dive count and site into the dive plan on first expand", async () => {
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await screen.findByRole("option", { name: "Molasses Reef" });

    await userEvent.clear(screen.getByLabelText("Dives"));
    await userEvent.type(screen.getByLabelText("Dives"), "3");
    const quickSite = container.querySelector('[name="diveSiteId"]');
    if (!quickSite) throw new Error("the quick dive-site select is missing");
    await userEvent.selectOptions(quickSite, "site-1");

    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    // Three dives asked for, three dive cards — not the default two.
    expect(screen.getByLabelText("Number of dives")).toHaveValue("3");
    expect(container.querySelectorAll('[name^="dive-"][name$="-siteId"]')).toHaveLength(3);
    // …and the site chosen in the quick row is dive one's, not thrown away.
    expect(container.querySelector('[name="dive-1-siteId"]')).toHaveValue("site-1");
  });

  it("loses nothing across expand → collapse → expand", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await screen.findByRole("option", { name: "Molasses Reef" });
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    await userEvent.type(screen.getByLabelText(/^Description/), "Bring a light");
    await userEvent.clear(screen.getByLabelText("How many days"));
    await userEvent.type(screen.getByLabelText("How many days"), "3");
    await userEvent.type(screen.getByLabelText(/Deposit per diver/), "40");
    await userEvent.selectOptions(screen.getByLabelText("How often"), "2");
    await userEvent.type(screen.getAllByLabelText(/^Name/)[0], "Morning reef");

    await userEvent.click(screen.getByRole("button", { name: /Fewer options/ }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    expect(screen.getByLabelText(/^Description/)).toHaveValue("Bring a light");
    expect(screen.getByLabelText("How many days")).toHaveValue(3);
    expect(screen.getByLabelText(/Deposit per diver/)).toHaveValue(40);
    expect(screen.getByLabelText("How often")).toHaveValue("2");
    expect(screen.getAllByLabelText(/^Name/)[0]).toHaveValue("Morning reef");
  });

  it("mirrors the dive plan's count back to the quick box on the way down", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));
    await userEvent.selectOptions(screen.getByLabelText("Number of dives"), "4");
    await userEvent.click(screen.getByRole("button", { name: /Fewer options/ }));

    // Collapsed, the quick box is what submits — it must agree with what the
    // staff member last chose, not with the default it was mounted at.
    expect(screen.getByLabelText("Dives")).toHaveValue(4);
  });

  it("opens already pointed at the course a catalogue link named", async () => {
    renderBuilder({
      openAdd: "quick",
      initialCourse: {
        id: "course-1",
        title: "Open Water Diver",
        requirement: "No existing C-card required",
      },
    });

    // No click needed — the link was the click.
    const course = await screen.findByLabelText(/^Course/);
    expect(course).toHaveValue("course-1");
    expect(screen.getByLabelText("What is it")).toHaveAttribute(
      "placeholder",
      "Open Water Diver — Session 1",
    );
    expect(screen.getByText(/No existing C-card required · add an instructor/)).toBeInTheDocument();
  });

  it("opens already pointed at the dive site a library link named", async () => {
    const { container } = renderBuilder({
      openAdd: "quick",
      initialSite: {
        id: "site-1",
        name: "Molasses Reef",
      },
    });

    const site = container.querySelector('select[name="diveSiteId"]');
    expect(site).toHaveValue("site-1");
  });

  it("opens at full depth for a link that meant the whole form", async () => {
    renderBuilder({ openAdd: "expanded" });
    expect(await screen.findByLabelText("How often")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fewer options" })).toBeInTheDocument();
  });

  it("tells a captain whose job scheduling is, rather than showing an empty board", () => {
    renderBuilder({ canConfigure: false });

    expect(screen.queryByRole("button", { name: /Add a departure/ })).toBeNull();
    expect(screen.getByText(/limited to owners, managers, and instructors/)).toBeInTheDocument();
  });
});

/**
 * The request-plan panel is the one place on the board where staff copy is
 * composed on the *client* from a template the server handed over unformatted.
 * That boundary is where issue #606 lived: `boats.requestPlanCrewSuggestion`
 * carried an ICU plural, the page fetched it with `st()` — which formats — and
 * so raised a `FORMATTING_ERROR` on every board render outside production,
 * while production swallowed the error and printed the ICU source to the shop.
 *
 * These tests therefore take their copy from the **real** bundles through a
 * real `staffTranslator`, not from the `COPY` fixture above: a fixture cannot
 * throw the way the page did, and cannot leak a template the fixture doesn't
 * carry. Both locales, and both sides of the plural.
 */
describe("ScheduleBuilder request plan: copy composed on the client", () => {
  const days: BuilderDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];

  /** The half of the copy map `page.tsx` builds for this panel, built the same way. */
  function requestPlanCopy(locale: string) {
    const st = staffTranslator(locale);
    return {
      requestPlanHeading: st("schedule.builder.requestPlanHeading"),
      requestPlanDescription: st("schedule.builder.requestPlanDescription"),
      requestPlanRecommendation: st.raw("schedule.builder.requestPlanRecommendation"),
      requestPlanRecommendationDiversOne: st.raw(
        "schedule.builder.requestPlanRecommendationDiversOne",
      ),
      requestPlanRecommendationDiversOther: st.raw(
        "schedule.builder.requestPlanRecommendationDiversOther",
      ),
      requestPlanRecommendationCapacityOne: st.raw(
        "schedule.builder.requestPlanRecommendationCapacityOne",
      ),
      requestPlanRecommendationCapacityOther: st.raw(
        "schedule.builder.requestPlanRecommendationCapacityOther",
      ),
      requestPlanDiversOne: st.raw("schedule.builder.requestPlanDiversOne"),
      requestPlanDiversOther: st.raw("schedule.builder.requestPlanDiversOther"),
      requestPlanPersonOne: st.raw("schedule.builder.requestPlanPersonOne"),
      requestPlanPersonOther: st.raw("schedule.builder.requestPlanPersonOther"),
      requestPlanBoatRecommendationOne: st.raw("boats.requestPlanBoatRecommendationOne"),
      requestPlanBoatRecommendationOther: st.raw("boats.requestPlanBoatRecommendationOther"),
      requestPlanBoatExceeded: st("boats.requestPlanBoatExceeded"),
      requestPlanCrewSuggestionOne: st.raw("boats.requestPlanCrewSuggestionOne"),
      requestPlanCrewSuggestionOther: st.raw("boats.requestPlanCrewSuggestionOther"),
    };
  }

  function renderPlan(locale: string, divemasters: number, divers: number) {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        copy={{ ...COPY, ...requestPlanCopy(locale) }}
        more={MORE}
        initialCourse={null}
        openAdd="expanded"
        requestPlan={{
          estimatedDivers: divers,
          suggestedCapacity: 12,
          suggestedDivemasters: divemasters,
          diversPerDivemaster: 4,
          suggestedBoatName: "Reef Runner",
          exceedsKnownBoats: false,
          requests: [{ id: "inq-1", name: "Marisol", subject: "Saturday reef", divers }],
        }}
      />,
    );
  }

  /**
   * The finished sentence, spelled out rather than rebuilt from the bundle —
   * a fixture that composes the expectation the same way the component does
   * agrees with any bug both of them share. `diversPerDivemaster` is 4 in the
   * plan below, so the ratio is fixed too.
   */
  const CASES = [
    {
      locale: "en-US",
      count: 1,
      panel: "Starting from requests",
      crew: "Bring 1 divemaster — your 4:1 target.",
      lead: "Marisol (1 diver)",
    },
    {
      locale: "en-US",
      count: 3,
      panel: "Starting from requests",
      crew: "Bring 3 divemasters — your 4:1 target.",
      lead: "Marisol (3 divers)",
    },
    {
      locale: "es-ES",
      count: 1,
      panel: "Partir de las peticiones",
      crew: "Lleva 1 divemaster — tu objetivo de 4:1.",
      lead: "Marisol (1 buceador)",
    },
    {
      locale: "es-ES",
      count: 3,
      panel: "Partir de las peticiones",
      crew: "Lleva 3 divemasters — tu objetivo de 4:1.",
      lead: "Marisol (3 buceadores)",
    },
  ];

  for (const expected of CASES) {
    it(`says the ${expected.count === 1 ? "singular" : "plural"} in ${expected.locale}`, () => {
      renderPlan(expected.locale, expected.count, expected.count);

      const panel = screen.getByRole("group", { name: expected.panel });
      expect(within(panel).getByText(expected.crew)).toBeInTheDocument();
      expect(within(panel).getByText(expected.lead)).toBeInTheDocument();
      // The failure mode in one line: an unresolved template — an ICU plural
      // `fill()` cannot see, or a `{name}` nobody supplied — reaches the reader
      // as a brace.
      expect(panel.textContent).not.toContain("{");
    });
  }
});

/**
 * **The week, at `xl` and up** — ADR 20260827-clearwater-surface-language,
 * decision 5, and the width floor H-63 set on 2026-08-27.
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
      meta: "10 of 12 · $95",
      dayCount: 1,
      status: "upcoming" as const,
      unpriced: false,
      ref: "Two-Tank Reef, Thu, Aug 27 7:00 AM – 10:30 AM",
      ...overrides,
    };
  }

  function weekSpan(overrides: Partial<WeekSpan> & { tripId: string }): WeekSpan {
    return {
      title: "Open Water Diver — three-day course",
      meta: "4 of 5 · $595 · Marcus Webb",
      dateIso: "2026-08-28",
      startTime: "08:00",
      dayCount: 3,
      status: "upcoming" as const,
      unpriced: false,
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
        isToday: dateIso === "2026-08-27",
        isPast: dateIso < "2026-08-27",
        entries: [],
      })),
      spans: [],
      ...overrides,
    };
  }

  function board(weekProps: BuilderWeek | null, canConfigure = true) {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-27",
        label: "Thu, Aug 27",
        parts: { weekday: "Thu", day: "27", month: "Aug" },
        trips: [baseTrip()],
      },
    ];
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        days={days}
        loadOptions={loadOptions}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-27"
        canConfigure={canConfigure}
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
        week={weekProps}
      />,
    );
  }

  /** The one grid on the page, whatever else shares its words. */
  const grid = () => screen.getByRole("region", { name: "The week" });

  it("declares the xl floor on both compositions, so only one is ever on screen", () => {
    const { container } = board(week());

    // The grid appears at `xl` and up …
    expect(grid().className).toContain("hidden");
    expect(grid().className).toContain("xl:block");
    // … and the stream stops exactly where it starts. Without the second
    // half the two would render at once at desktop, which is the whole
    // failure the floor exists to prevent.
    const stream = container.querySelector(".xl\\:hidden");
    expect(stream).not.toBeNull();
    expect(stream?.textContent).toContain("Two-Tank Reef");
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
    // Fri, Sat and Sun — the three days the bar covers — carry the bar and
    // nothing else. A course drawn as a bar *and* three entries is the same
    // fact said four times.
    expect(within(grid()).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("says nothing in a day with no departures", () => {
    board(week());

    // No per-cell empty copy anywhere: an empty column is the information
    // this grid exists to show.
    expect(within(grid()).queryAllByRole("listitem")).toHaveLength(0);
    // What an empty day still ahead does carry is its own way to fill it —
    // and a day already behind carries none, because a departure is put on
    // the board and the board is ahead. Aug 27 is "today" in this fixture, so
    // four of the seven can take one.
    expect(
      within(grid()).getAllByRole("button", { name: /^Add a departure on Day / }),
    ).toHaveLength(4);
    for (const past of ["Day 24", "Day 25", "Day 26"]) {
      expect(
        within(grid()).queryByRole("button", { name: `Add a departure on ${past}` }),
      ).toBeNull();
    }
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
                    meta: "Sailed · 9 of 12",
                    ref: "Benwood & Elbow, Mon, Aug 24 11:30 AM – 3:00 PM",
                  }),
                ],
              }
            : day,
        ),
      }),
    );

    expect(within(grid()).getByText("Sailed · 9 of 12")).toBeTruthy();
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
                    meta: "0 of 12",
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
    expect(flag).toHaveAttribute("href", "/shop/blue-mantis/trips/sunday-1#details");
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
    expect(screen.getByLabelText("New departure time")).toHaveValue("07:00");
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
    expect(screen.getByLabelText("New departure time")).toHaveValue("08:00");
    // Three days move together, and the form says so — the same note the
    // stream's own move panel carries for a course.
    expect(screen.getByText("All 3 days move together, keeping their gaps.")).toBeTruthy();

    // Copy and remove reach the course from the same menu.
    await user.click(
      within(grid()).getByRole("button", { name: /^Move, copy, or remove Open Water Diver/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Copy Open Water Diver/ }));
    expect(screen.getByLabelText("Copy to")).toHaveValue("2026-09-04");

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
        spans: [weekSpan({ tripId: "course-1", unpriced: true, meta: "4 of 5 · Marcus Webb" })],
      }),
    );

    const flag = within(grid()).getByRole("link", {
      name: "Set a price for Open Water Diver — three-day course, Aug 28 – 30, 2026",
    });
    expect(flag).toHaveAttribute("href", "/shop/blue-mantis/trips/course-1#details");
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

    // Trip definition is owner/manager/instructor work (H-14); the crew read
    // the week and run the day from each departure's own page.
    expect(within(grid()).queryAllByRole("button", { name: /^Add a departure on / })).toHaveLength(
      0,
    );
    expect(within(grid()).queryByRole("button", { name: /^Move, copy, or remove / })).toBeNull();
    expect(within(grid()).getByRole("link", { name: "Two-Tank Reef" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1",
    );
  });
});
