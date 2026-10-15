import { describe, expect, it, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    constructor(
      public readonly body: unknown,
      public readonly options: { headers?: Record<string, string> },
    ) {}
  },
}));

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getShopBySlug: vi.fn(),
  allowSvgRasterization: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/shops", () => ({ getShopBySlug: mocks.getShopBySlug }));
vi.mock("@/lib/og-rasterizer", () => ({ allowSvgRasterization: mocks.allowSvgRasterization }));

import ScheduleOpenGraphImage from "./opengraph-image";

type Card = { options: { headers?: Record<string, string> } };

describe("shop Open Graph image", () => {
  // Every crawler fetch read the shop, fetched its logo and rasterized, under
  // Next's default `max-age=0` (code review 2026-10-13b, item 27). The card
  // carries the shop's name and logo, which change rarely: an hour at the CDN,
  // a day stale while it refreshes.
  it("lets the CDN hold the shop's card for an hour", async () => {
    mocks.getDb.mockResolvedValue({});
    mocks.getShopBySlug.mockResolvedValue({ id: "shop-1", name: "Blue Mantis", logoUrl: null });
    const card = (await ScheduleOpenGraphImage({
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
    })) as unknown as Card;
    expect(card.options.headers?.["cache-control"]).toBe(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  it("holds the generic card for an unknown shop only as long as a trip card", async () => {
    // A slug nobody owns today may be a shop's tomorrow.
    mocks.getDb.mockResolvedValue({});
    mocks.getShopBySlug.mockResolvedValue(undefined);
    const card = (await ScheduleOpenGraphImage({
      params: Promise.resolve({ shopSlug: "nobody-yet" }),
    })) as unknown as Card;
    expect(card.options.headers?.["cache-control"]).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    );
  });
});
