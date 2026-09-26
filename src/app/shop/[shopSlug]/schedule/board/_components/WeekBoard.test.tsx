// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GroupLabel } from "@/components/ui/ledger";
import { type BuilderWeek, WeekBoard, type WeekBoardCopy, type WeekEntry } from "./WeekBoard";

afterEach(cleanup);

/**
 * The week board's own geometry (docs/design/pixel-craft.md). What it decides
 * — which rows, which flags, which doors — is ScheduleBuilder.test.tsx's; this
 * file pins how those rows are laid out, where the pixel probe found them
 * drawn a second way or off the line they belong on.
 */

const COPY: WeekBoardCopy = {
  add: "Add",
  addDepartureOnDay: "Add a departure on {day}",
  rowActionsAria: "Move, copy, or remove {ref}",
  noPriceSet: "No price set",
  noPriceSetAria: "Set a price for {ref}",
  noPriceSetAll: "None of these departures has a price yet.",
  rollCallOpen: "Roll call · {count} not counted",
  rollCallOpenAria: "Finish the dive {dive} roll call for {ref}",
  noBoats: "No boats",
  asked: "Asked for",
  addDeparture: "Add a departure",
  crewLabel: "Crew:",
  crewNobodyYet: "nobody yet",
};

function entry(overrides: Partial<WeekEntry> = {}): WeekEntry {
  return {
    tripId: "t1",
    dateIso: "2026-08-27",
    startTime: "07:00",
    title: "Two-Tank Reef",
    dayCount: 1,
    status: "upcoming",
    unpriced: false,
    rollCallOpen: null,
    ref: "Two-Tank Reef, Thu, Aug 27 7:00 AM",
    time: "7:00 AM",
    seats: { booked: 8, capacity: 12 },
    mark: "reef",
    meta: "Molasses Reef · 8 of 12 · $95",
    crew: [],
    ...overrides,
  };
}

const DAY_ISOS = [
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
  "2026-08-30",
];

/** Aug 24 – 30, 2026, with Thursday the 27th as today. */
function week(overrides: Partial<BuilderWeek> = {}, entries: WeekEntry[] = []): BuilderWeek {
  return {
    ariaLabel: "The week",
    rangeLabel: "Aug 24 – 30, 2026",
    previousHref: "/shop/blue-mantis/schedule/board?week=2026-08-17",
    nextHref: "/shop/blue-mantis/schedule/board?week=2026-08-31",
    thisWeekHref: null,
    allUnpriced: false,
    nextDeparture: null,
    seatTally: "8 of 12 seats",
    asked: [],
    askedCount: "0 days",
    words: { previous: "Previous week", next: "Next week", thisWeek: "This week", today: "Today" },
    days: DAY_ISOS.map((dateIso, index) => ({
      dateIso,
      weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] ?? "",
      dayNumber: String(24 + index),
      label: `Day ${24 + index}`,
      isToday: dateIso === "2026-08-27",
      isPast: dateIso < "2026-08-27",
      boatWarning: null,
      entries: entries.filter((item) => item.dateIso === dateIso),
    })),
    spans: [],
    ...overrides,
  };
}

function board(weekProps: BuilderWeek, canConfigure = true) {
  return render(
    <WeekBoard
      week={weekProps}
      canConfigure={canConfigure}
      shopSlug="blue-mantis"
      openKey={null}
      onToggle={() => {}}
      registerToggle={() => () => {}}
      copy={COPY}
    />,
  );
}

/** The classes a `GroupLabel` gives its meta, read off the component itself. */
function groupMetaClasses(): string[] {
  const { container } = render(<GroupLabel meta="1 day">Label</GroupLabel>);
  const classes = [...(container.querySelector("span")?.classList ?? [])];
  cleanup();
  return classes;
}

const ASKED = {
  asked: [
    {
      dateIso: "2026-08-28",
      lead: "Fri, Aug 28 · 4 people",
      who: "Marta Ruiz and Leo Fisher",
      href: "/shop/blue-mantis/schedule/board?add=full&date=2026-08-28",
    },
  ],
  askedCount: "1 day",
};

