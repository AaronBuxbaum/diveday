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
          divePackagesEnabled: true,
        }
      : slug === "no-packages"
        ? { id: "shop-2", slug: "no-packages", defaultLocale: "en-US", divePackagesEnabled: false }
        : null,
  ),
}));
vi.mock("@/db/dive-packages", () => ({ listPackagesOnSale: vi.fn(async () => []) }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({ locale: "en-US", t: diverTranslator("en-US") })),
}));

vi.mock("./actions", () => ({ buyPackageAction: vi.fn() }));

const { listPackagesOnSale } = await import("@/db/dive-packages");
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

  it("is a 404 for a shop that switched dive packages off", async () => {
    await expect(
      PublicPackagesPage({ params: Promise.resolve({ shopSlug: "no-packages" }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

/**
 * **The page says what a package is** (third UX review, item 28): what it is
 * under the title, whether courses count, and whether it runs out, said either
 * way. "Fun dives only" left a diver to guess what it excluded.
 */
describe("the public packages page with a package on sale", () => {
  const card = {
    id: "pkg-1",
    name: "Five-dive card",
    priceCents: 40_000,
    diveCount: 5,
    scope: "fun_dives",
    validUntil: null,
  };

  async function renderOnSale(rows: unknown[]) {
    vi.mocked(listPackagesOnSale).mockResolvedValueOnce(rows as never);
    render(await PublicPackagesPage({ params: Promise.resolve({ shopSlug: "blue-mantis" }) }));
  }

  it("says what a package is, that courses are not included, and that it never runs out", async () => {
    await renderOnSale([card]);

    // One card, so what it covers is true of every card: said once, in the intro.
    expect(
      screen.getByText("Pay once, then book the dives as you go. Courses not included."),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain("No expiry date");
    // A dive is a tank, said where the money is decided (H-123).
    expect(document.body.textContent).toContain(
      "One dive is one tank, so a two-tank trip uses two",
    );
  });

  it("names the use-by date and courses when the shop sold them that way", async () => {
    await renderOnSale([{ ...card, scope: "all", validUntil: "2026-12-31" }]);

    expect(document.body.textContent).toContain("Courses included");
    expect(document.body.textContent).toMatch(/Use by Dec\s31,\s2026/);
    expect(document.body.textContent).not.toContain("No expiry date");
  });

  /**
   * Visual review 2026-10-24, B39: the card lists its facts one a line, and a
   * fact true of every card is said once, in the intro, never on each card.
   */
  it("lists each card's facts and lifts the shared scope into the intro", async () => {
    await renderOnSale([card, { ...card, id: "pkg-2", name: "Ten-dive card", diveCount: 10 }]);

    // One line per fact, inside the pill's label (phrasing content only).
    const facts = screen.getByText("5 dives").parentElement;
    expect([...(facts?.children ?? [])].map((i) => i.textContent)).toEqual([
      "5 dives",
      "$80 a dive",
      "No expiry date",
    ]);
    expect(screen.getByText("10 dives")).toBeInTheDocument();
    expect(document.body.textContent?.match(/Courses not included/g)).toHaveLength(1);
    expect(document.body.textContent?.match(/One dive is one tank/g)).toHaveLength(2);
  });

  it("keeps the scope on each card when the cards differ", async () => {
    await renderOnSale([card, { ...card, id: "pkg-2", scope: "all" }]);

    expect(screen.getByText("Pay once, then book the dives as you go.")).toBeInTheDocument();
    expect(screen.getByText("Courses not included")).toBeInTheDocument();
    expect(screen.getByText("Courses included")).toBeInTheDocument();
  });
});
