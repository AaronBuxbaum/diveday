// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";

/**
 * `?show=` names a departure on a shop's own website. A truncated or
 * hand-typed id names no trip, so the frame is a 404 and the database is
 * never asked: a `uuid` column raises on a malformed literal, which is a 500.
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("../../../../../features/platform/shops-cached", () => ({
  shopBySlugCached: vi.fn(async () => ({
    id: "shop-1",
    slug: "blue-mantis",
    defaultLocale: "en-US",
    currency: "USD",
    timezone: "America/New_York",
    depthUnit: "feet",
    embedsEnabled: true,
    coursesEnabled: true,
  })),
}));
vi.mock("../../../../../features/crew-and-boats/boats/store", () => ({
  listBoats: vi.fn(async () => []),
}));
vi.mock("@/db/trips", () => ({
  getTripWithBooked: vi.fn(async () => {
    throw new Error("invalid input syntax for type uuid");
  }),
  pagedUpcomingTripsWithCounts: vi.fn(async () => ({ trips: [] })),
}));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({ locale: "en-US", t: diverTranslator("en-US") })),
}));
vi.mock("@/lib/notifications", () => ({ publicAppUrl: () => "" }));

const { getTripWithBooked } = await import("@/db/trips");
const { default: EmbedWidgetPage } = await import("./page");

describe("the departure widget's ?show=", () => {
  it("is a 404, not a database error, when it is not an id", async () => {
    await expect(
      EmbedWidgetPage({
        params: Promise.resolve({ shopSlug: "blue-mantis", widget: "departure" }),
        searchParams: Promise.resolve({ show: "trip-1" }),
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
    expect(getTripWithBooked).not.toHaveBeenCalled();
  });
});
