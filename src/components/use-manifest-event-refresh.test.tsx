// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useManifestEventRefresh } from "./use-manifest-event-refresh";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("refreshes after a missed stream interval, without rereading on the initial connection", () => {
  let stream: FakeSource | undefined;
  class FakeSource extends EventTarget {
    close = vi.fn();
    constructor(public url: string) {
      super();
      stream = this;
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  const refresh = vi.fn();
  const { unmount } = renderHook(() => useManifestEventRefresh("trip-1", refresh));
  if (!stream) throw new Error("stream not opened");
  expect(stream.url).toBe("/api/trips/trip-1/manifest-events");
  act(() => stream?.dispatchEvent(new Event("open")));
  expect(refresh).not.toHaveBeenCalled();
  act(() => {
    stream?.dispatchEvent(new Event("error"));
    stream?.dispatchEvent(new Event("open"));
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledWith({ manual: false });
  act(() => stream?.dispatchEvent(new Event("manifest-changed")));
  expect(refresh).toHaveBeenCalledTimes(2);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => {
    stream?.dispatchEvent(new Event("error"));
    stream?.dispatchEvent(new Event("open"));
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  unmount();
  expect(stream.close).toHaveBeenCalledOnce();
});

it("refreshes when a stream opens after an initial connection failure", () => {
  let stream: EventTarget | undefined;
  class FakeSource extends EventTarget {
    close() {}
    constructor() {
      super();
      stream = this;
    }
  }
  vi.stubGlobal("EventSource", FakeSource);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  const refresh = vi.fn();
  renderHook(() => useManifestEventRefresh("trip-1", refresh));
  act(() => {
    stream?.dispatchEvent(new Event("error"));
    stream?.dispatchEvent(new Event("open"));
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});
