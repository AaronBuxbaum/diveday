// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BuilderCopy,
  type BuilderDay,
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

  function renderBoard(days: BuilderDay[]) {
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
