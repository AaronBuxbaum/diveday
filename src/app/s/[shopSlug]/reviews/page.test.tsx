// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";

/**
 * The public reviews archive pages with the shared `Pager`, in the diver's
 * words. It used to hand-copy the staff pager's old `justify-between` row,
 * with an empty `<span>` standing in for whichever link a page lacks: the
 * shape that put the staff readout 28px off centre.
 */

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops-cached", () => ({
  shopBySlugCached: vi.fn(async () => ({
    id: "shop-1",
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    defaultLocale: "en-US",
    timezone: "America/Cancun",
    searchListingOptOutAt: null,
    reviewsEnabled: true,
  })),
}));
vi.mock("@/db/reviews", () => ({
  getShopReviewAggregate: vi.fn(async () => ({ average: null, count: 0 })),
  getShopRatingDistribution: vi.fn(async () => new Map()),
  listPublishedShopReviewsPage: vi.fn(),
}));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({ locale: "en-US", t: diverTranslator("en-US") })),
}));

const { getShopRatingDistribution, getShopReviewAggregate, listPublishedShopReviewsPage } =
  await import("@/db/reviews");
const { shopBySlugCached } = await import("@/db/shops-cached");
const { default: PublicReviewsPage } = await import("./page");

afterEach(cleanup);

async function renderPage(page: number, pageCount: number) {
  vi.mocked(listPublishedShopReviewsPage).mockResolvedValue({
    reviews: [],
    page,
    pageCount,
    pageSize: 20,
    total: pageCount * 20,
  } as never);
  render(
    await PublicReviewsPage({
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
      searchParams: Promise.resolve({ page: String(page) }),
    }),
  );
  return screen.getByRole("navigation", { name: "Review pages" });
}

describe("the public reviews archive's pager", () => {
  it("is the shared Pager in the diver's words: no empty stand-in, the readout on its own row below sm", async () => {
    const nav = await renderPage(1, 3);

    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/reviews?page=2",
    );
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(nav.querySelectorAll(":scope > :empty")).toHaveLength(0);
    expect(screen.getByText("Page 1 of 3")).toHaveClass("col-span-2", "sm:col-start-2");
  });

  it("goes back to the archive's own first page without a query string", async () => {
    await renderPage(2, 3);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/reviews",
    );
  });

  it("draws no pager on an archive of one page", async () => {
    vi.mocked(listPublishedShopReviewsPage).mockResolvedValue({
      reviews: [],
      page: 1,
      pageCount: 1,
      pageSize: 20,
      total: 3,
    } as never);
    render(
      await PublicReviewsPage({
        params: Promise.resolve({ shopSlug: "blue-mantis" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.queryByRole("navigation", { name: "Review pages" })).toBeNull();
  });
});

describe("a shop that switched reviews off", () => {
  it("has no archive at all", async () => {
    vi.mocked(shopBySlugCached).mockResolvedValueOnce({
      id: "shop-1",
      slug: "blue-mantis",
      name: "Blue Mantis Divers",
      defaultLocale: "en-US",
      timezone: "America/Cancun",
      searchListingOptOutAt: null,
      reviewsEnabled: false,
    } as never);
    await expect(renderPage(1, 1)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

/**
 * **A distribution with empty bars reads as fabricated** (UX review
 * 2026-10-10, item 17): "83 reviews" over three zero bars and four written
 * reviews. A bar shows once it has a count, and the line names ratings and
 * written reviews apart.
 */
describe("the rating summary", () => {
  async function renderSummary(written: number) {
    vi.mocked(getShopReviewAggregate).mockResolvedValueOnce({ average: 4.3, count: 83 } as never);
    vi.mocked(getShopRatingDistribution).mockResolvedValueOnce(
      new Map([
        [5, 28],
        [4, 54],
        [3, 1],
      ]),
    );
    vi.mocked(listPublishedShopReviewsPage).mockResolvedValue({
      reviews: [],
      page: 1,
      pageCount: 1,
      pageSize: 20,
      total: written,
    } as never);
    render(
      await PublicReviewsPage({
        params: Promise.resolve({ shopSlug: "blue-mantis" }),
        searchParams: Promise.resolve({}),
      }),
    );
  }

  it("draws a bar only for a star count somebody gave", async () => {
    await renderSummary(4);
    expect(screen.getByText("5 out of 5 stars")).toBeInTheDocument();
    expect(screen.getByText("3 out of 5 stars")).toBeInTheDocument();
    expect(screen.queryByText("2 out of 5 stars")).toBeNull();
    expect(screen.queryByText("1 out of 5 stars")).toBeNull();
  });

  it("counts ratings and written reviews apart", async () => {
    await renderSummary(4);
    expect(screen.getByText("83 ratings · 4 reviews")).toBeInTheDocument();
    expect(screen.queryByText("83 reviews")).toBeNull();
  });

  it("says ratings alone when nobody wrote anything", async () => {
    await renderSummary(0);
    expect(screen.getByText("83 ratings")).toBeInTheDocument();
  });
});
