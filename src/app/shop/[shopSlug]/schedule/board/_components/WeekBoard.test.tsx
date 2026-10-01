// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/ledger";
import {
  type BuilderWeek,
  WeekBoard,
  type WeekBoardCopy,
  type WeekEntry,
  type WeekSpan,
} from "./WeekBoard";
import { WEEK_EMPTY_DAY_CLASS } from "./week-geometry";

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

/** The widths the rail's label has two shapes at: its phone line, and `sm` up. */
type Width = "phone" | "sm";

/**
 * A spacing utility's px on `element` at a width, from the first of
 * `utilities` it carries — a longhand before its pair (`pt` over `py`), an
 * `sm:` class over the bare one from `sm` up, a negative step signed and
 * `px` one pixel. 0 when it carries none.
 */
function spacing(element: Element, utilities: string[], at: Width): number {
  const variants = at === "sm" ? ["sm", ""] : [""];
  for (const variant of variants) {
    for (const utility of utilities) {
      for (const name of element.classList) {
        const match = name.match(/^(?:(sm):)?(-?)([a-z]+(?:-[a-z])?)-(px|[\d.]+)$/);
        if (!match || (match[1] ?? "") !== variant || match[3] !== utility) continue;
        const size = match[4] === "px" ? 1 : px(match[4] ?? "0");
        return match[2] ? -size : size;
      }
    }
  }
  return 0;
}

/**
 * Where a first-line box's line centres, in px under the top of its day's
 * rail grid, at a width. **The line is the box's `min-h` less its own
 * vertical padding**: Tailwind's preflight makes every box border-box, so
 * padding on the element that carries the floor comes out of the line rather
 * than sitting around it. The line then sits under every top margin and
 * padding from the box up to the grid.
 */
function firstLineCentre(box: Element, at: Width): number {
  const line =
    spacing(box, ["min-h"], at) - spacing(box, ["pt", "py"], at) - spacing(box, ["pb", "py"], at);
  expect(line, `the first line of "${box.className}" at ${at}`).toBe(32);
  let above = 0;
  for (
    let element: Element | null = box;
    element && !element.classList.contains("grid");
    element = element.parentElement
  ) {
    above += spacing(element, ["mt", "my"], at) + spacing(element, ["pt", "py"], at);
  }
  return above + line / 2;
}

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

  it("centres the weekday, a departure's first line and 'No boats' on one 32px line, 8px down the day", () => {
    // The weekday's cap sat 9px above the first departure's time at 1280, and
    // 4px above "No boats" on an empty day. Then "No boats" read 6px high:
    // `min-h-8` and `py-2` on one border-box <p> left a 16px floor under its
    // 20px line, so the floor did nothing and the words centred at 8 + 10.
    board(week({}, [entry()]));
    const weekday = screen.getByText("Thu");
    const time = screen.getByText("7:00 AM").parentElement as HTMLElement;
    const empty = screen.getAllByText("No boats");
    expect(empty).toHaveLength(6);
    // Below sm the weekday and its numeral share the line; from sm up the
    // weekday takes it alone, over its numeral.
    const labels: [Width, Element][] = [
      ["phone", weekday.parentElement as HTMLElement],
      ["sm", weekday],
    ];
    for (const [at, label] of labels) {
      const rail = firstLineCentre(label, at);
      expect(rail).toBe(8 + 32 / 2);
      expect(firstLineCentre(time, at)).toBe(rail);
      for (const none of empty) expect(firstLineCentre(none, at)).toBe(rail);
    }
    // The skeleton draws an empty day from the same string (loading.test.tsx).
    for (const none of empty) expect(none).toHaveClass(...WEEK_EMPTY_DAY_CLASS.split(" "));
  });

  /** The Logbook restart decorates only what carries data (ADR 20261001-logbook). */
  it("opens a departure's row on its time, with no drawing of the site", () => {
    const { container } = board(week({}, [entry()]));
    expect(container.querySelector("[data-site-mark]")).toBeNull();
  });
});

