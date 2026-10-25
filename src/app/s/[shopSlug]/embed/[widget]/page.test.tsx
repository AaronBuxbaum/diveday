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
const shopRow = {
  id: "shop-1",
  slug: "blue-mantis",
  name: "Blue Mantis Divers",
  defaultLocale: "en-US",
  currency: "USD",
  timezone: "America/New_York",
  depthUnit: "feet",
  reviewsEnabled: true,
};
vi.mock("@/db/shops-cached", () => ({ shopBySlugCached: vi.fn(async () => shopRow) }));
vi.mock("@/db/reviews", () => ({
  getShopReviewAggregate: vi.fn(),
  listPublishedShopReviewsPage: vi.fn(),
}));
vi.mock("@/db/boats", () => ({ listBoats: vi.fn(async () => []) }));
vi.mock("@/db/trips", () => ({
  getTripWithBooked: vi.fn(async () => null),
  pagedUpcomingTripsWithCounts: vi.fn(async () => ({ trips: [] })),
}));
vi.mock("@/db/courses", () => ({
  listActiveCourses: vi.fn(),
  activeCourseAgencies: vi.fn(async () => ["padi", "ssi"]),
}));
vi.mock("@/lib/notifications", () => ({ publicAppUrl: () => "" }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({ locale: "en-US", t: diverTranslator("en-US") })),
}));

const { activeCourseAgencies, listActiveCourses } = await import("@/db/courses");
const { shopBySlugCached } = await import("@/db/shops-cached");
const { getShopReviewAggregate, listPublishedShopReviewsPage } = await import("@/db/reviews");
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
  learningMaterials: [],
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

/**
 * **The reviews widget** (K3): the shop's published archive, framed on its own
 * website. It quotes only what the public archive already shows, signed the
 * way the archive signs, and says nothing at all below the storefront shelf's
 * own threshold — a frame reading "no reviews yet" on a shop's homepage is a
 * warning the shop never asked DiveDay to publish.
 */
describe("the reviews widget", () => {
  const marta = {
    id: "review-1",
    rating: 5,
    comment: "Calm crew, and the turtle at the second site",
    isStandout: false,
    reviewer: "Marta R.",
    tripTitle: "Two-Tank Reef",
    divedAt: new Date("2026-09-20T13:00:00Z"),
    publishedAt: new Date("2026-09-21T13:00:00Z"),
    reply: null,
  };

  async function renderReviews() {
    const view = render(
      await EmbedWidgetPage({
        params: Promise.resolve({ shopSlug: "blue-mantis", widget: "reviews" }),
        searchParams: Promise.resolve({}),
      }),
    );
    return view;
  }

  it("quotes published reviews under the shop's rating, signed first name and initial", async () => {
    vi.mocked(getShopReviewAggregate).mockResolvedValue({
      count: 4,
      average: 4.5,
      suppressedCount: 0,
    });
    // The page is the widget's three quotes; `total` is every written review.
    vi.mocked(listPublishedShopReviewsPage).mockResolvedValue({
      reviews: [
        marta,
        ...[2, 3].map((n) => ({ ...marta, id: `review-${n}`, comment: `Quote ${n}` })),
      ],
      page: 1,
      pageCount: 2,
      pageSize: 3,
      total: 4,
    });
    await renderReviews();

    // Three quotes, then the archive.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    expect(screen.getByText("Calm crew, and the turtle at the second site")).toBeInTheDocument();
    expect(screen.getAllByText(/Marta R\./)[0]).toBeInTheDocument();
    expect(screen.getByText("4.5")).toBeInTheDocument();
    // Ratings and written reviews are two counts, the archive's own line.
    expect(screen.getByText("4 ratings · 4 reviews")).toBeInTheDocument();
    // The one way on leaves the frame for the archive.
    const all = screen.getByRole("link", { name: "All reviews" });
    expect(all).toHaveAttribute("href", "/s/blue-mantis/reviews");
    expect(all).toHaveAttribute("target", "_top");
    expect(listPublishedShopReviewsPage).toHaveBeenCalledWith({}, "shop-1", { limit: 3 });
  });

  it("renders nothing while the shop has no published rating", async () => {
    vi.mocked(getShopReviewAggregate).mockResolvedValue({
      count: 0,
      average: null,
      suppressedCount: 2,
    });
    vi.mocked(listPublishedShopReviewsPage).mockResolvedValue({
      reviews: [],
      page: 1,
      pageCount: 1,
      pageSize: 3,
      total: 0,
    });
    const { container } = await renderReviews();

    expect(container.textContent).toBe("");
    expect(screen.queryByRole("link", { name: "Bookings by DiveDay" })).toBeNull();
  });

  it("reads nothing from a shop that switched reviews off", async () => {
    vi.mocked(shopBySlugCached).mockResolvedValueOnce({
      ...shopRow,
      reviewsEnabled: false,
    } as never);
    vi.mocked(getShopReviewAggregate).mockClear();
    vi.mocked(listPublishedShopReviewsPage).mockClear();
    const { container } = await renderReviews();

    expect(container.textContent).toBe("");
    expect(getShopReviewAggregate).not.toHaveBeenCalled();
    expect(listPublishedShopReviewsPage).not.toHaveBeenCalled();
  });
});

