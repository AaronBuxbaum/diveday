// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { redirectedTo, staffSession } from "@/test/staff-session";

/**
 * **"Add diver" from an empty search creates nobody.** The search box is the
 * whole form; with nothing in it there is no name, email or phone to make a
 * person from, and the roster says `invalid` rather than minting a blank row.
 */

vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/divers", () => ({ createDiver: vi.fn(), findLiveDiverIdByEmail: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { createDiver, findLiveDiverIdByEmail } = await import("@/db/divers");
const { requireStaffSession } = await import("@/lib/session");
const { createDiverFromSearchAction } = await import("./divers");

describe("createDiverFromSearchAction", () => {
  it.each([
    ["no query", null],
    ["a blank one", "   "],
  ])("refuses %s back on the roster", async (_label, query) => {
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: "11111111-1111-4111-8111-111111111111",
        shopSlug: "reef-life",
        personId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    const data = new FormData();
    if (query !== null) data.set("query", query);
    const roster = shopPath("reef-life", "divers");

    expect(await redirectedTo(() => createDiverFromSearchAction(data))).toBe(
      noticeUrl(roster, "invalid"),
    );
    expect(createDiver).not.toHaveBeenCalled();
  });

  it("takes the staffer to the diver who already owns a searched email", async () => {
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: "11111111-1111-4111-8111-111111111111",
        shopSlug: "reef-life",
        personId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    vi.mocked(createDiver).mockResolvedValue(null);
    vi.mocked(findLiveDiverIdByEmail).mockResolvedValue("33333333-3333-4333-8333-333333333333");
    const data = new FormData();
    data.set("query", "Taken@Example.com");

    expect(await redirectedTo(() => createDiverFromSearchAction(data))).toBe(
      `${shopPath("reef-life", "divers", "33333333-3333-4333-8333-333333333333")}?edit=1`,
    );
    expect(findLiveDiverIdByEmail).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      expect.stringMatching(/^taken@example\.com$/i),
    );
  });
});
