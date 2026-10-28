import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getShopYear: vi.fn(), render: vi.fn() }));
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown) {
      super("image", { headers: { "Content-Type": "image/png" } });
      mocks.render(element);
    }
  },
}));
vi.mock("@/db/reporting", () => ({
  canPersonViewShopReports: vi.fn(),
  getShopYear: mocks.getShopYear,
}));
vi.mock("@/lib/session", () => ({
  requireShopSurface: vi.fn(async () => ({
    db: {},
    shop: {
      id: "shop",
      timezone: "UTC",
      seasonStartMonth: 1,
      seasonStartDay: 1,
      name: "Blue Mantis",
      defaultLocale: "en-US",
      brandColor: null,
    },
  })),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));
vi.mock("@/lib/og-rasterizer", () => ({ allowSvgRasterization: async () => {} }));

import { GET } from "./route";

beforeEach(() => {
  mocks.getShopYear.mockReset();
  mocks.render.mockReset();
  mocks.getShopYear.mockResolvedValue({
    year: 2025,
    startsOn: "2025-02-01",
    endsOn: "2025-02-28",
    firstDay: "2025-02-01",
    lastDay: "2025-02-28",
    openedThisYear: false,
    today: "2026-10-26",
    divers: 3,
    monthDivers: [{ month: "2025-02", divers: 3 }],
    days: [{ day: "2025-02-12", boats: 1, divers: 3, aboard: 3, seats: 6 }],
    boats: [],
    sites: [],
  });
});

describe("report card", () => {
  it("reads exactly the selected month and labels the card with that month", async () => {
    const response = await GET(new Request("http://localhost/card?month=2025-02"), {
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.getShopYear).toHaveBeenCalledWith(
      expect.anything(),
      "shop",
      expect.objectContaining({
        startsOn: "2025-02-01",
        endsOn: "2025-02-28",
      }),
    );
    expect(mocks.render.mock.calls[0]?.[0].props.copy.range).toBe("February 2025");
  });

  it("rejects an invalid month instead of silently printing a year", async () => {
    const response = await GET(new Request("http://localhost/card?month=2025-13"), {
      params: Promise.resolve({ shopSlug: "blue-mantis" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.getShopYear).not.toHaveBeenCalled();
  });
});
