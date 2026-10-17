import { describe, expect, it, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    constructor(
      public readonly body: unknown,
      public readonly options: unknown,
    ) {}
  },
}));

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getShopBySlug: vi.fn(),
  getTripWithBooked: vi.fn(),
  allowSvgRasterization: vi.fn(),
}));

vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/shops", () => ({ getShopBySlug: mocks.getShopBySlug }));
vi.mock("@/db/trips", () => ({ getTripWithBooked: mocks.getTripWithBooked }));
vi.mock("@/lib/og-rasterizer", () => ({ allowSvgRasterization: mocks.allowSvgRasterization }));

import TripOpenGraphImage from "./opengraph-image";

describe("trip Open Graph image", () => {
  it("returns a generic card without querying Postgres for a malformed trip id", async () => {
    const response = await TripOpenGraphImage({
      params: Promise.resolve({ shopSlug: "blue-mantis", id: "not-a-uuid" }),
    });

    expect(response).toBeDefined();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getShopBySlug).not.toHaveBeenCalled();
    expect(mocks.getTripWithBooked).not.toHaveBeenCalled();
    expect(mocks.allowSvgRasterization).not.toHaveBeenCalled();
  });

  // Each crawler fetch read the shop, the trip with its booked list, and
  // rasterized, under Next's default `max-age=0` (code review 2026-10-13b,
  // item 27). The card carries a seat count, so it is held as long as
  // availability.json holds its own: five minutes at the CDN.
  it("lets the CDN hold the card as long as the seat counts it shows", async () => {
    mocks.getDb.mockResolvedValue({});
    mocks.getShopBySlug.mockResolvedValue({
      id: "shop-1",
      name: "Blue Mantis",
      logoUrl: null,
      defaultLocale: "en-US",
      timezone: "Pacific/Guam",
      currency: "USD",
    });
    mocks.getTripWithBooked.mockResolvedValue(undefined);
    const generic = (await TripOpenGraphImage({
      params: Promise.resolve({ shopSlug: "blue-mantis", id: "not-a-uuid" }),
    })) as unknown as { options: { headers: Record<string, string> } };
    expect(generic.options.headers["cache-control"]).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    );
    const missing = (await TripOpenGraphImage({
      params: Promise.resolve({
        shopSlug: "blue-mantis",
        id: "7b0a3c3e-5d2f-4a8e-9c1d-2e3f4a5b6c7d",
      }),
    })) as unknown as { options: { headers: Record<string, string> } };
    expect(missing.options.headers["cache-control"]).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    );
  });
});
