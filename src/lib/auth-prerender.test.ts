import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "./auth";

const request = vi.hoisted(() => ({
  connection: vi.fn<() => Promise<void>>(),
  headers: vi.fn(async () => new Headers()),
  getDb: vi.fn(async () => ({})),
  getSession: vi.fn(async () => null),
  nowMs: vi.fn(() => 1_800_000_000_000),
}));

vi.mock("next/server", () => ({ connection: request.connection }));
vi.mock("next/headers", () => ({ headers: request.headers }));
vi.mock("@/db/client", () => ({ getDb: request.getDb }));
vi.mock("better-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("better-auth")>()),
  betterAuth: () => ({ api: { getSession: request.getSession } }),
}));
vi.mock("./clock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./clock")>()),
  nowMs: request.nowMs,
}));

afterEach(() => vi.clearAllMocks());

describe("session request boundary (#2852)", () => {
  it("waits for a request before initializing auth or reading the session clock, even when auth is warm", async () => {
    for (let read = 0; read < 2; read++) {
      const boundary = Promise.withResolvers<void>();
      request.connection.mockReturnValueOnce(boundary.promise);
      const result = auth();
      // Let pre-boundary async work settle so an accidental early read is visible.
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(request.nowMs).toHaveBeenCalledTimes(read);
      expect(request.getDb).toHaveBeenCalledTimes(read === 0 ? 0 : 1);
      expect(request.headers).toHaveBeenCalledTimes(read);
      expect(request.getSession).toHaveBeenCalledTimes(read);
      expect(request.connection).toHaveBeenCalledTimes(read + 1);

      boundary.resolve();
      await expect(result).resolves.toBeNull();
      expect(request.nowMs).toHaveBeenCalledTimes(read + 1);
      expect(request.getSession).toHaveBeenCalledTimes(read + 1);
    }
    expect(request.getDb).toHaveBeenCalledTimes(1);
  });
});
