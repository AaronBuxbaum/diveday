import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import {
  aboveStatedLevelIds,
  type RequirementsByTrip,
  type ScheduleView,
  scheduleDayWords,
  scheduleFilterCopy,
  scheduleMonthBounds,
  scheduleMonthRail,
  nextBoatCardShows,
  scheduleNextBoat,
  scheduleOffSeason,
  schedulePagerHrefs,
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
  isEmbed: false,
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

describe("scheduleViewLinks", () => {
  it("carries every filter and the resolved lens forward", () => {
    const { withViewParams, filterSuffix, lensHref } = scheduleViewLinks({
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
    expect(filterSuffix).toBe(
      "&hasSpace=1&tripType=course&canDive=open_water&hideAbove=1&lens=night",
    );
    expect(lensHref("wreck")).toBe(
      "/s/blue-mantis?month=2026-08&hasSpace=1&tripType=course&canDive=open_water&hideAbove=1&lens=wreck",
    );
  });

  it("drops the lens for the reset chip", () => {
    const { lensHref } = scheduleViewLinks({ ...VIEW, activeLens: { slug: "night" } });
    expect(lensHref(null)).toBe("/s/blue-mantis");
  });
});

describe("schedulePagerHrefs", () => {
  it("steps forward with the cursor stacked, and back to the next boat without month or cursor", () => {
    const pager = schedulePagerHrefs({
      view: { ...VIEW, month: "2026-08", hasSpaceFilter: true },
      after: undefined,
      back: undefined,
      nextCursor: "c2",
    });
    expect(pager.earlier).toBeNull();
    const later = new URL(`https://x${pager.later}`);
    expect(later.pathname).toBe("/s/blue-mantis");
    expect(later.searchParams.get("after")).toBe("c2");
    // The first page's own position rides the stack, so "earlier" can come back to it.
    expect(later.searchParams.get("back")).not.toBeNull();
    expect(later.searchParams.get("month")).toBe("2026-08");
    expect(later.searchParams.get("hasSpace")).toBe("1");
    expect(pager.backToNext).toBe("/s/blue-mantis?hasSpace=1");
  });

  it("finds the earlier page from the stack it was handed", () => {
    const forward = schedulePagerHrefs({
      view: VIEW,
      after: undefined,
      back: undefined,
      nextCursor: "c2",
    });
    const second = new URL(`https://x${forward.later}`).searchParams;
    const fromSecond = schedulePagerHrefs({
      view: VIEW,
      after: second.get("after") ?? undefined,
      back: second.get("back") ?? undefined,
      nextCursor: null,
    });
    expect(fromSecond.later).toBeNull();
    expect(fromSecond.earlier).toBe("/s/blue-mantis");
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

describe("scheduleDayWords", () => {
  it("says today and tomorrow, and a short date after that", () => {
    const { whenWord, dayKeyOf } = scheduleDayWords(NOW, "en-US", TZ);
    expect(dayKeyOf(NOW)).toBe("2026-07-21");
    expect(whenWord(new Date("2026-07-22T11:00:00Z"))).toMatch(/tomorrow/i);
    expect(whenWord(new Date("2026-07-28T11:00:00Z"))).not.toMatch(/tomorrow|today/i);
  });
});

describe("scheduleSeatState", () => {
  it("words a full boat, a nearly full one and an open one", () => {
    expect(scheduleSeatState(t, { capacity: 10, booked: 10 }).tone).toBe("full");
    expect(scheduleSeatState(t, { capacity: 10, booked: 8 }).tone).toBe("low");
    expect(scheduleSeatState(t, { capacity: 10, booked: 2 }).tone).toBe("quiet");
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
  it("is quiet on a board with nothing for a month, and never in the frame", () => {
    const later = new Date("2026-10-01T12:00:00Z");
    const page = scheduleOffSeason({
      isEmbed: false,
      now: NOW,
      range: { first: later },
      reopensOn: null,
      locale: "en-US",
      tz: TZ,
      t,
    });
    expect(page.quiet.quiet).toBe(true);
    expect(page.quietLine).toContain("Oct");
    const frame = scheduleOffSeason({
      isEmbed: true,
      now: NOW,
      range: { first: later },
      reopensOn: null,
      locale: "en-US",
      tz: TZ,
      t,
    });
    expect(frame.quiet.quiet).toBe(false);
    expect(frame.quietLine).toBeNull();
  });
});

describe("scheduleNextBoat", () => {
  const base = {
    isEmbed: false,
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

  it("pins nothing on a paged view or in the frame", () => {
    const listed = trips({});
    expect(scheduleNextBoat({ ...base, visibleUpcoming: listed, after: "c1" }).nextBoat).toBeNull();
    expect(
      scheduleNextBoat({ ...base, visibleUpcoming: listed, isEmbed: true }).nextBoat,
    ).toBeNull();
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
    isEmbed: false,
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
