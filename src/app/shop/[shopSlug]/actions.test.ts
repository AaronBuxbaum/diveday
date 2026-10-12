import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The shop home's actions, by the one that used to be an inline closure in
 * `page.tsx` and so could not be imported: "Got it" on the first-week
 * orientation (2026-10-11 review, item 34).
 */

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/db/user-accounts", () => ({ dismissOrientation: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { dismissOrientation } = await import("@/db/user-accounts");
const { revalidateAndRedirect } = await import("@/lib/navigation");
const { requireStaffSession } = await import("@/lib/session");
const { dismissOrientationAction } = await import("./actions");

afterEach(() => vi.clearAllMocks());

describe("dismissOrientationAction", () => {
  it("dismisses it for the session's own person and lands back on the home", async () => {
    vi.mocked(requireStaffSession).mockResolvedValue({
      user: { shopId: "shop-1", shopSlug: "blue-mantis", personId: "person-7" },
    } as never);

    await expect(dismissOrientationAction()).rejects.toThrow("REDIRECT:/shop/blue-mantis");
    expect(dismissOrientation).toHaveBeenCalledWith({ db: "handle" }, "person-7");
    expect(revalidateAndRedirect).toHaveBeenCalledWith("/shop/blue-mantis");
  });

  it("writes nothing for a caller with no staff session", async () => {
    vi.mocked(requireStaffSession).mockRejectedValue(new Error("REDIRECT:/sign-in"));

    await expect(dismissOrientationAction()).rejects.toThrow("REDIRECT:/sign-in");
    expect(dismissOrientation).not.toHaveBeenCalled();
  });
});
