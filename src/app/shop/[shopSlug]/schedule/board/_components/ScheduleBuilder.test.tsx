// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { MovePreflight } from "@/lib/move-preflight";
import {
  type BuilderCopy,
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
  typedAs: "typed as “{raw}”",
  draftPickedUp: "Picked up from the desk, {time}.",
  draftStartOver: "Start over",
  patternFilled: "Filled from your last {count} {weekday} departures. Change anything, or",
  patternStartBlank: "start blank",
  patternCrew: "{names} crewed them.",
  patternAlsoUsual: "{time} · {title} ran on {count} of those days too.",
  patternAlsoUsualUntitled: "{time} · another departure ran on {count} of those days too.",
  patternAddAlso: "Add it as well",
  ariaLabel: "Schedule builder",
  addDepartureOnDay: "Add a departure on {day}",
  add: "Add",
  cancel: "Cancel",
  noSiteSetYet: "No site set yet",
  courseLabel: "Course · {title}",
  dayCountLabelOne: "{count} day",
  dayCountLabelOther: "{count} days",
  impactTitle: "If you move it",
  impactCrewClash: "{name} is already crewing {departure} at that time and cannot be on both.",
  impactCrewAway: "{name} has told you they are away then.",
  impactToldOne: "{count} diver has already been told this date. Moving it sends nothing.",
  impactToldOther: "{count} divers have already been told this date. Moving it sends nothing.",
  impactGearOne: "{count} reserved unit travels with it.",
  impactGearOther: "{count} reserved units travel with it.",
  impactPaidOne: "{count} seat is already paid.",
  impactPaidOther: "{count} seats are already paid.",
  impactWindowOne: "Cancellations close {count} hour before it departs.",
  impactWindowOther: "Cancellations close {count} hours before it departs.",
  impactBlockedSailed: "The crew has already counted heads against this departure.",
  impactBlockedNotScheduled: "A cancelled trip can’t be moved.",
  crewLabel: "Crew:",
  crewNobodyYet: "nobody yet",
  windLabel: "Wind:",
  noPriceSet: "No price set",
  noPriceSetAria: "Set a price for {ref}",
  noPriceSetAll:
    "None of these departures has a price yet, and divers already see them on the schedule. Open a departure to set one.",
  noBoats: "No boats",
  asked: "Asked for",
  addDeparture: "Add a departure",
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
  copyDescription: "Same dive, same seats, same price, with no divers and no crew.",
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
  descriptionPlaceholder: "Sites, conditions, who it’s for.",
  isPrivateLabel: "Private charter",
  selfGuidedLabel: "Self-guided dive",
  selfGuidedHint: "Buddy pairs go in without a guide.",
  isPrivateHint:
    "Off the public schedule. Anyone with the link can see the departure and book a seat.",
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
  howOftenLabel: "How often",
  doesntRepeat: "Doesn’t repeat",
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

/** One departure as a spec writes it — the fields these fixtures have always set. */
type FixtureTrip = {
  id: string;
  title: string;
  dateIso: string;
  startTime: string;
  timeRange: string;
  capacity: number;
  booked: number;
  courseTitle: string | null;
  diveSiteName: string | null;
  dayCount: number;
  crew: string[];
  priceCents: number | null;
  rollCallOpen: { diveNumber: number; uncounted: number } | null;
};

function baseTrip(overrides: Partial<FixtureTrip> = {}): FixtureTrip {
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

/**
 * A day of fixture departures, in the shape these specs have always written
 * them. It was `BuilderDay` until the board lost its second composition
 * (#1923); the type went with the stream and the fixtures stayed, because
 * what a spec wants to say is still "on this day, these boats".
 */
type FixtureDay = {
  dateIso: string;
  label: string;
  parts: { weekday: string; day: string; month: string };
  trips: FixtureTrip[];
  boatWarning?: string | null;
};

/**
 * **The one board, built from a spec's own days.**
 *
 * Every flow below used to drive the vertical day stream, because the fleet
 * ran one pixel under `xl` and that is what rendered there. The stream is gone
 * and the week renders at every width, so the fixtures are converted rather
 * than rewritten: a spec still says "a Saturday with these two boats" and gets
 * the composition the product actually has.
 *
 * The day's `label` carries through untouched — it is what names the per-day
 * "Add a departure on …" button, in the week exactly as in the stream, which
 * is why most of these specs needed nothing but this.
 */
function weekFrom(days: FixtureDay[], overrides: Partial<BuilderWeek> = {}): BuilderWeek {
  const first = days[0]?.dateIso ?? "2026-08-01";
  return {
    ariaLabel: "The week",
    rangeLabel: "The week",
    previousHref: `/shop/blue-mantis/schedule/board?week=${first}`,
    nextHref: `/shop/blue-mantis/schedule/board?week=${first}`,
    thisWeekHref: null,
    allUnpriced: false,
    nextDeparture: null,
    seatTally: "",
    asked: [],
    askedCount: "0 days",
    words: { previous: "Previous week", next: "Next week", thisWeek: "This week", today: "Today" },
    days: days.map((day) => ({
      dateIso: day.dateIso,
      weekday: day.parts.weekday,
      dayNumber: day.parts.day,
      label: day.label,
      isToday: false,
      isPast: false,
      boatWarning: day.boatWarning ?? null,
      entries: day.trips.map((trip) => ({
        tripId: trip.id,
        dateIso: day.dateIso,
        startTime: trip.startTime,
        title: trip.title,
        time: trip.timeRange.split(" – ")[0] ?? trip.timeRange,
        mark: "reef" as const,
        meta: [trip.diveSiteName, `${trip.booked} of ${trip.capacity}`].filter(Boolean).join(" · "),
        seats: { booked: trip.booked, capacity: trip.capacity },
        crew: trip.crew,
        dayCount: trip.dayCount,
        status: "upcoming" as const,
        unpriced: trip.priceCents === null,
        rollCallOpen: trip.rollCallOpen,
        ref: `${trip.title}, ${day.label} ${trip.timeRange}`,
      })),
    })),
    spans: [],
    ...overrides,
  };
}

const noop = vi.fn();
const actions = {
  add: noop,
  move: noop,
  duplicate: noop,
  remove: noop,
  draft: { save: async () => {}, discard: async () => {} },
};

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

/**
 * The move panel's impact preview (issue #1203). Quiet by default — most tests
 * here are about other panels entirely, and a departure with no consequences
 * renders no block, which is the shape the component must stay correct in.
 */
const loadMovePreflight = vi.fn(
  async (
    _tripId: string,
    _target: { date: string; startTime: string } | null,
  ): Promise<MovePreflight | null> => ({ blocked: null, sections: [] }),
);

afterEach(() => {
  cleanup();
  loadOptions.mockClear();
  loadMovePreflight.mockClear();
  loadMovePreflight.mockImplementation(async () => ({ blocked: null, sections: [] }));
  routerReplace.mockClear();
  useSearchParams.mockReturnValue(new URLSearchParams());
  setMockPathname("/shop/blue-mantis/schedule/board");
});

describe("ScheduleBuilder add panel: price, and options fetched on open", () => {
  const days: FixtureDay[] = [
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
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
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

  /**
   * **The self-guided box goes away once a course is picked** (issue #1342).
   *
   * Self-guided means the divers go in unguided in buddy pairs; a certification
   * dive requires the instructor supervising. `insertTripInstance` refuses the
   * combination whatever this form posts, so the box would be *ignored* rather
   * than obeyed — and a control that has no effect is worse than one that is
   * absent, because a staffer who ticks it believes something about the day
   * that is not true.
   *
   * Asserted on the input itself rather than on the label, because the panel
   * hides with a class: a `hidden` wrapper still submits its checkbox.
   */
  it("takes the self-guided box away once a course is chosen", async () => {
    loadOptions.mockResolvedValueOnce({
      courses: [{ id: "padi-ow", title: "Open Water Diver", agency: "padi" }],
      diveSites: [],
    });
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));

    const courseSelect = (await vi.waitFor(() => {
      const select = container.querySelector('select[name="courseId"]');
      if (!select) throw new Error("course selector is not mounted yet");
      return select;
    })) as HTMLSelectElement;

    // The box lives in the disclosed half of the panel, beside the course
    // picker it now depends on.
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    const selfGuided = () => container.querySelector('input[name="selfGuided"]');
    // Offered on a fun dive, which is what the panel opens as.
    expect(selfGuided()).not.toBeNull();
    expect((selfGuided() as HTMLInputElement).disabled).toBe(false);
    expect(selfGuided()?.closest(".hidden")).toBeNull();

    await userEvent.selectOptions(courseSelect, "padi-ow");
    // Both halves, because they fail differently: a `hidden` wrapper still
    // submits the checkbox it contains, so hiding without disabling would
    // leave the value posted and only the explanation missing.
    expect(selfGuided()?.closest(".hidden")).not.toBeNull();
    expect((selfGuided() as HTMLInputElement).disabled).toBe(true);

    // And back, because clearing the course makes the departure a fun dive
    // again — the rule is about course sessions, not about the mark.
    await userEvent.selectOptions(courseSelect, "");
    expect(selfGuided()?.closest(".hidden")).toBeNull();
    expect((selfGuided() as HTMLInputElement).disabled).toBe(false);
  });
});

/**
 * **The add panel already knows the weekday** (ADR 20260906-before-you-ask,
 * decision 3). The rule pinned: a panel opened plainly fills its own fields
 * from the weekday's pattern once the option lists are on screen and says so
 * in one line; the crew come as chips the desk can take off; "start blank"
 * empties what the pattern wrote; and a panel that arrived with a draft, a
 * course, or a site asks for no pattern at all.
 */
describe("ScheduleBuilder add panel: the weekday pattern", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];
  const pattern = {
    weekday: 6,
    sampledDays: 6,
    fields: {
      startTime: "07:00",
      endTime: "10:30",
      title: "Two-Tank Reef",
      diveSiteId: "site-1",
      capacity: "10",
      priceDollars: "95",
    },
    crew: [
      { id: "keiko", name: "Keiko Tanaka" },
      { id: "sal", name: "Sal Moreno" },
    ],
    alsoUsual: { startTime: "13:00", timeLabel: "1:00 PM", title: "Wreck Trip", days: 4 },
  };
  const loadPattern = vi.fn(async (_dateIso: string) => pattern);

  function renderBuilder(extra: Partial<ComponentProps<typeof ScheduleBuilder>> = {}) {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        loadPattern={loadPattern}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
        {...extra}
      />,
    );
  }

  afterEach(() => {
    loadPattern.mockClear();
  });

  it("fills the panel from the weekday, names the crew as chips, and offers the second boat", async () => {
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    expect(loadPattern).toHaveBeenCalledWith("2026-08-01");

    expect(
      await screen.findByText("Filled from your last 6 Sat departures. Change anything, or"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("What is it")).toHaveValue("Two-Tank Reef");
    expect(screen.getByLabelText("Departs")).toHaveValue("7:00 AM");
    expect(container.querySelector('input[name="startTime"]')).toHaveValue("07:00");
    expect(container.querySelector('select[name="diveSiteId"]')).toHaveValue("site-1");
    expect(screen.getByLabelText("Seats")).toHaveValue(10);
    expect(screen.getByLabelText(/Price per diver/)).toHaveValue(95);

    // The crew ride along as hidden fields, one per chip, and one line names them.
    expect(
      [...container.querySelectorAll('input[name="crewPersonIds"]')].map((el) =>
        el.getAttribute("value"),
      ),
    ).toEqual(["keiko", "sal"]);
    expect(screen.getByText("Keiko Tanaka and Sal Moreno crewed them.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove: Sal Moreno" }));
    expect(
      [...container.querySelectorAll('input[name="crewPersonIds"]')].map((el) =>
        el.getAttribute("value"),
      ),
    ).toEqual(["keiko"]);

    // The second departure is one row, off until ticked, carrying its start time.
    const also = screen.getByRole("checkbox", {
      name: /1:00 PM · Wreck Trip ran on 4 of those days too/,
    });
    expect(also).not.toBeChecked();
    expect(also).toHaveAttribute("name", "alsoUsualStart");
    expect(also).toHaveAttribute("value", "13:00");
  });

  it("starts blank on request: the fields empty, the crew gone, the line gone", async () => {
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await screen.findByText(/Filled from your last 6 Sat departures/);
    await userEvent.click(screen.getByRole("button", { name: "start blank" }));

    expect(screen.getByLabelText("What is it")).toHaveValue("");
    expect(container.querySelector('input[name="startTime"]')).toHaveValue("08:30");
    expect(container.querySelector('select[name="diveSiteId"]')).toHaveValue("");
    expect(container.querySelectorAll('input[name="crewPersonIds"]')).toHaveLength(0);
    expect(screen.queryByText(/Filled from your last/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Wreck Trip/ })).not.toBeInTheDocument();
  });

  it("asks for no pattern when the panel arrived with something to say already", async () => {
    renderBuilder({
      addDraft: { fields: { title: "Night dive" }, savedAtLabel: "4:12 PM" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    expect(await screen.findByLabelText("What is it")).toHaveValue("Night dive");
    expect(loadPattern).not.toHaveBeenCalled();

    cleanup();
    renderBuilder({
      openAdd: "quick",
      initialCourse: { id: "course-1", title: "Open Water Diver", requirement: "" },
    });
    expect(await screen.findByLabelText("What is it")).toBeInTheDocument();
    expect(loadPattern).not.toHaveBeenCalled();
  });
});

describe("ScheduleBuilder open-panel reset on revisit", () => {
  it("closes an expanded add/move/copy panel on a pathname change, instead of resurfacing it with stale defaults", async () => {
    const days: FixtureDay[] = [
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
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
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
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
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
  const days: FixtureDay[] = [
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
    loadMovePreflight,
    locale: "en-US",
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
    const days: FixtureDay[] = [
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
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
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
    const days: FixtureDay[] = [
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
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
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

describe("ScheduleBuilder add panel: one form, two depths (ADR 20260806-one-trip-create-form)", () => {
  const days: FixtureDay[] = [
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
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
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
  const days: FixtureDay[] = [
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
        locale={locale}
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
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
      crew: "Bring 1 divemaster for your 4:1 target.",
      lead: "Marisol (1 diver)",
    },
    {
      locale: "en-US",
      count: 3,
      panel: "Starting from requests",
      crew: "Bring 3 divemasters for your 4:1 target.",
      lead: "Marisol (3 divers)",
    },
    {
      locale: "es-ES",
      count: 1,
      panel: "Partir de las peticiones",
      crew: "Lleva 1 divemaster para tu objetivo de 4:1.",
      lead: "Marisol (1 buceador)",
    },
    {
      locale: "es-ES",
      count: 3,
      panel: "Partir de las peticiones",
      crew: "Lleva 3 divemasters para tu objetivo de 4:1.",
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
      mark: "reef" as const,
      startTime: "07:00",
      title: "Two-Tank Reef",
      time: "7:00 AM",
      meta: "10 of 12 · $95",
      seats: { booked: 10, capacity: 12 },
      // Unstaffed by default, which is the loud case: a factory that defaulted
      // to a crew would let a row quietly stop printing its gap.
      crew: [] as string[],
      dayCount: 1,
      status: "upcoming" as const,
      unpriced: false,
      rollCallOpen: null,
      ref: "Two-Tank Reef, Thu, Aug 27 7:00 AM – 10:30 AM",
      ...overrides,
    };
  }

  function weekSpan(overrides: Partial<WeekSpan> & { tripId: string }): WeekSpan {
    return {
      title: "Open Water Diver — three-day course",
      meta: "4 of 5 · $595 · Marcus Webb",
      seats: { booked: 4, capacity: 5 },
      runsLabel: "3 days",
      dateIso: "2026-08-28",
      startTime: "08:00",
      dayCount: 3,
      status: "upcoming" as const,
      unpriced: false,
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
        shopSlug="blue-mantis"
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-27"
        canConfigure={canConfigure}
        locale="en-US"
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
    expect(within(grid()).getAllByText("No boats")).toHaveLength(7);
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
    // The time box settles to what it reads and a hidden control submits the
    // HH:MM the server expects (ADR 20260906-before-you-ask, decision 3).
    expect(screen.getByLabelText("New departure time")).toHaveValue("7:00 AM");
    expect(document.querySelector('input[type="hidden"][name="startTime"]')).toHaveValue("07:00");
  });

  /**
   * **The board has one panel, not one per composition** (issue #1309).
   *
   * The day stream and the week grid are both mounted at once and hidden from
   * each other by CSS, and each used to render its own Move/Copy/Remove keyed
   * `move:<id>` and `w:move:<id>`. So the open panel belonged to exactly one of
   * them, and crossing `xl` made it vanish with whatever had been typed into
   * it — rotate a tablet, un-maximise a window, open devtools.
   *
   * jsdom applies no media query, so both compositions are *visible* here.
   * That makes this the right place to pin the structural half, which is the
   * half that fixes the bug: whichever side opens the panel, there is exactly
   * one of it and it sits outside both subtrees, so no media query can reach
   * it. A shared key alone would have produced two — two controls labelled
   * "New date" in the DOM, breaking strict-mode locators and duplicating a
   * labelled control for assistive technology.
   */
  it("renders one move panel, outside both compositions, from whichever opened it", async () => {
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

    const openFromGrid = async () => {
      await user.click(
        within(grid()).getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
      );
      await user.click(screen.getByRole("button", { name: /^Move Two-Tank Reef/ }));
    };

    await openFromGrid();
    // `getAllBy`, not `getBy`: the point is the count, and `getBy` would throw
    // its own error rather than report two.
    expect(screen.getAllByLabelText("New date")).toHaveLength(1);
    const panel = screen.getByLabelText("New date");
    // Outside the week grid — the subtree that is `display:none` below `xl`.
    expect(grid().contains(panel)).toBe(false);
    // And outside every row of the stream, the subtree hidden above it.
    for (const row of screen.getAllByRole("listitem")) {
      expect(row.contains(panel)).toBe(false);
    }

    // The stream's own control opens the same single panel.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const streamRow = screen
      .getAllByRole("listitem")
      .find((row) => within(row).queryByRole("button", { name: /^Move, copy, or remove/ }));
    if (!streamRow) throw new Error("the stream row’s actions control is missing");
    await user.click(
      within(streamRow).getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Move Two-Tank Reef/ }));
    expect(screen.getAllByLabelText("New date")).toHaveLength(1);
    expect(streamRow.contains(screen.getByLabelText("New date"))).toBe(false);
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
    expect(screen.getByLabelText("New departure time")).toHaveValue("8:00 AM");
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
          spans: [weekSpan({ tripId: "course-1", meta: "4 of 5 · $595 · Marcus Webb" })],
          days: week().days.map((day) => ({ ...day, entries: [] })),
        }),
      );

      expect(within(grid()).getByText("4 of 5 · $595 · Marcus Webb")).toBeInTheDocument();
      expect(within(grid()).queryByText(/^Crew:/)).toBeNull();
    });
  });
});

/**
 * **The move panel's impact preview** (issue #1203, D43).
 *
 * The whole feature is a read: the panel says what moving this departure will
 * cost — who has already been told the date, the crew rostered onto it, the kit
 * that travels, the money already taken — before the form is filled in. What is
 * asserted here is mostly the *absence* cases, because they are what keeps a
 * form calm: nothing while it loads, nothing for a departure with no
 * consequences, and nothing at all when the read fails.
 */
describe("ScheduleBuilder move impact preview (issue #1203)", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [baseTrip()],
    },
  ];

  function renderBoard() {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        week={weekFrom(days)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );
  }

  async function openMovePanel() {
    await userEvent.click(
      screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Move Two-Tank Reef/ }));
  }

  /**
   * The board carries a page of departures and every panel on it is closed, so
   * the counts are asked for on the path that opens one — never shipped with
   * the render. Same contract as the add panel's option lists.
   */
  it("asks for nothing until a move panel is opened", async () => {
    renderBoard();
    expect(loadMovePreflight).not.toHaveBeenCalled();

    await openMovePanel();
    // `null` for the date: the panel opens on the date the departure already
    // sits on, and moving a boat to where it is has no consequences to preview.
    expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null);
  });

  it("says what the move will cost, once it knows", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        { kind: "told", reminded: 4 },
        { kind: "gear", count: 1 },
        { kind: "money", paid: 5, cancellationWindowHours: 48 },
      ],
    }));
    renderBoard();
    await openMovePanel();

    expect(
      await screen.findByText(
        "4 divers have already been told this date. Moving it sends nothing.",
      ),
    ).toBeInTheDocument();
    // Singular and plural both resolved server-side, picked here by count.
    expect(screen.getByText("1 reserved unit travels with it.")).toBeInTheDocument();
    expect(screen.getByText("5 seats are already paid.")).toBeInTheDocument();
    expect(screen.getByText("Cancellations close 48 hours before it departs.")).toBeInTheDocument();
    expect(screen.getByText(COPY.impactTitle)).toBeInTheDocument();
  });

  /**
   * **The clash is not a footnote** (issue #1345). Every other line here is a
   * cost of going ahead — letters to write, kit to re-reserve. The clash is a
   * state `setTripCrew`/`changeTripCrew` refuse outright and the manifest
   * prints twice, so it is announced and carries the blocked line's weight
   * while the gear count stays under the heading.
   *
   * The blackout stays muted with the costs on purpose: it is the crew
   * member's own note, and the owner's answer named the clash.
   */
  it("says a crew clash as an alert, not a footnote", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        { kind: "crew", clashes: [{ name: "Marisol", departure: "Thu 07:00 Night Dive" }] },
        { kind: "crewAway", names: ["Ivo"] },
        { kind: "gear", count: 1 },
      ],
    }));
    renderBoard();
    await openMovePanel();

    const clash = await screen.findByText(
      "Marisol is already crewing Thu 07:00 Night Dive at that time and cannot be on both.",
    );
    expect(clash).toHaveClass("text-warning");
    expect(screen.getAllByRole("alert")).toContain(clash);

    const gear = screen.getByText("1 reserved unit travels with it.");
    const away = screen.getByText("Ivo has told you they are away then.");
    for (const line of [gear, away]) {
      expect(line.closest("ul")).not.toBeNull();
    }
    for (const alert of screen.getAllByRole("alert")) {
      expect(alert).not.toHaveTextContent("1 reserved unit travels with it.");
      expect(alert).not.toHaveTextContent("Ivo has told you they are away then.");
    }
    expect(screen.getByText(COPY.impactTitle)).toBeInTheDocument();
  });

  /**
   * A clash on its own used to print the "If you move it" heading over one
   * grey line. The alert says the whole thing; the heading it would have stood
   * under has nothing left to introduce.
   */
  it("renders the alert with no heading when the clash is the only consequence", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        { kind: "crew", clashes: [{ name: "Marisol", departure: "Thu 07:00 Night Dive" }] },
      ],
    }));
    renderBoard();
    await openMovePanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Marisol is already crewing Thu 07:00 Night Dive at that time and cannot be on both.",
    );
    expect(screen.queryByText(COPY.impactTitle)).toBeNull();
  });

  /**
   * **Louder, never a gate.** Issue #1345 asked whether `moveTrip` should
   * refuse a clash or quietly drop the clashing people; the answer was
   * neither — the owner assigns crew, and a panel that disabled its own button
   * would be the preview becoming the gate the blocked-line test above
   * deliberately is not either.
   */
  it("still lets the move go through with a clash on screen", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: null,
      sections: [
        {
          kind: "crew",
          clashes: [
            { name: "Marisol", departure: "Thu 07:00 Night Dive" },
            { name: "Ivo", departure: "Thu 08:00 Reef Drift" },
          ],
        },
      ],
    }));
    renderBoard();
    await openMovePanel();

    // One alert per person, not one paragraph naming both: a screen reader
    // announces two clashes the way it announces two facts.
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getByRole("button", { name: COPY.moveIt })).toBeEnabled();
  });

  /**
   * The restraint case. A departure nobody has been told about, with no crew,
   * no kit and no money composes to no sections — and the panel must then look
   * exactly as it did before this feature existed, heading included.
   */
  it("renders no block at all for a departure with no consequences", async () => {
    renderBoard();
    await openMovePanel();

    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalled());
    expect(screen.queryByText(COPY.impactTitle)).toBeNull();
    expect(screen.getByLabelText(COPY.newDate)).toBeInTheDocument();
  });

  /**
   * A preview is a courtesy, never a gate: if the read fails the panel is the
   * two fields and the button it has always been, with no error furniture.
   */
  it("leaves the form untouched when the read fails", async () => {
    loadMovePreflight.mockImplementation(async () => {
      throw new Error("nope");
    });
    renderBoard();
    await openMovePanel();

    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalled());
    expect(screen.queryByText(COPY.impactTitle)).toBeNull();
    expect(screen.getByLabelText(COPY.newDate)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COPY.moveIt })).toBeInTheDocument();
  });

  /**
   * Said up front, in the words the post-move notice would have used. The form
   * is deliberately still submittable — `moveTrip` is the one that decides, and
   * a panel that disabled its own button would be the preview becoming a gate.
   */
  it("warns before the form is filled in when the departure cannot move", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: "already_sailed",
      sections: [{ kind: "told", reminded: 6 }],
    }));
    renderBoard();
    await openMovePanel();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(COPY.impactBlockedSailed);
    expect(screen.getByRole("button", { name: COPY.moveIt })).toBeEnabled();
    // The facts survive the refusal — they are why it is worth reading.
    expect(
      screen.getByText("6 divers have already been told this date. Moving it sends nothing."),
    ).toBeInTheDocument();
  });

  it("names the cancelled refusal instead, when that is the one that applies", async () => {
    loadMovePreflight.mockImplementation(async () => ({
      blocked: "not_scheduled",
      sections: [],
    }));
    renderBoard();
    await openMovePanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(COPY.impactBlockedNotScheduled);
  });

  /**
   * Two departures, two previews. The panel is keyed by the row it opened from,
   * so a second Move must ask about *its* departure rather than reuse the first
   * answer — the bug a single module-level cache would introduce.
   */
  it("asks again for a different departure", async () => {
    const twoDays: FixtureDay[] = [
      {
        ...days[0],
        trips: [baseTrip(), baseTrip({ id: "trip-2", title: "Night Dive" })],
      },
    ];
    render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        week={weekFrom(twoDays)}
        loadOptions={loadOptions}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
      />,
    );

    await openMovePanel();
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null));

    await userEvent.click(
      screen.getByRole("button", { name: /^Move, copy, or remove Night Dive/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^Move Night Dive/ }));
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-2", null));
  });

  /**
   * **The two crew lines, and the re-read that makes them possible** (issue
   * #1310).
   *
   * Every other line in this preview is a property of the departure and is the
   * same wherever it lands, so the panel could — and did — fetch once on
   * mount. These have to be asked again for each date *and time* a staff
   * member picks, because the rule is an overlap of hours rather than a shared
   * day: a morning boat and an afternoon boat are an ordinary double shift.
   */
  it("asks again, with the date and the time, when either changes", async () => {
    loadMovePreflight.mockImplementation(
      async (_tripId: string, target: { date: string; startTime: string } | null) => ({
        blocked: null,
        sections:
          target?.date === "2026-08-06"
            ? [
                {
                  kind: "crew" as const,
                  clashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
                },
              ]
            : [],
      }),
    );
    renderBoard();
    await openMovePanel();
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null));

    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });

    // The other boat is named, because otherwise the reader has to leave the
    // panel to find out whether "another departure" is the 07:00 or the 15:00
    // — which is the question they opened it to settle.
    expect(
      await screen.findByText(
        "Marcus Webb is already crewing Night Dive at that time and cannot be on both.",
      ),
    ).toBeInTheDocument();
    expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", {
      date: "2026-08-06",
      startTime: "08:30",
    });

    // The time is part of the question too, so changing it asks again.
    fireEvent.change(screen.getByLabelText(COPY.newDepartureTime), {
      target: { value: "14:00" },
    });
    await waitFor(() =>
      expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", {
        date: "2026-08-06",
        startTime: "14:00",
      }),
    );
  });

  /**
   * The blackout is a separate sentence because it is a separate fact — the
   * crew member's own statement, which the app has held since #1235 and which
   * *informs rather than gates*, so nobody is taken off a boat by it and no
   * clash is ever found for it. Without this line the panel is silent on the
   * case the shop wrote down.
   */
  it("says who has told the shop they are away, in its own words", async () => {
    loadMovePreflight.mockImplementation(async (_tripId: string, target) => ({
      blocked: null,
      sections: target ? [{ kind: "crewAway" as const, names: ["Talia Okonkwo"] }] : [],
    }));
    renderBoard();
    await openMovePanel();
    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });

    expect(
      await screen.findByText("Talia Okonkwo has told you they are away then."),
    ).toBeInTheDocument();
  });

  it("names each of them on its own line, never a count of them", async () => {
    // The deliberate call the ticket turns on: a count read `crew: 2` on 24 of
    // the demo board's 25 departures, and the row this panel opens under
    // already prints the crew's names.
    loadMovePreflight.mockImplementation(async (_tripId: string, target) => ({
      blocked: null,
      sections: target
        ? [
            {
              kind: "crew" as const,
              clashes: [
                { name: "Marcus Webb", departure: "Night Dive" },
                { name: "Talia Okonkwo", departure: "Two-Tank Reef" },
              ],
            },
          ]
        : [],
    }));
    renderBoard();
    await openMovePanel();
    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });

    expect(
      await screen.findByText(
        "Marcus Webb is already crewing Night Dive at that time and cannot be on both.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Talia Okonkwo is already crewing Two-Tank Reef at that time and cannot be on both.",
      ),
    ).toBeInTheDocument();
  });

  it("asks nothing new when the fields return to where the departure already is", async () => {
    renderBoard();
    await openMovePanel();
    await waitFor(() => expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", null));

    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-06" } });
    await waitFor(() =>
      expect(loadMovePreflight).toHaveBeenCalledWith("trip-1", {
        date: "2026-08-06",
        startTime: "08:30",
      }),
    );

    fireEvent.change(screen.getByLabelText(COPY.newDate), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(loadMovePreflight.mock.calls.at(-1)).toEqual(["trip-1", null]));
    // Three reads for three distinct answers, not one per keystroke: a date or
    // time input publishes a value only once all its segments are filled.
    expect(loadMovePreflight).toHaveBeenCalledTimes(3);
  });
});

