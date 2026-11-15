// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapWheelHint } from "./MapWheelHint";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HINT = "Use ⌘ or Ctrl + scroll to zoom";
function mount() {
  return render(
    <MapWheelHint hint={HINT}>
      <div data-testid="map" />
    </MapWheelHint>,
  );
}

describe("map wheel guidance", () => {
  it("appears only after unmodified scrolling, without cancelling the event, then disappears", () => {
    mount();
    const map = screen.getByTestId("map");
    expect(screen.queryByRole("status")).toBeNull();
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 });
    act(() => {
      map.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(HINT);
    act(() => vi.advanceTimersByTime(1799));
    expect(screen.getByRole("status")).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("extends the hint for repeated scrolling and dismisses it when a modifier is used", () => {
    mount();
    const map = screen.getByTestId("map");
    fireEvent.wheel(map, { deltaY: 80 });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.wheel(map, { deltaY: 80 });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toBeVisible();
    fireEvent.wheel(map, { deltaY: 80, metaKey: true });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.wheel(map, { deltaY: 80, ctrlKey: true });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears its timer when removed", () => {
    const { unmount } = mount();
    fireEvent.wheel(screen.getByTestId("map"), { deltaY: 80 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
