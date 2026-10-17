import { describe, expect, it, vi } from "vitest";
import { deferSentry, type SentryBrowserSdk } from "./sentry-browser";

/**
 * **The browser SDK arrives on idle, and nothing thrown before it is lost**
 * (code review 2026-10-13b, item 34). The SDK was about 55 to 60 KB of the
 * shared first-load floor, paid by every route before it painted, for a
 * reporter whose only job before the first idle moment is to remember.
 */
function harness() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const target = {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  const fire = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  let idle: (() => void) | undefined;
  const whenIdle = (run: () => void) => {
    idle = run;
  };
  const sdk = {
    init: vi.fn(),
    captureException: vi.fn(),
    captureRouterTransitionStart: vi.fn(),
  } satisfies SentryBrowserSdk;
  return {
    target,
    fire,
    listeners,
    sdk,
    whenIdle,
    idle: () => idle?.(),
    runIdle: async () => {
      idle?.();
      await vi.waitFor(() => expect(sdk.init).toHaveBeenCalled());
    },
  };
}

describe("deferSentry", () => {
  it("does not load the SDK until the page is idle", () => {
    const h = harness();
    const load = vi.fn(async () => h.sdk);
    deferSentry({ load, init: (sdk) => sdk.init({}), target: h.target, whenIdle: h.whenIdle });
    expect(load).not.toHaveBeenCalled();
  });

  it("reports an error thrown before the SDK arrived, as unhandled", async () => {
    const h = harness();
    deferSentry({
      load: async () => h.sdk,
      init: (sdk) => sdk.init({}),
      target: h.target,
      whenIdle: h.whenIdle,
    });
    const thrown = new Error("boom");
    h.fire("error", { error: thrown, message: "boom" });
    const rejected = new Error("nope");
    h.fire("unhandledrejection", { reason: rejected });
    await h.runIdle();
    expect(h.sdk.captureException).toHaveBeenCalledWith(thrown, {
      mechanism: { type: "onerror", handled: false },
    });
    expect(h.sdk.captureException).toHaveBeenCalledWith(rejected, {
      mechanism: { type: "onunhandledrejection", handled: false },
    });
  });

  it("initialises before it replays, and stops buffering once the SDK listens itself", async () => {
    const h = harness();
    const order: string[] = [];
    h.sdk.init.mockImplementation(() => order.push("init"));
    h.sdk.captureException.mockImplementation(() => order.push("capture"));
    deferSentry({
      load: async () => h.sdk,
      init: (sdk) => sdk.init({}),
      target: h.target,
      whenIdle: h.whenIdle,
    });
    h.fire("error", { error: new Error("early") });
    await h.runIdle();
    expect(order).toEqual(["init", "capture"]);
    expect(h.listeners.get("error")?.size ?? 0).toBe(0);
    expect(h.listeners.get("unhandledrejection")?.size ?? 0).toBe(0);
    // An error after the SDK arrived is the SDK's own to catch, not replayed twice.
    h.fire("error", { error: new Error("late") });
    expect(h.sdk.captureException).toHaveBeenCalledTimes(1);
  });

  it("keeps a bounded number of early errors", async () => {
    const h = harness();
    deferSentry({
      load: async () => h.sdk,
      init: (sdk) => sdk.init({}),
      target: h.target,
      whenIdle: h.whenIdle,
    });
    for (let index = 0; index < 50; index += 1) h.fire("error", { error: new Error(`${index}`) });
    await h.runIdle();
    expect(h.sdk.captureException).toHaveBeenCalledTimes(20);
  });

  it("forwards a navigation only once the SDK is there", async () => {
    const h = harness();
    const deferred = deferSentry({
      load: async () => h.sdk,
      init: (sdk) => sdk.init({}),
      target: h.target,
      whenIdle: h.whenIdle,
    });
    deferred.onRouterTransitionStart("/s/blue-mantis", "push");
    expect(h.sdk.captureRouterTransitionStart).not.toHaveBeenCalled();
    await h.runIdle();
    deferred.onRouterTransitionStart("/s/blue-mantis/trips", "push");
    expect(h.sdk.captureRouterTransitionStart).toHaveBeenCalledWith("/s/blue-mantis/trips", "push");
  });

  it("lets go of the page when the SDK fails to load", async () => {
    const h = harness();
    deferSentry({
      load: (): Promise<SentryBrowserSdk> => Promise.reject(new Error("blocked by an extension")),
      init: (sdk) => sdk.init({}),
      target: h.target,
      whenIdle: h.whenIdle,
    });
    h.fire("error", { error: new Error("early") });
    h.idle();
    await vi.waitFor(() => expect(h.listeners.get("error")?.size ?? 0).toBe(0));
    expect(h.sdk.init).not.toHaveBeenCalled();
  });
});
