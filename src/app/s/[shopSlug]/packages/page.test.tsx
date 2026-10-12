// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";

/**
 * **A shop with nothing on sale answers the URL** (UX review 2026-10-10, item
 * 18). `/s/<shop>/packages` used to be a 404 whenever no package was on sale,
 * so a link a diver was sent, or one that just sold out, read as broken.
 */

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops-cached", () => ({
  shopBySlugCached: vi.fn(async (slug: string) =>
    slug === "blue-mantis"
      ? {
          id: "shop-1",
          slug: "blue-mantis",
          name: "Blue Mantis Divers",
          defaultLocale: "en-US",
          timezone: "America/New_York",
          currency: "usd",
          searchListingOptOutAt: null,
        }
      : null,
  ),
}));
vi.mock("@/db/dive-packages", () => ({ listPackagesOnSale: vi.fn(async () => []) }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({ locale: "en-US", t: diverTranslator("en-US") })),
}));

const { default: PublicPackagesPage } = await import("./page");

afterEach(cleanup);

describe("the public packages page with nothing on sale", () => {
  it("says so quietly and opens a door to the schedule", async () => {
    render(await PublicPackagesPage({ params: Promise.resolve({ shopSlug: "blue-mantis" }) }));
    expect(screen.getByRole("heading", { name: "No packages right now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the schedule" })).toHaveAttribute(
      "href",
      "/s/blue-mantis",
    );
  });

  it("is still a 404 for a shop that does not exist", async () => {
    await expect(
      PublicPackagesPage({ params: Promise.resolve({ shopSlug: "nobody" }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
