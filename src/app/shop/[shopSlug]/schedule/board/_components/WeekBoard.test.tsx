// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GroupLabel } from "@/components/ui/ledger";
import { type BuilderWeek, WeekBoard, type WeekBoardCopy } from "./WeekBoard";

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
function week(
  overrides: Partial<BuilderWeek> = {},
  entries: BuilderWeek["days"][number]["entries"] = [],
): BuilderWeek {
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
