import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { requireStaffSession } = await import("@/lib/session");
const { movedPageRedirect } = await import("./moved-page-redirect");

describe("movedPageRedirect", () => {
  it("answers a 308 to the new address and keeps the query", async () => {
    const response = await movedPageRedirect(
      new Request("https://diveday.test/shop/blue-mantis/settings/boats?notice=boat-created"),
      "blue-mantis",
      "boats",
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("/shop/blue-mantis/boats?notice=boat-created");
  });

  it("re-checks the session before answering", async () => {
    vi.mocked(requireStaffSession).mockRejectedValueOnce(new Error("REDIRECT:/sign-in"));
    await expect(
      movedPageRedirect(new Request("https://diveday.test/x"), "blue-mantis", "boats"),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("encodes a slug that tries to leave the shop", async () => {
    const response = await movedPageRedirect(
      new Request("https://diveday.test/x"),
      "../evil",
      "boats",
    );
    expect(response.headers.get("Location")).toBe("/shop/..%2Fevil/boats");
  });
});
