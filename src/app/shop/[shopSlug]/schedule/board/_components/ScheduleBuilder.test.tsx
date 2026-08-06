// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BuilderCopy,
  type BuilderDay,
  type BuilderMoreOptions,
  type BuilderPriceInput,
  ScheduleBuilder,
} from "./ScheduleBuilder";

// The board route has no dynamic id, so `usePathname()` is what
// ScheduleBuilder keys its disarm-on-revisit effect on (see the component's
// own doc comment). `setMockPathname` simulates a navigation event —
// including an Activity-preserved show/hide cycle, should
// `cacheComponents: true` be re-enabled — without a real Next.js router.
const { usePathname, setMockPathname } = vi.hoisted(() => {
  let current = "/shop/blue-mantis/schedule/board";
  return {
    usePathname: vi.fn(() => current),
    setMockPathname: (next: string) => {
      current = next;
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname }));

const COPY: BuilderCopy = {
  heading: "The board",
  description: "Add a departure, slide one to another day, copy it forward, or take it off.",
  ariaLabel: "Schedule builder",
  addDeparture: "Add a departure",
  addDepartureOnDay: "Add a departure on {day}",
  add: "Add",
  cancel: "Cancel",
  noSiteSetYet: "No site set yet",
  courseLabel: "Course · {title}",
  dayCountLabel: "{count} days",
  crewLabel: "Crew:",
  crewNobodyYet: "nobody yet",
  noPriceSet: "No price set",
  noPriceSetAria: "Set a price for {ref}",
  rollCallOpen: "Roll call · {count} not counted",
  rollCallOpenAria: "Finish the dive {dive} roll call for {ref}",
  rollCallOpenNote: "Back at the dock with the dive {dive} roll call still open.",
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
  diveSite: "Dive site",
  ordinaryTrip: "Ordinary trip",
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
  repeatLegend: "Repeat",
  repeatDescription: "Put the same trip on the board for several weeks at once.",
  howOftenLabel: "How often",
  doesntRepeat: "Doesn't repeat",
  everyWeek: "Every week",
  every2Weeks: "Every 2 weeks",
  every4Weeks: "Every 4 weeks",
  numberOfTripsLabel: "Number of trips",
  numberOfTripsDescription: "Counting the first, up to 12.",
  numberOfTripsPlaceholder: "e.g. 8",
};

/** The bounds and shared dive-card words the expanded half of the panel needs. */
const MORE: BuilderMoreOptions = {
  minOccurrences: 2,
  maxOccurrences: 12,
  minDays: 1,
  maxDays: 7,
  diveFields: {
    heading: "The dive plan",
    description: "A {tripShape}.",
    twoTankTrip: "two-tank trip",
    diveCountTrip: "{count}-dive trip",
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
    diverFacingDetailsLabel: "Diver-facing details",
    detailsPlaceholder: "Depth, conditions, what to expect.",
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
  courses: [{ id: "course-1", title: "Open Water Diver" }],
  diveSites: [{ id: "site-1", title: "Molasses Reef" }],
}));

afterEach(() => {
  cleanup();
  loadOptions.mockClear();
  setMockPathname("/shop/blue-mantis/schedule/board");
});

