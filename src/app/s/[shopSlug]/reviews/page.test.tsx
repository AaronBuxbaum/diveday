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
vi.mock("@/db/shops", () => ({
  shopBySlugCached: vi.fn(async () => ({
    id: "shop-1",
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    defaultLocale: "en-US",
    timezone: "America/Cancun",
    searchListingOptOutAt: null,
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

const { listPublishedShopReviewsPage } = await import("@/db/reviews");
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
