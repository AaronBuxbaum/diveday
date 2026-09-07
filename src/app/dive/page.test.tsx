// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The regional index's own behaviour (issue #1436, N-49): every region
 * `listRegions` returns becomes a row linking to its town, the count beside
 * each one goes through the ICU plural, and an app with no listed shop
 * anywhere renders the empty state rather than a bare heading over nothing.
 */

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
vi.mock("@/db/regions", () => ({ listRegions: vi.fn() }));
vi.mock("@/i18n/request", () => ({
  requestTranslator: vi.fn(async () => ({
    locale: "en-US",
    // The key plus whatever was interpolated into it — enough to prove the
    // count reaches the message rather than being spelled at the call site.
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  })),
}));

const { listRegions } = await import("@/db/regions");
const { default: RegionsPage } = await import("./page");

afterEach(cleanup);

describe("the regional index", () => {
  it("lists every region as a link to its town, with its shop count", async () => {
    vi.mocked(listRegions).mockResolvedValue([
      { slug: "key-largo", name: "Key Largo", shopCount: 2 },
      { slug: "cozumel", name: "Cozumel", shopCount: 1 },
    ]);

    render(await RegionsPage());

    const keyLargo = screen.getByRole("link", { name: /Key Largo/ });
    expect(keyLargo).toHaveAttribute("href", "/dive/key-largo");
    expect(keyLargo).toHaveTextContent('regions.index.shopCount:{"count":2}');
    expect(screen.getByRole("link", { name: /Cozumel/ })).toHaveAttribute("href", "/dive/cozumel");
    // The order the reader sees is the order the reader was given — most
    // shops first, which is `listRegions`' own ordering, never re-sorted here.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Key Largo",
      "Cozumel",
    ]);
  });

  it("teaches rather than showing an empty ledger when no shop is listed anywhere", async () => {
    vi.mocked(listRegions).mockResolvedValue([]);

    render(await RegionsPage());

    expect(screen.getByText("regions.index.emptyTitle")).toBeInTheDocument();
    expect(screen.getByText("regions.index.emptyBody")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dive/ })).not.toBeInTheDocument();
  });
});