describe("ScheduleBuilder unpriced-trip flag (task 150)", () => {
  it("flags a trip with no price set and links to its Details form", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
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
});

describe("ScheduleBuilder add panel: price, and options fetched on open", () => {
  const days: BuilderDay[] = [{ dateIso: "2026-08-01", label: "Sat, Aug 1", trips: [] }];

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
    await userEvent.click(screen.getByRole("button", { name: "Add a departure" }));

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

    await userEvent.click(screen.getByRole("button", { name: "Add a departure" }));
    expect(loadOptions).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("option", { name: "Open Water Diver" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Molasses Reef" })).toBeInTheDocument();

    // Reopening reuses what it already has — the catalogue does not change
    // while somebody schedules a week.
    await userEvent.click(screen.getByRole("button", { name: "Add a departure" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a departure" }));
    expect(loadOptions).toHaveBeenCalledTimes(1);
  });
});

describe("ScheduleBuilder full-boat badge tone (appendix item)", () => {
  it("renders the success tone once the boat is full, matching the trip page", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        trips: [baseTrip({ id: "trip-full", capacity: 6, booked: 6 })],
      },
    ];
    const { container } = render(
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

    const capacityBadge = container.querySelector("span.tabular-nums");
    expect(capacityBadge?.className).toContain("bg-success/10");
    expect(capacityBadge?.className).not.toContain("bg-surface-sunken");
  });

  it("renders the primary tone (not the old grey neutral) while seats remain", () => {
    const days: BuilderDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        trips: [baseTrip({ id: "trip-open", capacity: 6, booked: 3 })],
      },
    ];
    const { container } = render(
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

    const capacityBadge = container.querySelector("span.tabular-nums");
    expect(capacityBadge?.className).toContain("bg-primary/10");
  });
});

describe("ScheduleBuilder open-panel reset on revisit", () => {
  it("closes an expanded add/move/copy panel on a pathname change, instead of resurfacing it with stale defaults", async () => {
    const days: BuilderDay[] = [
      { dateIso: "2026-08-01", label: "Sat, Aug 1", trips: [baseTrip()] },
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

    await userEvent.click(screen.getByRole("button", { name: "Add a departure" }));
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

describe("ScheduleBuilder panel focus management (accessibility audit §3)", () => {
  it("moves focus into the add panel's first field on open, and back to the toggle on cancel", async () => {
    const days: BuilderDay[] = [{ dateIso: "2026-08-01", label: "Sat, Aug 1", trips: [] }];
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

    const toggle = screen.getByRole("button", { name: "Add a departure" });
    await userEvent.click(toggle);
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText(COPY.titlePlaceholder)).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("moves focus into the move panel's date field on open, and back to the Move toggle on cancel", async () => {
    const days: BuilderDay[] = [
      { dateIso: "2026-08-01", label: "Sat, Aug 1", trips: [baseTrip()] },
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

    const moveToggle = screen.getByRole("button", { name: /^Move Two-Tank Reef/ });
    await userEvent.click(moveToggle);
    expect(screen.getByLabelText(COPY.newDate)).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(COPY.newDate)).not.toBeInTheDocument();
    expect(moveToggle).toHaveFocus();
  });
});

describe("ScheduleBuilder unfinished after-dive roll call (DOM-H3)", () => {
  const returnedDay = (
    rollCallOpen: { diveNumber: number; uncounted: number } | null,
  ): BuilderDay[] => [
    {
      dateIso: "2026-07-31",
      label: "Fri, Jul 31",
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

    // Badge's own aria-hidden glyph for the three status tones — a colorblind
    // scan gets the mark before it gets to the words (design/principles.md #6).
    const badge = container.querySelector("a span.bg-danger\\/10");
    expect(badge?.textContent).toContain("✕");
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
    const trigger = within(row).getByRole("button", { name: /^Remove / });
    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = within(row).getByRole("alert");
    expect(panel).toHaveTextContent("Take “Two-Tank Reef” off the board for good?");
    // Arming submits nothing at all.
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(within(row).getByRole("button", { name: "Never mind" }));
    expect(within(row).queryByRole("alert")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("hides move/copy/remove on a returned row, which those mutations all refuse", () => {
    renderBoard(returnedDay({ diveNumber: 1, uncounted: 2 }));

    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("says nothing on an ordinary upcoming departure", () => {
    renderBoard(returnedDay(null));

    expect(screen.queryByText(/not counted/)).toBeNull();
    expect(screen.queryByText(/roll call still open/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Move Two-Tank Reef/ })).toBeInTheDocument();
  });
});

describe("ScheduleBuilder add panel: one form, two depths (ADR 20260806-one-trip-create-form)", () => {
  const days: BuilderDay[] = [{ dateIso: "2026-08-01", label: "Sat, Aug 1", trips: [] }];

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

  it("keeps the rare half collapsed, and reveals the whole trip form on request", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure" }));

    // Collapsed: the questions the board is for, and nothing else.
    expect(screen.getByLabelText("What is it")).toBeInTheDocument();
    expect(screen.getByLabelText("Seats")).toBeInTheDocument();
    expect(screen.getByLabelText("Dives")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Description/)).toBeNull();
    expect(screen.queryByLabelText("How many days")).toBeNull();
    expect(screen.queryByLabelText(/Deposit per diver/)).toBeNull();
    expect(screen.queryByLabelText("How often")).toBeNull();

    const more = screen.getByRole("button", { name: "More options" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);

    // Expanded: everything /trips/new used to ask, on the same form.
    expect(screen.getByLabelText(/^Description/)).toBeInTheDocument();
    expect(screen.getByLabelText("How many days")).toBeInTheDocument();
    expect(screen.getByLabelText(/Deposit per diver/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Free cancellation window/)).toBeInTheDocument();
    expect(screen.getByLabelText("How often")).toBeInTheDocument();
    expect(screen.getByLabelText("Number of dives")).toBeInTheDocument();
    // Still one submit — expanding deepens the form, it never forks it.
    expect(screen.getAllByRole("button", { name: "Put it on the board" })).toHaveLength(1);
  });

  it("never posts two dive counts: the quick box gives way to the dive plan's own", async () => {
    // `plannedDives` decides how many dive cards render, so two controls
    // sharing the name would make the last one in the DOM win silently.
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure" }));
    expect(container.querySelectorAll('[name="plannedDives"]')).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(container.querySelectorAll('[name="plannedDives"]')).toHaveLength(1);
    // Same for the site: one for the day, or one per dive — never both.
    expect(container.querySelectorAll('[name="diveSiteId"]')).toHaveLength(0);
    expect(container.querySelectorAll('[name="dive-1-siteId"]')).toHaveLength(1);
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

  it("opens at full depth for a link that meant the whole form", async () => {
    renderBuilder({ openAdd: "expanded" });
    expect(await screen.findByLabelText("How often")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fewer options" })).toBeInTheDocument();
  });

  it("tells a captain whose job scheduling is, rather than showing an empty board", () => {
    renderBuilder({ canConfigure: false });

    expect(screen.queryByRole("button", { name: "Add a departure" })).toBeNull();
    expect(screen.getByText(/limited to owners, managers, and instructors/)).toBeInTheDocument();
  });
});
