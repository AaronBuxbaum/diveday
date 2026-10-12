// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The rehearsal banner (ADR 20261012-rehearsal-departures): it says when the
 * departure will be deleted, and a rehearsal that carries real evidence says
 * instead that it stays.
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops-cached", () => ({
  shopBySlugCached: vi.fn(async () => ({ id: "shop-1", defaultLocale: "en-US" })),
}));
vi.mock("@/db/rehearsals", () => ({
  isRehearsalTrip: vi.fn(async () => true),
  rehearsalsWithEvidence: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));

const { isRehearsalTrip, rehearsalsWithEvidence } = await import("@/db/rehearsals");
const { RehearsalBanner } = await import("./RehearsalBanner");

const TRIP = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

async function renderBanner() {
  const banner = await RehearsalBanner({ shopSlug: "blue-mantis", tripId: TRIP });
  const { container } = render(<div>{banner}</div>);
  return container;
}

describe("RehearsalBanner", () => {
  it("names the rehearsal and how long it stays", async () => {
    await renderBanner();
    const banner = screen.getByRole("region", { name: "Practice departure for training day" });
    expect(banner.textContent).toContain("It is deleted 3 days after it comes home");
    expect(banner.querySelector("[data-rehearsal-kept]")).toBeNull();
  });

  it("says a rehearsal with a roll call is kept", async () => {
    vi.mocked(rehearsalsWithEvidence).mockResolvedValueOnce(new Set([TRIP]));
    await renderBanner();
    expect(screen.getByRole("region").textContent).toContain(
      "This rehearsal has a roll call or a logged dive, so it is not deleted on its own.",
    );
  });

  it("renders nothing for an ordinary departure", async () => {
    vi.mocked(isRehearsalTrip).mockResolvedValueOnce(false);
    const container = await renderBanner();
    expect(container.querySelector("[data-rehearsal-banner]")).toBeNull();
  });
});
