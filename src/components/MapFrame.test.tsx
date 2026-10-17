// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_REACHABILITY_PROBE } from "@/lib/maps";
import { MAP_GIVE_UP_MS, MapFrame } from "./MapFrame";

/**
 * **A map that cannot load fails silently** (UX review 2026-10-10, item 20).
 * The frame's own `load` fires for the browser's error page as well, so it is
 * the probe image that decides; until it answers, the frame keeps its box and
 * shows nothing.
 */
const probes: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
class FakeImage {
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    probes.push(this);
  }
}

beforeEach(() => {
  probes.length = 0;
  vi.stubGlobal("Image", FakeImage);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frame = () =>
  render(
    <MapFrame
      title="Terrain map"
      src="https://maps.google.com/x"
      className="h-full"
      interactive={false}
    />,
  ).container.querySelector("iframe") as HTMLIFrameElement;

describe("MapFrame", () => {
  it("keeps the frame invisible until the provider answers, then shows it", () => {
    const iframe = frame();
    expect(iframe).toHaveClass("invisible");
    expect(iframe).toHaveAttribute("aria-hidden", "true");
    expect(probes).toHaveLength(1);
    expect(probes[0]?.src).toBe(MAP_REACHABILITY_PROBE);
    act(() => probes[0]?.onload?.());
    expect(iframe).not.toHaveClass("invisible");
    expect(iframe).not.toHaveAttribute("aria-hidden");
  });

  it("stays invisible when the provider cannot be reached", () => {
    const iframe = frame();
    // Asserted, not optional-chained: a probe with no error handler would
    // pass this test without ever failing.
    expect(probes[0]?.onerror).toBeTypeOf("function");
    act(() => probes[0]?.onerror?.());
    expect(iframe).toHaveClass("invisible");
    // The box is still there, so the route's percentages still land.
    expect(iframe).toHaveClass("h-full");
  });

  it("does not ask with the radio off, and asks once the signal comes back", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const iframe = frame();
    expect(probes).toHaveLength(0);
    expect(iframe).toHaveClass("invisible");
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(probes).toHaveLength(1);
    act(() => probes[0]?.onload?.());
    expect(iframe).not.toHaveClass("invisible");
    // Once is enough: a second `online` does not ask again.
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(probes).toHaveLength(1);
  });

  it("stops listening for the signal once it is gone from the page", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <MapFrame
        title="Terrain map"
        src="https://maps.google.com/x"
        className="h-full"
        interactive={false}
      />,
    );
    unmount();
    expect(remove).toHaveBeenCalledWith("online", expect.any(Function));
  });

  it("asks nothing until the frame is on screen: a folded editor section contacts no one", () => {
    const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        record: { callback: IntersectionObserverCallback; disconnected: boolean };
        constructor(callback: IntersectionObserverCallback) {
          this.record = { callback, disconnected: false };
          observers.push(this.record);
        }
        observe() {}
        disconnect() {
          this.record.disconnected = true;
        }
      },
    );
    const iframe = frame();
    expect(probes).toHaveLength(0);
    const seen = (isIntersecting: boolean) =>
      act(() =>
        observers[0]?.callback(
          [{ isIntersecting } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
    seen(false);
    expect(probes).toHaveLength(0);
    seen(true);
    expect(probes).toHaveLength(1);
    expect(observers[0]?.disconnected).toBe(true);
    act(() => probes[0]?.onload?.());
    expect(iframe).not.toHaveClass("invisible");
  });

  // Issue issue 2013: the frame says which state it is in, so a surface can draw a
  // quiet line for the one that matters. A cross-origin frame has no reliable
  // error event: the probe's error and the silence are the only signals.
  describe("its state (issue 2013)", () => {
    it("is waiting, then reachable once the provider answers", () => {
      const iframe = frame();
      expect(iframe).toHaveAttribute("data-map-state", "waiting");
      act(() => probes[0]?.onload?.());
      expect(iframe).toHaveAttribute("data-map-state", "reachable");
    });

    it("is failed as soon as the provider refuses", () => {
      const iframe = frame();
      act(() => probes[0]?.onerror?.());
      expect(iframe).toHaveAttribute("data-map-state", "failed");
    });

    it("is failed when the provider stays silent, and recovers if it answers late", () => {
      vi.useFakeTimers();
      try {
        const iframe = frame();
        act(() => {
          vi.advanceTimersByTime(MAP_GIVE_UP_MS - 1);
        });
        expect(iframe).toHaveAttribute("data-map-state", "waiting");
        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(iframe).toHaveAttribute("data-map-state", "failed");
        act(() => probes[0]?.onload?.());
        expect(iframe).toHaveAttribute("data-map-state", "reachable");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