/**
 * **A season offers a kind of day; it never applies one behind your back**
 * (issue #1492).
 *
 * The server fills `trips.lens_id` from a live season when the board sends
 * nothing, so if the panel said nothing a shop would save a departure and find
 * a word on it that it never typed. The panel shows the offer, names where it
 * came from, and gets out of the way the moment a staffer touches the field.
 */
describe("the kind of day a season offers", () => {
  const days = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];
  const withSeasons = vi.fn(async () => ({
    courses: [],
    diveSites: [{ id: "site-1", title: "Molasses Reef" }],
    lenses: [
      { id: "after-dark", title: "After dark" },
      { id: "easygoing", title: "Easygoing reef" },
    ],
    seasons: [
      {
        startsOn: "2026-08-01",
        endsOn: "2026-08-31",
        lensId: "after-dark",
        name: "Turtle nesting",
      },
    ],
  }));

  function renderBoard(extra: Partial<ComponentProps<typeof ScheduleBuilder>> = {}) {
    return render(
      <ScheduleBuilder
        shopSlug="blue-mantis"
        week={weekFrom(days)}
        loadOptions={withSeasons}
        loadMovePreflight={loadMovePreflight}
        price={PRICE}
        actions={actions}
        defaultDateIso="2026-08-01"
        canConfigure={true}
        locale="en-US"
        copy={COPY}
        more={MORE}
        initialCourse={null}
        openAdd="closed"
        {...extra}
      />,
    );
  }

  const openPanel = async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    return await screen.findByLabelText(/Kind of day/);
  };

  it("preselects the season's word and says where it came from", async () => {
    const select = await openPanel();
    expect(select).toHaveValue("after-dark");
    expect(screen.getByText("From Turtle nesting")).toBeInTheDocument();
  });

  it("clears when the date moves out of the window", async () => {
    const select = await openPanel();
    expect(select).toHaveValue("after-dark");

    await userEvent.clear(screen.getByLabelText("Date"));
    await userEvent.type(screen.getByLabelText("Date"), "2026-09-05");

    await waitFor(() => expect(select).toHaveValue(""));
    expect(screen.queryByText("From Turtle nesting")).toBeNull();
  });

  it("keeps None when a staffer chose None, even as the date moves", async () => {
    // The offer must not become an override. Choosing "None" is a choice, and
    // a date change putting the season's word back would be the panel arguing
    // with the person filling it in.
    const select = await openPanel();
    await userEvent.selectOptions(select, "");
    expect(select).toHaveValue("");
    expect(screen.queryByText("From Turtle nesting")).toBeNull();

    await userEvent.clear(screen.getByLabelText("Date"));
    await userEvent.type(screen.getByLabelText("Date"), "2026-08-15");

    await waitFor(() => expect(screen.getByLabelText("Date")).toHaveValue("2026-08-15"));
    expect(select).toHaveValue("");
  });

  it("fills the season's name into the template the server handed across", async () => {
    // The hint crosses the boundary as `st.raw("lenses.tripFieldFromSeason")` —
    // the unformatted "From {season}" — because *which* season covers the
    // panel's date is only known here, as the staffer moves it. Formatting it
    // on the server instead asks next-intl for an argument that by definition
    // is not there yet; `src/i18n/raw-messages.test.ts` refuses that half, and
    // this pins the other one: the template arrives with its placeholder and
    // `fill()` resolves it.
    renderBoard({ copy: { ...COPY, lensFromSeason: "From {season}" } });
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await screen.findByLabelText(/Kind of day/);
    expect(screen.getByText("From Turtle nesting")).toBeInTheDocument();
  });

  it("names no season for a word the staffer picked themselves", async () => {
    const select = await openPanel();
    await userEvent.selectOptions(select, "easygoing");
    expect(select).toHaveValue("easygoing");
    expect(screen.queryByText("From Turtle nesting")).toBeNull();
  });
});
