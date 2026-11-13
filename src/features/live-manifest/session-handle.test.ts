import { describe, expect, it, vi } from "vitest";
import { liveManifestSessionHandle } from "./session-handle";

describe("live manifest session handle", () => {
  it("is opaque, stable for a session and separated by shop and session", () => {
    const handle = liveManifestSessionHandle("shop-a", "secret-session-a");
    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handle).not.toContain("secret-session-a");
    expect(liveManifestSessionHandle("shop-a", "secret-session-a")).toBe(handle);
    expect(liveManifestSessionHandle("shop-b", "secret-session-a")).not.toBe(handle);
    expect(liveManifestSessionHandle("shop-a", "secret-session-b")).not.toBe(handle);
  });

  it("refuses missing identifiers", () => {
    expect(liveManifestSessionHandle("", "session")).toBeNull();
    expect(liveManifestSessionHandle("shop", "")).toBeNull();
    expect(liveManifestSessionHandle("x".repeat(129), "session")).toBeNull();
    expect(liveManifestSessionHandle("shop", "x".repeat(513))).toBeNull();
  });

  it("fails closed without a server secret", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth-secret", () => ({ authSecret: undefined }));
    try {
      const { liveManifestSessionHandle: withoutSecret } = await import("./session-handle");
      expect(withoutSecret("shop", "session")).toBeNull();
    } finally {
      vi.doUnmock("@/lib/auth-secret");
      vi.resetModules();
    }
  });
});
