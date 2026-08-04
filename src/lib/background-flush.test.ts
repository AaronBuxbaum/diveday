import { afterEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_SYNC_TAG, requestBackgroundFlush } from "./background-flush";

/**
 * The contract that matters here is *never break the page*. Background Sync is
 * absent in Safari and Firefox and refusable in Chrome, so every failure path
 * must leave the existing page-driven triggers untouched rather than throwing
 * into a reconcile.
 */
function stubNavigator(value: unknown): void {
  vi.stubGlobal("navigator", value);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestBackgroundFlush", () => {
  it("registers the tag the worker listens for", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ serviceWorker: { ready: Promise.resolve({ sync: { register } }) } });

    await requestBackgroundFlush();

    // The one string both sides must agree on — a mismatch here is roll call
    // quietly never sending.
    expect(register).toHaveBeenCalledWith(MANIFEST_SYNC_TAG);
  });

  it("does nothing when the browser has no service worker at all", async () => {
    stubNavigator({});
    await expect(requestBackgroundFlush()).resolves.toBeUndefined();
  });

  it("does nothing when the registration has no sync — Safari and Firefox", async () => {
    // The property is simply absent there. This must be a quiet no-op, not a
    // TypeError inside a reconcile's catch block.
    stubNavigator({ serviceWorker: { ready: Promise.resolve({}) } });
    await expect(requestBackgroundFlush()).resolves.toBeUndefined();
  });

  it("swallows a refused registration", async () => {
    const register = vi.fn().mockRejectedValue(new Error("permission denied"));
    stubNavigator({ serviceWorker: { ready: Promise.resolve({ sync: { register } }) } });

    await expect(requestBackgroundFlush()).resolves.toBeUndefined();
  });

  it("swallows a service worker that never becomes ready", async () => {
    stubNavigator({ serviceWorker: { ready: Promise.reject(new Error("no worker")) } });
    await expect(requestBackgroundFlush()).resolves.toBeUndefined();
  });
});