describe("the week's label rows (K-254)", () => {
  it("set the seat tally as a group's meta, in the one spelling GroupLabel owns", () => {
    const meta = groupMetaClasses();
    expect(meta.length).toBeGreaterThan(0);
    board(week());
    expect([...screen.getByText("8 of 12 seats").classList]).toEqual(meta);
  });

  it("set the asked count the same way, under the label its section is named by", () => {
    const meta = groupMetaClasses();
    board(week(ASKED));
    expect([...screen.getByText("1 day").classList]).toEqual(meta);
    expect(screen.getByRole("region", { name: "Asked for" })).toBeTruthy();
  });
});

/** A Tailwind spacing step in px: `w-8` is 32. */
const px = (step: string) => Number(step) * 4;

/** The capture from the one class on `element` that matches `pattern`. */
function token(element: Element, pattern: RegExp): string {
  const found = [...element.classList].map((name) => name.match(pattern)).find(Boolean);
  expect(found, `${pattern} on "${element.className}"`).toBeTruthy();
  return found?.[1] ?? "";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

describe("the day rail (K-326, K-327, K-328)", () => {
  it("is one width at every width, and holds its longest label: a fixed weekday, the gap and today's disc", () => {
    // "WED 22" ran 12–14px past a 3rem phone rail, and today's "TUE" beside
    // its 32px disc further still (schedule-builder@390).
    board(week());
    const today = screen.getByText("27");
    const label = today.parentElement as HTMLElement;
    const grid = label.closest("h3")?.parentElement as HTMLElement;
    const rail = Number(token(grid, /^grid-cols-\[([\d.]+)rem_/)) * 16;
    expect([...grid.classList].filter((name) => name.includes(":grid-cols-"))).toEqual([]);
    const weekday = px(token(screen.getByText("Thu"), /^max-sm:w-(\d+)$/));
    const gap = px(token(label, /^gap-([\d.]+)$/));
    const disc = px(token(today, /^size-(\d+)$/));
    expect(weekday + gap + disc).toBeLessThanOrEqual(rail);
  });

  it("starts every numeral at one x: below sm each weekday is one fixed width", () => {
    // The numerals sat at x = 45.9 to 56.3 at 390, each after its own word.
    board(week());
    const widths = WEEKDAYS.map((day) => token(screen.getByText(day), /^max-sm:w-(\d+)$/));
    expect(new Set(widths).size).toBe(1);
    for (const day of WEEKDAYS) expect(screen.getByText(day)).toHaveClass("shrink-0");
  });

  it("keeps today's disc round: it gives up no width to the row it sits in", () => {
    // 23×32 at 390, against 32×32 at 1280.
    board(week());
    expect(screen.getByText("27")).toHaveClass("size-8", "shrink-0");
  });

  it("sets the weekday, a departure's first line and 'No boats' in one 36px first-line box", () => {
    // The weekday's cap sat 9px above the first departure's time at 1280, and
    // 4px above "No boats" on an empty day.
    board(week({}, [entry()]));
    const firstLine = ["flex", "min-h-9", "items-center"];
    // Below sm the weekday and its numeral share that line; from sm up the
    // weekday takes it alone, over its numeral.
    expect(screen.getByText("Thu").parentElement).toHaveClass(...firstLine);
    expect(screen.getByText("Thu")).toHaveClass("sm:flex", "sm:min-h-9", "sm:items-center");
    expect(screen.getByText("7:00 AM").parentElement).toHaveClass(...firstLine);
    const empty = screen.getAllByText("No boats");
    expect(empty).toHaveLength(6);
    for (const none of empty) expect(none).toHaveClass(...firstLine);
    // Each under the same 8px: the rail's, the row's and the empty day's own.
    const inset = (element: Element | null | undefined) =>
      [...(element?.classList ?? [])].filter((name) => /^p[ty]-/.test(name));
    expect(inset(screen.getByText("Thu").closest("h3"))).toEqual(["py-2"]);
    expect(inset(screen.getByText("7:00 AM").closest("li")?.firstElementChild)).toEqual(["py-2"]);
    for (const none of empty) expect(inset(none)).toEqual(["py-2"]);
  });
});
