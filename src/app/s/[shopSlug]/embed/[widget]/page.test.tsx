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
  listPublishedShopReviews: vi.fn(),
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
const { shopBySlugCached } = await import("@/db/shops-cached");
const { getShopReviewAggregate, listPublishedShopReviews } = await import("@/db/reviews");
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
    vi.mocked(listPublishedShopReviews).mockResolvedValue([
      marta,
      ...[2, 3, 4].map((n) => ({ ...marta, id: `review-${n}`, comment: `Quote ${n}` })),
    ]);
    await renderReviews();

    // Three quotes, then the archive.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Quote 4")).toBeNull();

    expect(screen.getByText("Calm crew, and the turtle at the second site")).toBeInTheDocument();
    expect(screen.getAllByText(/Marta R\./)[0]).toBeInTheDocument();
    expect(screen.getByText("4.5")).toBeInTheDocument();
    expect(screen.getByText("4 reviews")).toBeInTheDocument();
    // The one way on leaves the frame for the archive.
    const all = screen.getByRole("link", { name: "All reviews" });
    expect(all).toHaveAttribute("href", "/s/blue-mantis/reviews");
    expect(all).toHaveAttribute("target", "_top");
    expect(listPublishedShopReviews).toHaveBeenCalledWith({}, "shop-1");
  });

  it("renders nothing while the shop has no published rating", async () => {
    vi.mocked(getShopReviewAggregate).mockResolvedValue({
      count: 0,
      average: null,
      suppressedCount: 2,
    });
    vi.mocked(listPublishedShopReviews).mockResolvedValue([]);
    const { container } = await renderReviews();

    expect(container.textContent).toBe("");
    expect(screen.queryByRole("link", { name: "Powered by DiveDay" })).toBeNull();
  });

  it("reads nothing from a shop that switched reviews off", async () => {
    vi.mocked(shopBySlugCached).mockResolvedValueOnce({
      ...shopRow,
      reviewsEnabled: false,
    } as never);
    vi.mocked(getShopReviewAggregate).mockClear();
    vi.mocked(listPublishedShopReviews).mockClear();
    const { container } = await renderReviews();

    expect(container.textContent).toBe("");
    expect(getShopReviewAggregate).not.toHaveBeenCalled();
    expect(listPublishedShopReviews).not.toHaveBeenCalled();
  });
});
