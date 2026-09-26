// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";

/**
 * **A framed course reads in the shop's unit, never as a marker** (K-376).
 * A course's prose carries its depths as `{depth18}`-style placeholders that a
 * rendering page resolves into the shop's unit (src/lib/courses.ts). The
 * widgets rendered `course.summary` raw, so a blog post framing the course
 * list showed "How to dive between {depth18n} and {depth40}…", and once the
 * phone clamp let the summary run to two lines the markers reached every
 * phone as well.
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops", () => ({
  shopBySlugCached: vi.fn(async () => ({
    id: "shop-1",
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    defaultLocale: "en-US",
    currency: "USD",
    timezone: "America/New_York",
    depthUnit: "feet",
  })),
}));
vi.mock("@/db/boats", () => ({ listBoats: vi.fn(async () => []) }));
vi.mock("@/db/trips", () => ({
  getTripWithBooked: vi.fn(async () => null),
  pagedUpcomingTripsWithCounts: vi.fn(async () => ({ trips: [] })),
}));
vi.mock("@/db/courses", () => ({ listActiveCourses: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ publicAppUrl: () => "" }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({ locale: "en-US", t: diverTranslator("en-US") })),
}));

const { listActiveCourses } = await import("@/db/courses");
const { default: EmbedWidgetPage } = await import("./page");

afterEach(cleanup);

const deepDiver = {
  id: "course-deep",
  slug: "deep-diver",
  title: "Deep Diver",
  summary: "How to dive between {depth18n} and {depth40} and come back with a plan intact",
  overview: null,
  heroImageUrl: null,
  heroImageAlt: null,
  galleryPhotos: [],
  durationText: "Two days, to {depth40}",
  groupSizeText: null,
  minimumAge: null,
  prerequisiteNote: null,
  includes: [],
  excludes: [],
  scheduleDays: [],
  faqs: [],
  isIntroCourse: false,
  priceCents: 32_500,
};

async function renderWidget(widget: "courses" | "grid") {
  vi.mocked(listActiveCourses).mockResolvedValue([deepDiver] as never);
  render(
    await EmbedWidgetPage({
      params: Promise.resolve({ shopSlug: "blue-mantis", widget }),
      searchParams: Promise.resolve({}),
    }),
  );
}

describe("the embed widgets' course prose", () => {
  it.each(["courses", "grid"] as const)(
    "resolves every depth marker in the %s widget into the shop's unit",
    async (widget) => {
      await renderWidget(widget);

      expect(document.body.textContent).not.toContain("{depth");
      expect(
        screen.getByText("How to dive between 60 and 130 feet and come back with a plan intact"),
      ).toBeInTheDocument();
    },
  );

  it("resolves the course list's duration line too", async () => {
    await renderWidget("courses");

    expect(screen.getByText("Two days, to 130 feet")).toBeInTheDocument();
  });
});
