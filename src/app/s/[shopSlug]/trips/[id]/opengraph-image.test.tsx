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
});
