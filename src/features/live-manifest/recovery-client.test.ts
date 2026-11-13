// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as clock from "@/lib/clock";
import {
  beginLiveManifestShopRecovery,
  captureLiveManifestFence,
  invalidateLiveManifestSession,
  invalidateLiveManifestShop,
} from "./cache";
import { recoverLiveManifestShop } from "./recovery-client";

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});
let serial = 0;
let scope: { shop: string; trip: string; checkpoint: string; session: string };
beforeEach(() => {
  serial++;
  scope = {
    shop: `shop-${serial}`,
    trip: "trip",
    checkpoint: "departure",
    session: "a".repeat(43),
  };
});

const answer = (
  challenge: { tombstone: string; nonce: string },
  overrides: Record<string, unknown> = {},
) =>
  Response.json(
    {
      shopId: scope.shop,
      sessionHandle: scope.session,
      ...challenge,
      erasureEpoch: 7,
      issuedAt: 1000,
      expiresAt: 61000,
      proof: "b".repeat(43),
      ...overrides,
    },
    { headers: { "Cache-Control": "private, no-store", Date: new Date(1000).toUTCString() } },
  );

it("recovers only from an exact unredirected live response for the captured scope", async () => {
  await captureLiveManifestFence(scope);
  await invalidateLiveManifestShop(scope.shop);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => answer(JSON.parse(String(init.body)))),
  );
  expect(await recoverLiveManifestShop(scope)).toBe(true);
  expect(await captureLiveManifestFence(scope)).toBeDefined();
});

it("keeps the tombstone for a different session or challenge", async () => {
  await captureLiveManifestFence(scope);
  await invalidateLiveManifestShop(scope.shop);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) =>
      answer(JSON.parse(String(init.body)), { sessionHandle: "c".repeat(43) }),
    ),
  );
  expect(await recoverLiveManifestShop(scope)).toBe(false);
  await expect(captureLiveManifestFence(scope)).rejects.toThrow("live-manifest-cache-invalidated");
});

it("keeps the tombstone on an unrelated challenge or a failed network request", async () => {
  await captureLiveManifestFence(scope);
  await invalidateLiveManifestShop(scope.shop);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) =>
      answer(JSON.parse(String(init.body)), { nonce: "33333333-3333-4333-8333-333333333333" }),
    ),
  );
  expect(await recoverLiveManifestShop(scope)).toBe(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("network");
    }),
  );
  expect(await recoverLiveManifestShop(scope)).toBe(false);
  await expect(captureLiveManifestFence(scope)).rejects.toThrow("live-manifest-cache-invalidated");
});

it.each([
  ["Cache-Control", "private, not-no-store"],
  ["Content-Type", "application/jsonp"],
])("rejects invalid %s response headers", async (header, value) => {
  await captureLiveManifestFence(scope);
  await invalidateLiveManifestShop(scope.shop);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const response = answer(JSON.parse(String(init.body)));
      response.headers.set(header, value);
      return response;
    }),
  );
  expect(await recoverLiveManifestShop(scope)).toBe(false);
  await expect(captureLiveManifestFence(scope)).rejects.toThrow("live-manifest-cache-invalidated");
});

it("does not accept a response after the deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await captureLiveManifestFence(scope);
    await invalidateLiveManifestShop(scope.shop);
    let release!: (response: Response) => void;
    let seen!: { tombstone: string; nonce: string };
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        seen = JSON.parse(String(init.body));
        entered();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    const pending = recoverLiveManifestShop(scope);
    await started;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
    release(answer(seen));
    await Promise.resolve();
    await expect(captureLiveManifestFence(scope)).rejects.toThrow(
      "live-manifest-cache-invalidated",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a suspended request even if the timeout callback has not run", async () => {
  await captureLiveManifestFence(scope);
  await invalidateLiveManifestShop(scope.shop);
  const start = clock.nowMs();
  const clockSpy = vi.spyOn(clock, "nowMs").mockReturnValue(start);
  try {
    let release!: (response: Response) => void;
    let seen!: { tombstone: string; nonce: string };
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        seen = JSON.parse(String(init.body));
        entered();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    const pending = recoverLiveManifestShop(scope);
    await started;
    clockSpy.mockReturnValue(start + 10_001);
    release(answer(seen));
    expect(await pending).toBe(false);
    await expect(captureLiveManifestFence(scope)).rejects.toThrow(
      "live-manifest-cache-invalidated",
    );
  } finally {
    clockSpy.mockRestore();
  }
});

it("cancels a response body that never finishes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await captureLiveManifestFence(scope);
    await invalidateLiveManifestShop(scope.shop);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          pull() {
            entered();
          },
          cancel,
        });
        return new Response(stream, {
          status: 200,
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Type": "application/json",
            Date: new Date(1000).toUTCString(),
          },
        });
      }),
    );
    const pending = recoverLiveManifestShop(scope);
    await started;
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
    expect(cancel).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("does not recover if the session is invalidated while the response is in flight", async () => {
  await captureLiveManifestFence(scope);
  await invalidateLiveManifestShop(scope.shop);
  let release!: (response: Response) => void;
  let seen!: { tombstone: string; nonce: string };
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init) => {
      seen = JSON.parse(String(init.body));
      entered();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }),
  );
  const pending = recoverLiveManifestShop(scope);
  await started;
  await invalidateLiveManifestSession(scope.session);
  release(answer(seen));
  expect(await pending).toBe(false);
  await expect(beginLiveManifestShopRecovery(scope)).rejects.toThrow(
    "live-manifest-cache-invalidated",
  );
});
