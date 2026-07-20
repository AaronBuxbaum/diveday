import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn<(path: string) => void>(),
  redirect: vi.fn<(url: string) => never>(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { revalidateAndRedirect } from "./navigation";

describe("revalidateAndRedirect", () => {
  it("revalidates the mutated route before redirecting, so the write is visible immediately", () => {
    const calls: string[] = [];
    mocks.revalidatePath.mockImplementation(() => {
      calls.push("revalidate");
    });
    mocks.redirect.mockImplementation((url) => {
      calls.push("redirect");
      // `redirect` unwinds the action by throwing; the real one does too.
      throw new Error(`NEXT_REDIRECT:${url}`);
    });

    expect(() => revalidateAndRedirect("/shop/x/trips/1", "/shop/x/trips/1?notice=crew")).toThrow(
      "NEXT_REDIRECT:/shop/x/trips/1?notice=crew",
    );

    // Ordering is the whole point: revalidatePath must run before redirect,
    // because redirect throws and would otherwise skip the cache invalidation.
    expect(calls).toEqual(["revalidate", "redirect"]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/shop/x/trips/1");
  });

  it("defaults the redirect destination to the revalidated path", () => {
    mocks.revalidatePath.mockReset().mockImplementation(() => {});
    mocks.redirect.mockReset().mockImplementation((url) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });

    expect(() => revalidateAndRedirect("/shop/x/divers")).toThrow("NEXT_REDIRECT:/shop/x/divers");
    expect(mocks.redirect).toHaveBeenCalledWith("/shop/x/divers");
  });
});
