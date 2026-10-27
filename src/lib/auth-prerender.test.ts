import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "./auth";

const request = vi.hoisted(() => ({
  io: vi.fn<() => Promise<void>>(),
  connection: vi.fn(async () => {}),
  headers: vi.fn(async () => new Headers()),
  getDb: vi.fn(async () => ({})),
  // A real session exercises the idle clock after the prerender boundary.
  getSession: vi.fn(async () => ({ session: { lastHumanActivityAt: new Date(0) } })),
  nowMs: vi.fn(() => 1_800_000_000_000),
}));

vi.mock("next/server", () => ({ connection: request.connection }));
vi.mock("next/cache", () => ({ io: request.io }));
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

describe("session prerender boundary (#2852, #2854)", () => {
  it("suspends auth initialization and the session clock without blocking prefetches, even when auth is warm", async () => {
    for (let read = 0; read < 2; read++) {
      const boundary = Promise.withResolvers<void>();
      request.io.mockReturnValueOnce(boundary.promise);
      const result = auth();
      // Let pre-boundary async work settle so an accidental early read is visible.
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(request.nowMs).toHaveBeenCalledTimes(read);
      expect(request.getDb).toHaveBeenCalledTimes(read === 0 ? 0 : 1);
      expect(request.headers).toHaveBeenCalledTimes(read);
      expect(request.getSession).toHaveBeenCalledTimes(read);
      expect(request.io).toHaveBeenCalledTimes(read + 1);
      expect(request.connection).not.toHaveBeenCalled();

      boundary.resolve();
      await expect(result).resolves.toBeNull();
      expect(request.nowMs).toHaveBeenCalledTimes(read + 1);
      expect(request.getSession).toHaveBeenCalledTimes(read + 1);
    }
    expect(request.getDb).toHaveBeenCalledTimes(1);
  });
});
