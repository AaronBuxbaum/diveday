import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/lib/auth");
const { staffHomeSlug } = await import("./staff-home");

function signedIn(user: { shopSlug: string; roles: string[] } | null) {
  vi.mocked(auth).mockResolvedValue((user ? { user } : null) as never);
}

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Where the root 404 sends a staffer (UX audit 2026-10-07, item 13): their
 * own shop's Today, never the slug a refused URL claimed, and never anyone
 * who is not staff.
 */
describe("staffHomeSlug", () => {
  it("answers the staffer's own shop, not the one the URL named", async () => {
    signedIn({ shopSlug: "blue-mantis", roles: ["captain"] });
    expect(await staffHomeSlug("/shop/rival-reef/trips/123")).toBe("blue-mantis");
  });

  it("never reads the session for a URL outside /shop", async () => {
    signedIn({ shopSlug: "blue-mantis", roles: ["owner"] });
    expect(await staffHomeSlug("/s/blue-mantis/trips/nope")).toBeNull();
    expect(await staffHomeSlug("/waivers")).toBeNull();
    expect(await staffHomeSlug(null)).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it("answers nothing to a visitor with no session", async () => {
    signedIn(null);
    expect(await staffHomeSlug("/shop/blue-mantis/nope")).toBeNull();
  });

  it("answers nothing to a signed-in reader who is not staff", async () => {
    signedIn({ shopSlug: "blue-mantis", roles: ["diver"] });
    expect(await staffHomeSlug("/shop/blue-mantis/nope")).toBeNull();
  });

  it("answers nothing for a session slug outside the slug charset", async () => {
    signedIn({ shopSlug: "../evil", roles: ["owner"] });
    expect(await staffHomeSlug("/shop/blue-mantis/nope")).toBeNull();
  });
});
