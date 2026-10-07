// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * The preview's links are built from the configured origin and never from the
 * request (security review): a Host-header origin is how a link gets pointed
 * at someone else's server. Without a valid configured origin there is no
 * preview, and nothing is read.
 */

vi.mock("@/lib/session", () => ({
  requireShopSurface: vi.fn(),
  isLiveShopStaff: vi.fn(async () => true),
}));
vi.mock("@/lib/notifications/app-url", () => ({ publicAppUrl: vi.fn(() => null) }));
vi.mock("@/db/weekly-digest", () => ({ previewWeeklyDigest: vi.fn() }));

const { requireShopSurface } = await import("@/lib/session");
const { previewWeeklyDigest } = await import("@/db/weekly-digest");
const { GET } = await import("./route");

describe("the Monday email preview", () => {
  it("refuses rather than linking to the request's own host when no origin is configured", async () => {
    vi.mocked(requireShopSurface).mockResolvedValue({
      db: {},
      shop: { id: "s", slug: "reef-life", name: "Reef Life", defaultLocale: "en-US" },
      session: { user: { personId: "p" } },
    } as never);

    const response = await GET(
      new Request("https://attacker.example/shop/reef-life/settings/email/preview"),
      { params: Promise.resolve({ shopSlug: "reef-life" }) },
    );

    expect(response.status).toBe(503);
    expect(previewWeeklyDigest).not.toHaveBeenCalled();
  });
});
