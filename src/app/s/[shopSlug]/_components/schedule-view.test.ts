import { describe, expect, expectTypeOf, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import {
  aboveStatedLevelIds,
  nextBoatCardShows,
  type RequirementsByTrip,
  type ScheduleView,
  scheduleDayWords,
  scheduleEmbedWindow,
  scheduleFilterCopy,
  scheduleFiltersFor,
  scheduleMonthBounds,
  scheduleMonthRail,
  scheduleNextBoat,
  scheduleOffSeason,
  schedulePagerHrefs,
  scheduleRollingWindow,
  scheduleSeatState,
  scheduleViewLinks,
  type UpcomingTrips,
} from "./schedule-view";

const t = diverTranslator("en-US");
const TZ = "America/New_York";
const NOW = new Date("2026-07-21T13:30:00Z");

const VIEW: ScheduleView = {
  shopSlug: "blue-mantis",
  month: undefined,
  hasSpaceFilter: false,
  tripTypeFilter: undefined,
  canDiveFilter: undefined,
  hideAboveFilter: false,
  activeLens: null,
};

function trips(...rows: Array<Record<string, unknown>>): UpcomingTrips {
  return rows.map((row, index) => ({
    id: `t${index}`,
    capacity: 10,
    booked: 0,
    course: null,
    startsAt: NOW,
    ...row,
  })) as unknown as UpcomingTrips;
}

describe("scheduleMonthBounds", () => {
  it("bounds a month at the shop's own midnight", () => {
    const { monthStart, monthEnd } = scheduleMonthBounds({ year: 2026, month: 8 }, TZ);
    expect(monthStart.toISOString()).toBe("2026-08-01T04:00:00.000Z");
    expect(monthEnd.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });
});

describe("scheduleRollingWindow", () => {
  it("is the month view without a month, and nothing for the list or a chosen month", () => {
    const base = { now: NOW, tz: TZ, locale: "en-US" };
    expect(scheduleRollingWindow({ ...base, monthView: false, explicitMonth: null })).toBeNull();
    expect(
      scheduleRollingWindow({ ...base, monthView: true, explicitMonth: { year: 2026, month: 8 } }),
    ).toBeNull();
    expect(scheduleRollingWindow({ ...base, monthView: true, explicitMonth: null })).not.toBeNull();
  });

  it("starts on the shop's own week and ends at the shop's own midnight", () => {
    // Tuesday 21 July 2026, 9:30 AM in New York: the week opens Sunday the 19th.
    const rolling = scheduleRollingWindow({
      now: NOW,
      tz: TZ,
      locale: "en-US",
      monthView: true,
      explicitMonth: null,
    });
    expect(rolling?.window.start).toBe("2026-07-19");
    expect(rolling?.bounds.monthEnd.toISOString()).toBe("2026-08-23T04:00:00.000Z");
  });

  it("reads today in the shop's zone, not UTC", () => {
    // 2026-07-21 23:30 UTC is already Wednesday the 22nd in Auckland.
    const rolling = scheduleRollingWindow({
      now: new Date("2026-07-21T23:30:00Z"),
      tz: "Pacific/Auckland",
      locale: "en-US",
      monthView: true,
      explicitMonth: null,
    });
    expect(rolling?.window.start).toBe("2026-07-19");
    const later = scheduleRollingWindow({
      now: new Date("2026-07-25T13:00:00Z"),
      tz: "Pacific/Auckland",
      locale: "en-US",
      monthView: true,
      explicitMonth: null,
    });
    // Sunday the 26th in Auckland opens a new week.
    expect(later?.window.start).toBe("2026-07-26");
  });
});

describe("the month view's own links", () => {
  it("opens the month view without a month, so it starts on this week", () => {
    const { viewHref } = scheduleViewLinks(VIEW);
    expect(viewHref(true, null)).toBe("/s/blue-mantis?view=month");
    expect(viewHref(true, "2026-08")).toBe("/s/blue-mantis?view=month&month=2026-08");
  });
});

describe("scheduleViewLinks", () => {
  it("carries every filter and the resolved lens forward", () => {
    const { withViewParams, monthHref, lensHref } = scheduleViewLinks({
      ...VIEW,
      month: "2026-08",
      hasSpaceFilter: true,
      tripTypeFilter: "course",
      canDiveFilter: "open_water",
      hideAboveFilter: true,
      activeLens: { slug: "night" },
    });
    expect(withViewParams(new URLSearchParams()).toString()).toBe(
      "month=2026-08&hasSpace=1&tripType=course&canDive=open_water&hideAbove=1&lens=night",
    );
    expect(new URL(`https://x${monthHref("2026-09")}`).searchParams.toString()).toBe(
      "month=2026-09&hasSpace=1&tripType=course&canDive=open_water&hideAbove=1&lens=night",
    );
    expect(lensHref("wreck")).toBe(
      "/s/blue-mantis?month=2026-08&hasSpace=1&tripType=course&canDive=open_water&hideAbove=1&lens=wreck",
    );
  });

  it("drops the lens for the reset chip", () => {
    const { lensHref } = scheduleViewLinks({ ...VIEW, activeLens: { slug: "night" } });
    expect(lensHref(null)).toBe("/s/blue-mantis");
  });

  it("encodes a resolved lens with reserved characters and omits an unresolved lens", () => {
    const reserved = scheduleViewLinks({
      ...VIEW,
      activeLens: { slug: "night & wreck/reef?" },
    });
    const reservedHref = reserved.monthHref("2026-09");
    expect(reservedHref).toContain("lens=night+%26+wreck%2Freef%3F");
    expect(new URL(`https://x${reservedHref}`).searchParams.get("lens")).toBe(
      "night & wreck/reef?",
    );

    const unresolved = scheduleViewLinks({ ...VIEW, activeLens: null });
    expect(new URL(`https://x${unresolved.monthHref("2026-09")}`).searchParams.has("lens")).toBe(
      false,
    );
  });

  it("replaces the month in month links", () => {
    const { monthHref } = scheduleViewLinks({ ...VIEW, month: "2026-08" });
    const params = new URL(`https://x${monthHref("2026-09")}`).searchParams;
    expect(params.get("month")).toBe("2026-09");
  });
});

describe("schedulePagerHrefs", () => {
  it("steps forward with an after cursor, and back to the next boat without month or cursor", () => {
    const pager = schedulePagerHrefs({
      view: { ...VIEW, month: "2026-08", hasSpaceFilter: true },
      prevCursor: null,
      nextCursor: "c2",
    });
    expect(pager.earlier).toBeNull();
    const later = new URL(`https://x${pager.later}`);
    expect(later.pathname).toBe("/s/blue-mantis");
    expect(later.searchParams.get("after")).toBe("c2");
    // Nothing is stacked in the URL: Back is its own cursor, not history.
    expect(later.searchParams.has("back")).toBe(false);
    expect(later.searchParams.get("month")).toBe("2026-08");
    expect(later.searchParams.get("hasSpace")).toBe("1");
    expect(pager.backToNext).toBe("/s/blue-mantis?hasSpace=1");
  });

  it("steps back with a before cursor and keeps the view", () => {
    const pager = schedulePagerHrefs({
      view: { ...VIEW, hasSpaceFilter: true },
      prevCursor: "c1",
      nextCursor: null,
    });
    expect(pager.later).toBeNull();
    const earlier = new URL(`https://x${pager.earlier}`);
    expect(earlier.searchParams.get("before")).toBe("c1");
    expect(earlier.searchParams.has("after")).toBe(false);
    expect(earlier.searchParams.get("hasSpace")).toBe("1");
  });
});

describe("aboveStatedLevelIds", () => {
  const requirements = new Map([
    ["t0", { minimumCertificationLevel: "advanced_open_water" }],
    ["t1", { minimumCertificationLevel: "open_water" }],
    ["t2", { minimumCertificationLevel: "rescue" }],
  ]) as unknown as RequirementsByTrip;

  it("marks departures above the stated rung, never a course session", () => {
    const listed = trips({}, {}, { course: { slug: "rescue" } });
    expect([...aboveStatedLevelIds(listed, requirements, "open_water")]).toEqual(["t0"]);
  });

  it("marks nothing when the reader said nothing", () => {
    expect(aboveStatedLevelIds(trips({}, {}), requirements, undefined).size).toBe(0);
  });
});

describe("scheduleMonthRail", () => {
  it("steps only between months that hold departures", () => {
    const rail = scheduleMonthRail({
      range: { first: new Date("2026-07-25T12:00:00Z"), last: new Date("2026-08-20T12:00:00Z") },
      explicitMonth: null,
      now: NOW,
      tz: TZ,
    });
    expect(rail.currentMonth).toEqual({ year: 2026, month: 7 });
    expect(rail.prevMonthKey).toBeNull();
    expect(rail.nextMonthKey).toBe("2026-08");
    expect(rail.lastTripMonth).toEqual({ year: 2026, month: 8 });
  });
});

describe("the month rail over the grid that starts on this week", () => {
  const window = {
    start: "2026-07-19",
    weeks: 5,
    first: { year: 2026, month: 7 },
    last: { year: 2026, month: 8 },
  };
  it("steps on from the last month the grid draws and never back into the past", () => {
    const rail = scheduleMonthRail({
      range: { first: new Date("2026-07-25T12:00:00Z"), last: new Date("2026-10-20T12:00:00Z") },
      explicitMonth: null,
      window,
      now: NOW,
      tz: TZ,
    });
    expect(rail.prevMonthKey).toBeNull();
    expect(rail.nextMonthKey).toBe("2026-09");
  });
  it("has no next month when the grid already reaches the last departure", () => {
    const rail = scheduleMonthRail({
      range: { first: new Date("2026-07-25T12:00:00Z"), last: new Date("2026-08-20T12:00:00Z") },
      explicitMonth: null,
      window,
      now: NOW,
      tz: TZ,
    });
    expect(rail.nextMonthKey).toBeNull();
  });
});

describe("scheduleDayWords", () => {
  it("says today and tomorrow, and a short date after that", () => {
    const { whenWord, dayKeyOf } = scheduleDayWords(NOW, "en-US", TZ);
    expect(dayKeyOf(NOW)).toBe("2026-07-21");
    expect(whenWord(new Date("2026-07-22T11:00:00Z"))).toMatch(/tomorrow/i);
    expect(whenWord(new Date("2026-07-28T11:00:00Z"))).not.toMatch(/tomorrow|today/i);
  });

  it("finds tomorrow on the calendar, not 24 hours on, across a clock change", () => {
    // Clocks go back on 2026-11-01: that day has 25 hours, so 24 hours after
    // 00:30 is still the same day.
    const fallBack = scheduleDayWords(new Date("2026-11-01T04:30:00Z"), "en-US", TZ);
    expect(fallBack.whenWord(new Date("2026-11-02T15:00:00Z"))).toMatch(/tomorrow/i);
    // Clocks go forward on 2026-03-08: that day has 23 hours, so 24 hours after
    // 23:30 the evening before lands on the day after tomorrow.
    const springForward = scheduleDayWords(new Date("2026-03-08T04:30:00Z"), "en-US", TZ);
    expect(springForward.whenWord(new Date("2026-03-08T15:00:00Z"))).toMatch(/tomorrow/i);
    expect(springForward.whenWord(new Date("2026-03-09T15:00:00Z"))).not.toMatch(/tomorrow/i);
  });
});

describe("scheduleSeatState", () => {
  it("words a full boat, a nearly full one and an open one", () => {
    expect(scheduleSeatState(t, { capacity: 10, booked: 10 })).toEqual({
      text: "Full",
      tone: "full",
    });
    expect(scheduleSeatState(t, { capacity: 10, booked: 2 }).tone).toBe("quiet");
  });

  /** Visual review 2026-10-24, B19: one neutral count, two seats as plainly as eight. */
  it("words two seats as plainly as eight, with no urgent tone", () => {
    expect(scheduleSeatState(t, { capacity: 10, booked: 8 })).toEqual({
      text: "2 seats",
      tone: "quiet",
    });
    expect(scheduleSeatState(t, { capacity: 10, booked: 9 }).text).toBe("1 seat");
    expect(scheduleSeatState(t, { capacity: 10, booked: 2 }).text).toBe("8 seats");
  });
});

describe("scheduleFilterCopy", () => {
  it("offers the declarable levels in ladder order", () => {
    const copy = scheduleFilterCopy(t);
    expect(copy.canDiveLevels[0]?.value).toBe("open_water");
    expect(copy.disclosure).toBe(t("schedule.filters.disclosure"));
  });
});

describe("scheduleOffSeason", () => {
  it("is quiet on a board with nothing for a month", () => {
    const later = new Date("2026-10-01T12:00:00Z");
    const page = scheduleOffSeason({
      now: NOW,
      range: { first: later },
      reopensOn: null,
      locale: "en-US",
      tz: TZ,
      t,
    });
    expect(page.quiet.quiet).toBe(true);
    expect(page.quietLine).toContain("Oct");
  });
});

describe("scheduleNextBoat", () => {
  const base = {
    explicitMonth: null,
    after: undefined,
    hasSpaceFilter: false,
    tripTypeFilter: undefined,
    hideAboveFilter: false,
    activeLens: null,
  } as const;

  it("pins the first boat with room and counts the full ones it stepped over", () => {
    const listed = trips({ booked: 10 }, { booked: 3 });
    const view = scheduleNextBoat({ ...base, visibleUpcoming: listed });
    expect(view.nextBoat?.id).toBe("t1");
    expect(view.skippedBoats).toBe(1);
    expect(view.firstSkippedBoat?.id).toBe("t0");
    expect(view.filteredView).toBe(false);
  });

  it("pins nothing on a paged view", () => {
    const listed = trips({});
    expect(scheduleNextBoat({ ...base, visibleUpcoming: listed, after: "c1" }).nextBoat).toBeNull();
  });

  it("calls a lens a narrowed view", () => {
    const view = scheduleNextBoat({
      ...base,
      visibleUpcoming: trips({}),
      activeLens: { slug: "night" },
    });
    expect(view.filteredView).toBe(true);
  });
});

/**
 * Visual review 2026-10-24, B17: the card repeated the list's first row when
 * that row was the next boat with space. It shows only when it says something
 * the first row does not.
 */
describe("the next-boat card", () => {
  const base = {
    explicitMonth: null,
    after: undefined,
    hasSpaceFilter: false,
    tripTypeFilter: undefined,
    hideAboveFilter: false,
    activeLens: null,
  } as const;

  it("is suppressed when the next boat with space is the first row", () => {
    const listed = trips({ booked: 3 }, { booked: 0 });
    expect(nextBoatCardShows(listed[0], listed)).toBe(false);
    expect(scheduleNextBoat({ ...base, visibleUpcoming: listed }).nextBoat).toBeNull();
  });

  it("shows when the first row is full", () => {
    const listed = trips({ booked: 10 }, { booked: 3 });
    expect(scheduleNextBoat({ ...base, visibleUpcoming: listed }).nextBoat?.id).toBe("t1");
  });

  it("shows when the boat with space sails a later day than the list's first", () => {
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    const listed = trips({ booked: 10 }, { booked: 10 }, { booked: 0, startsAt: later });
    const view = scheduleNextBoat({ ...base, visibleUpcoming: listed });
    expect(view.nextBoat?.id).toBe("t2");
    expect(view.skippedBoats).toBe(2);
  });

  it("is suppressed with no boat, and with an empty list", () => {
    expect(nextBoatCardShows(null, trips({}))).toBe(false);
    expect(nextBoatCardShows({ id: "t0" }, [])).toBe(false);
  });

  it("is suppressed when every boat is full", () => {
    const listed = trips({ booked: 10 }, { booked: 10 });
    expect(scheduleNextBoat({ ...base, visibleUpcoming: listed }).nextBoat).toBeNull();
  });
});

it("keeps a party preference through month, lens and page navigation", () => {
  const view = { ...VIEW, partySize: 4 };
  const links = scheduleViewLinks(view);
  expect(links.monthHref("2026-08")).toContain("partySize=4");
  expect(links.lensHref("reef")).toContain("partySize=4");
  const pager = schedulePagerHrefs({ view, prevCursor: "before", nextCursor: "after" });
  for (const href of [pager.earlier, pager.later, pager.backToNext])
    expect(href).toContain("partySize=4");
});

it("resolves only supported trip types and keeps their literal contract", () => {
  const course = scheduleFiltersFor({ tripType: "course", partySize: "4" });
  expectTypeOf(course.tripTypeFilter).toEqualTypeOf<"course" | "fun_dive" | undefined>();
  expect(course.tripTypeFilter).toBe("course");
  expect(scheduleFiltersFor({ tripType: "fun_dive" }).tripTypeFilter).toBe("fun_dive");
  expect(scheduleFiltersFor({ tripType: "unknown" }).tripTypeFilter).toBeUndefined();
});

it("keeps today’s departed rows and four upcoming trips in the embed", () => {
  const listed = trips(
    { startsAt: new Date(NOW.getTime() - 3_600_000) },
    ...Array.from({ length: 5 }, (_, index) => ({
      startsAt: new Date(NOW.getTime() + (index + 1) * 3_600_000),
    })),
  );
  expect(scheduleEmbedWindow(listed, NOW, 4).map((trip) => trip.id)).toEqual([
    "t0",
    "t1",
    "t2",
    "t3",
    "t4",
  ]);
});
