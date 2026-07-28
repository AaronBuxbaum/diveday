// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaterLocker } from "./WaterLocker";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WaterLocker", () => {
  it("renders null by default when not locked", () => {
    const { container } = render(<WaterLocker />);
    expect(container.firstChild).toBeNull();
  });

  it("activates the lock screen on multi-touch anomalies (touches > 2)", () => {
    render(<WaterLocker />);

    const touchEvent = new TouchEvent("touchstart", {
      touches: [
        { clientX: 10, clientY: 10 } as Touch,
        { clientX: 20, clientY: 20 } as Touch,
        { clientX: 30, clientY: 30 } as Touch,
      ],
    });

    act(() => {
      window.dispatchEvent(touchEvent);
    });

    expect(screen.getByText("Water Shield Active")).toBeInTheDocument();
  });

  it("cancels the anomalous touch before it can trigger the underlying page", () => {
    render(<WaterLocker />);

    const touchEvent = new TouchEvent("touchstart", {
      cancelable: true,
      touches: [
        { clientX: 10, clientY: 10 } as Touch,
        { clientX: 20, clientY: 20 } as Touch,
        { clientX: 30, clientY: 30 } as Touch,
      ],
    });

    act(() => window.dispatchEvent(touchEvent));

    expect(touchEvent.defaultPrevented).toBe(true);
  });

  it("activates the lock screen on fast consecutive touches at separate coordinates", () => {
    vi.useFakeTimers();
    render(<WaterLocker />);

    act(() => {
      window.dispatchEvent(
        new TouchEvent("touchstart", {
          touches: [{ clientX: 10, clientY: 10 } as Touch],
        }),
      );
    });

    // Advance time by 50ms (so timeDiff is 50ms)
    act(() => {
      vi.advanceTimersByTime(50);
    });

    act(() => {
      window.dispatchEvent(
        new TouchEvent("touchstart", {
          touches: [{ clientX: 100, clientY: 100 } as Touch],
        }),
      );
    });

    expect(screen.getByText("Water Shield Active")).toBeInTheDocument();
  });

  it("unlocks when the hold button is pressed and held for 2 seconds", () => {
    vi.useFakeTimers();
    render(<WaterLocker />);

    act(() => {
      window.dispatchEvent(
        new TouchEvent("touchstart", {
          touches: [
            { clientX: 10, clientY: 10 } as Touch,
            { clientX: 20, clientY: 20 } as Touch,
            { clientX: 30, clientY: 30 } as Touch,
          ],
        }),
      );
    });

    expect(screen.getByText("Water Shield Active")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /hold/i });

    act(() => {
      fireEvent.mouseDown(button);
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Water Shield Active")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.queryByText("Water Shield Active")).toBeNull();
  });
});
