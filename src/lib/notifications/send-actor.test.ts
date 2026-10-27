import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  auth: vi.fn(),
  authLoaded: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => {
  mocks.authLoaded();
  return { auth: mocks.auth };
});

describe("notification send actor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("does not load auth without a request", async () => {
    mocks.headers.mockRejectedValue(new Error("outside a request"));
    const { currentSendActor } = await import("./send-actor");
    expect(await currentSendActor()).toBeNull();
    expect(mocks.authLoaded).not.toHaveBeenCalled();
  });

  it("attributes an authenticated staff request only to its own shop", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.auth.mockResolvedValue({
      user: { personId: "person", shopId: "shop", roles: ["owner"] },
    });
    const { currentSendActor, sentByFor } = await import("./send-actor");
    const actor = await currentSendActor();
    expect(actor).toEqual({ personId: "person", shopId: "shop" });
    expect(sentByFor(actor, { shopId: "shop" })).toBe("person");
    expect(sentByFor(actor, { shopId: "another" })).toBeNull();
  });

  it("does not attribute a non-staff session", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.auth.mockResolvedValue({
      user: { personId: "person", shopId: "shop", roles: ["diver"] },
    });
    const { currentSendActor } = await import("./send-actor");
    expect(await currentSendActor()).toBeNull();
  });
});
