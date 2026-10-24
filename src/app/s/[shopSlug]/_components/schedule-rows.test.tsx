// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { shelfCourseCards, weekLedgerRows } from "./schedule-rows";
import type { RequirementsByTrip, UpcomingTrips } from "./schedule-view";

const t = diverTranslator("en-US");
const TZ = "America/New_York";

afterEach(cleanup);

const listed = [
  {
    id: "t1",
    title: "Two-Tank Reef",
    startsAt: new Date("2026-07-25T12:00:00Z"),
    endsAt: new Date("2026-07-25T16:00:00Z"),
    capacity: 10,
    booked: 9,
    course: null,
    lensId: "l1",
    priceCents: 12_000,
  },
  {
    id: "t2",
    title: "Open Water — Day 1",
    startsAt: new Date("2026-07-26T12:00:00Z"),
    endsAt: new Date("2026-07-26T16:00:00Z"),
    capacity: 6,
    booked: 0,
    course: {
      title: "Open Water",
      slug: "open-water",
      priceCents: null,
      eLearningPriceCents: null,
    },
    lensId: null,
    priceCents: null,
  },
  {
    id: "t3",
    title: "Nitrox Diver, classroom & two dives",
    startsAt: new Date("2026-07-27T12:00:00Z"),
    endsAt: new Date("2026-07-27T16:00:00Z"),
    capacity: 6,
    booked: 0,
    course: { title: "Nitrox", slug: "nitrox", priceCents: 30_000, eLearningPriceCents: 4_500 },
    lensId: null,
    priceCents: 15_000,
  },
] as unknown as UpcomingTrips;

function rows(overrides: { isEmbed?: boolean; above?: string[] } = {}) {
  return weekLedgerRows({
    listedTrips: listed,
    lenses: [{ id: "l1", name: "Reef day", slug: "reef" }] as never,
    diveSitesByTrip: new Map([
      ["t1", { sites: [{ name: "Molasses" }, { name: "French" }], undecidedDives: 1 }],
    ]) as never,
    requirementsByTrip: new Map([
      [
        "t1",
        {
          minimumCertificationLevel: "advanced_open_water",
          requiredSpecialties: [],
          requiresNitrox: false,
        },
      ],
      [
        "t2",
        { minimumCertificationLevel: "open_water", requiredSpecialties: [], requiresNitrox: false },
      ],
    ]) as unknown as RequirementsByTrip,
    aboveStatedLevel: new Set(overrides.above ?? []),
    dayKeyOf: (date) => date.toISOString().slice(0, 10),
    shopSlug: "blue-mantis",
    isEmbed: overrides.isEmbed ?? false,
    timezone: TZ,
    currency: "usd",
    locale: "en-US",
    t,
  });
}

describe("weekLedgerRows", () => {
  it("links each row to its trip page, the frame's links staying in the frame", () => {
    expect(rows()[0]?.href).toBe("/s/blue-mantis/trips/t1");
    expect(rows({ isEmbed: true })[0]?.href).toBe("/s/blue-mantis/trips/t1?embed=1");
  });

  it("names the sites and the dives still to confirm", () => {
    const { container } = render(<span>{rows()[0]?.site}</span>);
    expect(container.textContent).toContain("Molasses and French");
    expect(container.textContent).toContain("·");
  });

  it("words low seats plainly and wears the shop's lens word", () => {
    const [reef] = rows();
    expect(reef?.capacityTone).toBe("quiet");
    expect(reef?.lens).toBe("Reef day");
    expect(reef?.price).toContain("120");
  });

  it("asks a course session for nothing, and points it at its course", () => {
    const [, course] = rows();
    expect(course?.requirements).toEqual([]);
    expect(course?.course?.href).toBe("/s/blue-mantis/courses/open-water");
    expect(course?.price).toBeNull();
  });

  it("prices a course session with the course total the booking charges (fourth UX review, item 2)", () => {
    // The trip row's own $150 is not what checkout asks for; fee plus
    // eLearning is, so the schedule says $345 (H-125).
    const nitrox = rows()[2];
    expect(nitrox?.price).toContain("345");
    expect(nitrox?.price).not.toContain("150");
  });

  it("marks, never removes, a departure above the stated level", () => {
    const marked = rows({ above: ["t1"] });
    expect(marked).toHaveLength(3);
    expect(marked[0]?.aboveLevel).toBe(t("schedule.filters.aboveLevelChip"));
    expect(marked[1]?.aboveLevel).toBeNull();
  });
});

describe("shelfCourseCards", () => {
  it("takes the first three courses, with a next start where one is scheduled", () => {
    const course = (id: string) => ({
      id,
      slug: id,
      title: `Course ${id}`,
      summary: "Down to {depth18}",
      overview: null,
      durationText: "3 days",
      groupSizeText: null,
      prerequisiteNote: null,
      includes: [],
      excludes: [],
      scheduleDays: [],
      faqs: [],
      learningMaterials: [],
      heroImageUrl: null,
      heroImageAlt: null,
      priceCents: 50_000,
    });
    const cards = shelfCourseCards({
      activeCourses: ["a", "b", "c", "d"].map(course) as never,
      shelfNextStarts: new Map([["a", new Date("2026-08-01T12:00:00Z")]]),
      shop: { depthUnit: "meters", timezone: TZ },
      shopSlug: "blue-mantis",
      currency: "usd",
      locale: "en-US",
      t,
    });
    expect(cards.map((card) => card.id)).toEqual(["a", "b", "c"]);
    expect(cards[0]?.nextStart).toContain("Aug");
    expect(cards[1]?.nextStart).toBeNull();
    expect(cards[0]?.href).toBe("/s/blue-mantis/courses/a");
    // Depth markers resolve into the shop's own unit before anything reads them.
    expect(cards[0]?.summary).toBe("Down to 18 meters");
  });
});
