// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, HoldPlace } from "./HoldPlace";

/**
 * **Switching the checkpoint never moves the roll call under the crew's
 * thumb.** jsdom has no layout, so the marker's position is a number the test
 * moves the way a checklist folding above it would, and the page's resize
 * observer is a stub the test fires the way the browser does after a layout.
 * The fold is late on purpose: in the browser it lands a few hundred
 * milliseconds after the switch commits, which is what the observer is for.
 */

let top = 0;
let observers: Array<{ fire: () => void; live: boolean }> = [];

class StubResizeObserver {
  private readonly record: { fire: () => void; live: boolean };
  constructor(callback: () => void) {
    this.record = { fire: callback, live: false };
    observers.push(this.record);
  }
  observe() {
    this.record.live = true;
  }
  disconnect() {
    this.record.live = false;
  }
  unobserve() {}
}

/** The page above changes size; the browser tells whoever is still listening. */
function layoutShift(to: number) {
  top = to;
  act(() => {
    for (const observer of observers) if (observer.live) observer.fire();
  });
}

let scrollBy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top }) as DOMRect,
  );
  scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(((_x: number, y: number) => {
    top -= y;
  }) as typeof window.scrollBy);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function switchCheckpoint(startTop: number) {
  top = startTop;
  const view = render(<HoldPlace holdKey="departure" />);
  view.rerender(<HoldPlace holdKey="after_dive_1" />);
  return view;
}

describe("HoldPlace", () => {
  it("scrolls back by however far a late fold moved it", () => {
    switchCheckpoint(185);
    layoutShift(-83);
    expect(scrollBy).toHaveBeenCalledWith(0, -268);
    expect(top).toBe(185);
  });

  it("leaves the page alone when nothing moved", () => {
    switchCheckpoint(185);
    layoutShift(185);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("does not chase a marker that was below the fold", () => {
    switchCheckpoint(window.innerHeight + 100);
    layoutShift(10);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("ignores a re-render on the same checkpoint", () => {
    top = 185;
    const view = render(<HoldPlace holdKey="departure" />);
    view.rerender(<HoldPlace holdKey="departure" />);
    layoutShift(-83);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("lets go once the page has had time to settle", () => {
    switchCheckpoint(185);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    layoutShift(-83);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("lets go the moment the reader moves the page themselves", () => {
    switchCheckpoint(185);
    window.dispatchEvent(new Event("wheel"));
    layoutShift(-83);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("lets go when the roll call leaves the page", () => {
    const view = switchCheckpoint(185);
    view.unmount();
    layoutShift(-83);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