/**
 * **The course the frame sells is the course the page sells** (third UX
 * review, items 22 and 25). The widget printed the fee alone ("$499") where
 * the course page charges fee and eLearning together ("$709"), and it listed
 * every agency's ladder flat, sixty cards on a shop's homepage.
 */
describe("the courses widget's catalog", () => {
  const course = (
    n: number,
    extra: Partial<typeof deepDiver & { eLearningPriceCents: number | null }> = {},
  ) => ({
    ...deepDiver,
    id: `course-${n}`,
    slug: `course-${n}`,
    title: `Course ${n}`,
    summary: null,
    durationText: null,
    eLearningPriceCents: null,
    ...extra,
  });

  async function renderCourses(rows: unknown[], show?: string) {
    vi.mocked(listActiveCourses)
      .mockReset()
      .mockResolvedValue(rows as never);
    render(
      await EmbedWidgetPage({
        params: Promise.resolve({ shopSlug: "blue-mantis", widget: "courses" }),
        searchParams: Promise.resolve(show ? { show } : {}),
      }),
    );
  }

  it.each(["courses", "grid"] as const)(
    "prices a course in the %s widget at fee plus eLearning, as the course page does",
    async (widget) => {
      vi.mocked(listActiveCourses)
        .mockReset()
        .mockResolvedValue([
          course(1, { title: "Open Water Diver", priceCents: 49_900, eLearningPriceCents: 21_000 }),
        ] as never);
      render(
        await EmbedWidgetPage({
          params: Promise.resolve({ shopSlug: "blue-mantis", widget }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(screen.getByText("$709")).toBeInTheDocument();
      expect(screen.queryByText("$499")).toBeNull();
    },
  );

  it("lists the agency the catalog opens on, not every agency", async () => {
    await renderCourses([course(1)]);

    expect(activeCourseAgencies).toHaveBeenCalled();
    expect(vi.mocked(listActiveCourses).mock.calls[0]?.[2]).toEqual({ agency: "padi" });
  });

  it("lists six, then hands over to the catalog", async () => {
    await renderCourses(Array.from({ length: 9 }, (_, i) => course(i + 1)));

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "All courses" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/courses",
    );
  });

  it("names no hand-over when the whole ladder fits", async () => {
    await renderCourses([course(1), course(2)]);

    expect(screen.queryByRole("link", { name: "All courses" })).toBeNull();
  });

  it("finds a named course in any agency", async () => {
    await renderCourses([course(1), course(2, { slug: "ssi-nitrox" })], "ssi-nitrox");

    expect(vi.mocked(listActiveCourses).mock.calls[0]?.[2]).toEqual({});
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

/**
 * **A full boat has no Book button** (visual review 2026-10-24, B32). The card
 * says "Full" in muted text and, when the shop keeps a wait list, one link
 * offers to tell the diver; the date reads as the trip page's, zone named
 * (B33).
 */
describe("the departure card", () => {
  const trip = (booked: number) => ({
    id: "trip-1",
    title: "Wreck Trip",
    isPrivate: false,
    startsAt: new Date("2026-10-29T16:00:00Z"),
    endsAt: new Date("2026-10-29T20:00:00Z"),
    diveSite: null,
    boatId: null,
    priceCents: 14_500,
    course: null,
    capacity: 10,
    sellableCapacity: 10,
    booked,
  });

  async function renderDeparture(booked: number, waitlistEnabled: boolean) {
    const { getTripWithBooked } = await import("@/db/trips");
    vi.mocked(getTripWithBooked).mockResolvedValueOnce(trip(booked) as never);
    vi.mocked(shopBySlugCached).mockResolvedValueOnce({ ...shopRow, waitlistEnabled } as never);
    render(
      await EmbedWidgetPage({
        params: Promise.resolve({ shopSlug: "blue-mantis", widget: "departure" }),
        searchParams: Promise.resolve({ show: "trip-1" }),
      }),
    );
  }

  it("offers Book while seats are open, with the trip page's date and zone", async () => {
    await renderDeparture(4, true);
    expect(screen.getByRole("link", { name: "Book" })).toBeInTheDocument();
    expect(screen.getByText("6 seats")).toBeInTheDocument();
    expect(screen.getByText("Thu, Oct 29 · 12:00 PM – 4:00 PM EDT")).toBeInTheDocument();
  });

  it("drops Book on a full boat and offers the wait list", async () => {
    await renderDeparture(10, true);
    expect(screen.queryByRole("link", { name: "Book" })).toBeNull();
    expect(screen.getByText("Full")).toHaveClass("text-muted");
    expect(screen.getByRole("link", { name: "Ask to be told" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/trips/trip-1#book",
    );
  });

  it("offers nothing to click on a full boat when the shop keeps no wait list", async () => {
    await renderDeparture(10, false);
    expect(screen.queryByRole("link", { name: "Book" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ask to be told" })).toBeNull();
  });
});