describe("an asked-for day's row (K-333, K-338)", () => {
  const askRow = () => screen.getByText("Fri, Aug 28 · 4 people").closest("li") as HTMLElement;

  it("starts its words on the section's edge, and ends its act on it", () => {
    // "Sun, Aug 2" started 8px inside "ASKED FOR" (the room a hover fill
    // needs, on a row that paints none), and "Add a departure" ended 20px
    // inside the "1 day" above it.
    board(week(ASKED));
    expect([...askRow().classList].filter((name) => /^-?[pm][xse]-/.test(name))).toEqual([]);
    const act = within(askRow()).getByRole("link", { name: "Add a departure" });
    expect(act.className).toBe(
      buttonClass({ variant: "ghost", size: "sm", flush: true, className: "shrink-0" }),
    );
  });

  it("centres its act on the words beside it, however many lines they wrap to", () => {
    // On a phone the names wrap to two lines and the 44px act sat at the
    // row's top: 12px under the first line's centre, 9.5px over the block's.
    board(week(ASKED));
    expect(askRow()).toHaveClass("flex", "items-center");
    expect(askRow()).not.toHaveClass("items-start");
  });
});

describe("a departure row is one door (K-325, K-530)", () => {
  const course: WeekSpan = {
    tripId: "course-1",
    dateIso: "2026-08-28",
    startTime: "08:00",
    title: "Open Water Diver — three-day course",
    dayCount: 3,
    status: "upcoming",
    unpriced: false,
    rollCallOpen: null,
    ref: "Open Water Diver — three-day course, Aug 28 – 30, 2026",
    meta: "4 of 5 · $595 · Marcus Webb",
    seats: { booked: 4, capacity: 5 },
    runsLabel: "3 days",
    startColumn: 5,
    columnSpan: 3,
  };

  it("makes the whole row its title's target: one stretched link, last in the row", () => {
    // The title was a 19–38px link and the row painted a hover fill it did
    // not answer to (schedule-builder@390, 11 of them). The ledger's door:
    // an overlay named by the title, over a row that presses like one.
    board(week({}, [entry()]));
    const door = screen.getByRole("link", { name: "Two-Tank Reef" });
    const row = screen.getByText("7:00 AM").closest("li")?.firstElementChild as HTMLElement;
    expect(door.parentElement).toBe(row);
    expect(row.lastElementChild).toBe(door);
    expect(row).toHaveClass("relative", "pressable-row");
    expect(door).toHaveClass("absolute", "inset-0", "z-0", "focus-visible:focus-ring-inset");
    expect(door).toHaveAttribute("href", "/shop/blue-mantis/trips/t1");
    expect(door).toHaveAttribute("data-departure-door", "");
    expect(door.textContent).toBe("");
    expect(screen.getByText("Two-Tank Reef").closest("a")).toBeNull();
  });

  it("lifts the row's own controls over that door, the flags as 44px targets that end at their words", () => {
    // The price flag was a 16px block link running the whole column, 228px
    // wide at 390 for 90px of words.
    board(
      week({}, [
        entry({ unpriced: true }),
        entry({
          tripId: "t2",
          time: "9:00 AM",
          title: "Night Dive",
          ref: "Night Dive, Thu, Aug 27 9:00 AM",
          rollCallOpen: { diveNumber: 1, uncounted: 2 },
        }),
      ]),
    );
    for (const menu of screen.getAllByRole("button", { name: /^Move, copy, or remove / })) {
      expect(menu).toHaveClass("relative", "z-10");
    }
    const flags = [
      screen.getByRole("link", { name: /^Set a price for / }),
      screen.getByRole("link", { name: /^Finish the dive 1 roll call for / }),
    ];
    for (const flag of flags) {
      expect(flag).toHaveClass("relative", "z-10", ...tapTargetLinkClass.split(" "));
      expect(flag).not.toHaveClass("flex");
    }
  });

  it("hooks each door, and only the door, for a spec that may read neither its copy nor its place", () => {
    // The door carries no text and follows the row's flags, so a spec that
    // took the week's first trip link and read its text got "" — or, when
    // that departure had a flag, the flag's `#details` or
    // `/manifest?checkpoint=` href, with `/print` appended to it.
    const { container } = board(
      week({}, [
        entry({ unpriced: true }),
        entry({
          tripId: "t2",
          time: "9:00 AM",
          title: "Night Dive",
          ref: "Night Dive, Thu, Aug 27 9:00 AM",
          rollCallOpen: { diveNumber: 1, uncounted: 2 },
        }),
      ]),
    );
    const doors = [...container.querySelectorAll("[data-week-board] a[data-departure-door]")];
    expect(
      doors.map((door) => [door.getAttribute("aria-label"), door.getAttribute("href")]),
    ).toEqual([
      ["Two-Tank Reef", "/shop/blue-mantis/trips/t1"],
      ["Night Dive", "/shop/blue-mantis/trips/t2"],
    ]);
  });

  it("sets a course's length in its title's own run, so it follows the last word", () => {
    // As a flex sibling of a wrapped title, "3 days" sat at the far end of
    // the row, 41px from the title's ink at 390.
    board(week({ spans: [course] }));
    const tag = screen.getByText("3 days");
    const title = tag.parentElement as HTMLElement;
    expect(title.tagName).toBe("P");
    expect(title.firstChild?.textContent).toBe("Open Water Diver — three-day course");
    expect(tag).toHaveClass("whitespace-nowrap");
    expect(
      screen.getByRole("link", { name: "Open Water Diver — three-day course" }),
    ).toHaveAttribute("href", "/shop/blue-mantis/trips/course-1");
  });

  it("never clamps a course's length away: its title runs whole, where a boat's stops at two lines", () => {
    // Nothing else on a course's row says how long it runs (its meta is
    // seats, price and instructor), and a two-line clamp on a title that
    // filled both phone lines ellipsed "3 days" away with its last words.
    board(week({ spans: [course] }, [entry()]));
    const clamps = (element: Element) =>
      [...element.classList].filter((name) => name.includes("line-clamp"));
    expect(clamps(screen.getByText("3 days").parentElement as HTMLElement)).toEqual([]);
    expect(clamps(screen.getByText("Two-Tank Reef"))).toEqual(["line-clamp-2"]);
  });
});

