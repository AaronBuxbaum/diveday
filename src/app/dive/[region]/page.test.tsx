// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * One town's page (issue #1436, N-49). The two refusals are the point of the
 * file: a `[region]` that is not a slug this app could have produced never
 * reaches the database, and a valid slug with nothing listed in it renders the
 * not-found page rather than a heading over an empty ledger. Both are the
 * *second* layer: the status line is decided above the streaming boundary in
 * `src/proxy.ts` (issue #1734), which applies the same shape test and asks the
 * same scoped question, so nothing asserted here is what a crawler reads. What
 * this file pins is that the page still refuses on its own — the edge fails
 * open on a database outage, and a page that stopped agreeing with it would
 * either 404 a town the edge served or put a heading over nothing. The status
 * itself is asserted in `e2e/marketing.spec.ts`.
 */

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/app/_components/MarketingNav", () => ({
  MarketingNav: () => null,
  MarketingNavFallback: () => null,
}));
vi.mock("@/components/MarketingFooter", () => ({
  MarketingFooter: () => null,
  MarketingFooterFallback: () => null,
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/regions", () => ({ listRegionShops: vi.fn() }));
vi.mock("@/lib/notifications/app-url", () => ({ publicAppUrl: () => "https://dive.day" }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({
    locale: "en-US",
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  })),
}));

const { listRegionShops } = await import("@/db/regions");
const { default: RegionPage } = await import("./page");

const SHOP = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Reef Line Divers",
  slug: "reef-line-divers",
  tagline: "Two tanks on the outer reef, every morning.",
  description: null,
  logoUrl: null,
  contactEmail: "desk@reefline.invalid",
  contactPhone: null,
  currency: "usd",
  addressStreet: "88 Marina Way",
  addressLocality: "Key Largo",
  addressRegion: "FL",
  addressPostalCode: "33037",
  addressCountry: "US",
};

const OTHER_SHOP = {
  ...SHOP,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Keys Current Charters",
  slug: "keys-current-charters",
  tagline: null,
};

const params = (region: string) => ({ params: Promise.resolve({ region }) });

afterEach(cleanup);

describe("one town's dive shops", () => {
  it("lists each shop as a link to its own storefront, with only what the shop wrote", async () => {
    vi.mocked(listRegionShops).mockResolvedValue([SHOP, OTHER_SHOP] as never);

    render(await RegionPage(params("key-largo")));

    expect(
      screen.getByRole("heading", { level: 1, name: 'regions.region.title:{"name":"Key Largo"}' }),
    ).toBeInTheDocument();
    const reefLine = screen.getByRole("link", { name: /Reef Line Divers/ });
    expect(reefLine).toHaveAttribute("href", "/s/reef-line-divers");
    expect(reefLine).toHaveTextContent("Two tanks on the outer reef, every morning.");
    // A shop that has written no tagline gets a shorter row, never filler.
    expect(screen.getByRole("link", { name: /Keys Current Charters/ })).toHaveTextContent(
      /^Keys Current Charters$/,
    );
    // The way back up is the index, not a second strip of chrome.
    expect(screen.getByRole("link", { name: "regions.index.title" })).toHaveAttribute(
      "href",
      "/dive",
    );
  });

  it("publishes the town's shops as an ItemList of dive operators", async () => {
    vi.mocked(listRegionShops).mockResolvedValue([SHOP, OTHER_SHOP] as never);

    const { container } = render(await RegionPage(params("key-largo")));

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const graph = JSON.parse(script?.textContent ?? "{}");
    expect(graph["@type"]).toBe("ItemList");
    expect(graph.numberOfItems).toBe(2);
    expect(graph.itemListElement[0].item).toMatchObject({
      "@type": "SportsActivityLocation",
      name: "Reef Line Divers",
      url: "https://dive.day/s/reef-line-divers",
    });
  });

  it("refuses a segment that is not a slug before it queries anything", async () => {
    vi.mocked(listRegionShops).mockResolvedValue([SHOP] as never);

    for (const segment of ["Key Largo", "key_largo", "-key-largo", "a".repeat(65)]) {
      await expect(RegionPage(params(segment))).rejects.toThrow("NOT_FOUND");
    }
    expect(listRegionShops).not.toHaveBeenCalled();
  });

  it("refuses a valid slug that no listed shop is in, rather than publishing an empty town", async () => {
    vi.mocked(listRegionShops).mockResolvedValue([] as never);

    await expect(RegionPage(params("atlantis"))).rejects.toThrow("NOT_FOUND");
  });

  it("refuses a town none of its shops can name", async () => {
    // Unreachable while `shops.region_slug` is derived from the locality, and
    // still a 404 rather than a heading made of the slug — the same call
    // `listRegions` makes when it drops a nameless region from the index.
    vi.mocked(listRegionShops).mockResolvedValue([{ ...SHOP, addressLocality: null }] as never);

    await expect(RegionPage(params("key-largo"))).rejects.toThrow("NOT_FOUND");
  });
});
