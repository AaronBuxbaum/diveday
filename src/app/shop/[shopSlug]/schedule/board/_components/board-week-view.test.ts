import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { boardWeekView, boatWarningFor } from "./board-week-view";

const st = staffTranslator("en-US");
const TZ = "America/New_York";
type Input = Parameters<typeof boardWeekView>[0];

const at = (iso: string) => new Date(iso);

function departure(over: Record<string, unknown>) {
  return {
    tripId: "t1",
    title: "Two-Tank Reef",
    startsAt: at("2026-07-21T12:00:00Z"),
    endsAt: at("2026-07-21T16:00:00Z"),
    priceCents: 12_000,
    booked: 4,
    capacity: 12,
    status: "scheduled",
    diveSiteName: "Molasses",
    diveMode: "boat",
    boatId: "b1",
    ...over,
  };
}

function input(over: Partial<Input> = {}): Input {
  return {
    shopSlug: "blue-mantis",
    weekStartIso: "2026-07-20",
    todayIso: "2026-07-21",
    range: { first: at("2026-07-21T12:00:00Z") },
    weekRows: {
      days: { "2026-07-21": [departure({})] },
      spans: [],
    } as unknown as Input["weekRows"],
    weekAsks: [],
    openRollCalls: [],
    crewByTrip: new Map(),
    boatMap: new Map([["b1", "Reef Runner"]]),
    shop: { hasBoatDiving: true, crewScheduleEnabled: false },
    boatCount: 1,
    hasUpcoming: true,
    currency: "usd",
    locale: "en-US",
    tz: TZ,
    st,
    ...over,
  };
}

describe("boatWarningFor", () => {
  const context = {
    hasBoatDiving: true,
    boatCount: 1,
    boatMap: new Map([["b1", "Reef Runner"]]),
    locale: "en-US",
    st,
  };

  it("names a hull booked on two departures at once", () => {
    const warning = boatWarningFor(context, [
      departure({}),
      departure({ tripId: "t2", startsAt: at("2026-07-21T13:00:00Z") }),
    ] as never);
    expect(warning).toContain("Reef Runner");
  });

  it("counts against the fleet when no hull is assigned", () => {
    const warning = boatWarningFor({ ...context, boatCount: 1 }, [
      departure({ boatId: null }),
      departure({ tripId: "t2", boatId: null }),
    ] as never);
    expect(warning).toBe(st("boats.concurrencyWarning", { tripCount: 2, boatCount: 1 }));
  });

  it("asks nothing of a shop that runs no boats", () => {
    expect(
      boatWarningFor({ ...context, hasBoatDiving: false }, [departure({})] as never),
    ).toBeNull();
  });
});

describe("boardWeekView", () => {
  it("is null while the board has nothing upcoming", () => {
    expect(boardWeekView(input({ hasUpcoming: false }))).toBeNull();
  });

  it("draws seven columns, today marked, with the departure in its day", () => {
    const week = boardWeekView(input());
    expect(week?.days).toHaveLength(7);
    const today = week?.days.find((day) => day.isToday);
    expect(today?.dateIso).toBe("2026-07-21");
    expect(today?.entries[0]?.meta).toContain("Molasses");
    expect(today?.entries[0]?.meta).toContain("Reef Runner");
    expect(week?.days[0]?.isPast).toBe(true);
    expect(week?.previousHref).toBe("/shop/blue-mantis/schedule/board?week=2026-07-13");
    expect(week?.thisWeekHref).toBeNull();
  });

  it("points an empty week at the next departure", () => {
    const week = boardWeekView(
      input({
        weekRows: { days: {}, spans: [] } as unknown as Input["weekRows"],
        range: { first: at("2026-08-04T12:00:00Z") },
      }),
    );
    expect(week?.nextDeparture?.href).toBe("/shop/blue-mantis/schedule/board?week=2026-08-04");
  });

  /** Fifth loop, item 30: last year's week beside this one, and its copy. */
  it("sets the same week last year beside this one, quiet without that history", () => {
    const lastYear = { taken: 54, total: 80, departures: 6 };
    expect(boardWeekView(input({ lastYear }))?.lastYearTally).toBe("Same week last year: 54 of 80");
    expect(
      boardWeekView(input({ lastYear: { taken: 0, total: 0, departures: 0 } }))?.lastYearTally,
    ).toBeNull();
    // A week with boats on it is not offered last year's.
    expect(boardWeekView(input({ lastYear }))?.copyLastYear).toBeNull();
  });

  it("offers last year's departures to an empty week still to come, and not to one gone by", () => {
    const empty = { days: {}, spans: [] } as unknown as Input["weekRows"];
    const lastYear = { taken: 54, total: 80, departures: 6 };
    const ahead = boardWeekView(input({ weekRows: empty, lastYear, weekStartIso: "2026-07-27" }));
    expect(ahead?.copyLastYear).toMatchObject({
      line: "Last year this week: 6 departures.",
      label: "Copy them here",
      weekStart: "2026-07-27",
    });
    const gone = boardWeekView(input({ weekRows: empty, lastYear, weekStartIso: "2026-07-06" }));
    expect(gone?.copyLastYear).toBeNull();
  });

  it("clamps a course that started before the week to its first column", () => {
    const week = boardWeekView(
      input({
        weekRows: {
          days: {},
          spans: [
            {
              ...departure({ tripId: "c1", title: "Open Water" }),
              firstDay: "2026-07-18",
              lastDay: "2026-07-21",
              dayCount: 4,
              instructorName: "Ana",
            },
          ],
        } as unknown as Input["weekRows"],
      }),
    );
    expect(week?.spans[0]).toMatchObject({ startColumn: 1, columnSpan: 2, dateIso: "2026-07-18" });
  });

  /** Fourth review, item 12: the crew member away on a day the departure meets. */
  it("names who is rostered and away, with their days, on a boat and a course bar", () => {
    const away = [
      { id: "b", personId: "p1", startsOn: "2026-07-21", endsOn: "2026-07-22", note: null },
    ];
    const week = boardWeekView(
      input({
        shop: { hasBoatDiving: true, crewScheduleEnabled: true },
        crewByTrip: new Map([
          [
            "t1",
            [
              { id: "p1", name: "Marcus Webb", away },
              { id: "p2", name: "Sal Moretti", away: [] },
            ],
          ],
          ["c1", [{ id: "p1", name: "Marcus Webb", away }]],
        ]),
        weekRows: {
          days: { "2026-07-21": [departure({})] },
          spans: [
            {
              ...departure({ tripId: "c1", title: "Open Water" }),
              firstDay: "2026-07-21",
              lastDay: "2026-07-22",
              dayCount: 2,
              instructorName: "Marcus Webb",
            },
          ],
        } as unknown as Input["weekRows"],
      }),
    );
    const today = week?.days.find((day) => day.isToday);
    expect(today?.entries[0]?.crewAway?.replace(/\s/g, " ")).toBe(
      "Marcus Webb away Tue, Jul 21 – Wed, Jul 22",
    );
    expect(week?.spans[0]?.crewAway).toContain("Marcus Webb away");
    expect(
      boardWeekView(input())?.days.find((day) => day.isToday)?.entries[0]?.crewAway,
    ).toBeNull();
  });
});