describe("a departure's lead line (K-329, K-335, K-529)", () => {
  const META = "Molasses Reef · 8 of 12 · $95";

  it("gives the time a fixed slot sized for '12:00 PM', so every seat bar starts at one x", () => {
    // The bars began at x 320/321 after "5:30 AM" and 330/331 after
    // "11:00 AM" at 1280, and from 640 to ~700px the time wrapped its
    // meridiem. "12:00 PM" is ~74px at 16px semibold, tabular.
    board(week({}, [entry({ time: "12:00 PM" })]));
    const time = screen.getByText("12:00 PM");
    expect(time).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(px(token(time, /^w-(\d+)$/))).toBeGreaterThanOrEqual(74);
  });

  it("keeps the meta on a line of its own until md, where it has room to sit inline", () => {
    // At 640 the text column is ~428px for a 459–490px line, so two metas
    // truncated before their price; at 768 the room is 334px against the
    // longest meta's 268px.
    board(week({}, [entry()]));
    const meta = screen.getByText(META);
    const line = meta.parentElement as HTMLElement;
    const small = (element: Element) =>
      [...element.classList].filter((name) => name.startsWith("sm:"));
    expect(small(meta)).toEqual([]);
    expect(small(line)).toEqual([]);
    expect(meta).toHaveClass(
      "order-last",
      "basis-full",
      "md:order-none",
      "md:min-w-0",
      "md:flex-1",
      "md:basis-auto",
      "md:truncate",
    );
    expect(line).toHaveClass("flex-wrap", "md:flex-nowrap");
  });

  it("sets the meta straight under the time's line, which the '⋯' overhangs by exactly its excess", () => {
    // On a phone the meta started 21px under the time's baseline, against
    // 13px from the meta to the title: a 4px row gap under a 36px line whose
    // height was the "⋯" square's, not the time's.
    board(week({}, [entry()]));
    const line = screen.getByText(META).parentElement as HTMLElement;
    expect([...line.classList].filter((name) => /(^|:)gap-y-/.test(name))).toEqual([]);
    const first = screen.getByText("7:00 AM").parentElement as HTMLElement;
    const menu = screen.getByRole("button", { name: /^Move, copy, or remove / });
    const square = px(token(menu, /^w-(\d+)$/));
    const overhang = px(token(menu, /^-my-([\d.]+)$/));
    expect(square - 2 * overhang).toBe(px(token(first, /^min-h-(\d+)$/)));
  });
});
