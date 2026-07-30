// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaterLocker, type WaterLockerCopy } from "./WaterLocker";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const COPY: WaterLockerCopy = {
  rainAlt: "Rain",
  heading: "Screen locked — water detected",
  body: "We're ignoring random taps from water on the screen. Hold to unlock once it's dry.",
  holdLine1: "HOLD",
  holdLine2: "2s",
  unlockingProgress: "Unlocking... {percent}%",
  holdToUnlock: "Hold button to unlock",
};

describe("WaterLocker", () => {
  it("renders null by default when not locked", () => {
    const { container } = render(<WaterLocker copy={COPY} />);
    expect(container.firstChild).toBeNull();
  });

  it("activates the lock screen on multi-touch anomalies (touches > 2)", () => {
    render(<WaterLocker copy={COPY} />);

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

    expect(screen.getByText("Screen locked — water detected")).toBeInTheDocument();
  });

  it("cancels the anomalous touch before it can trigger the underlying page", () => {
    render(<WaterLocker copy={COPY} />);

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
    render(<WaterLocker copy={COPY} />);

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

    expect(screen.getByText("Screen locked — water detected")).toBeInTheDocument();
  });

  it("unlocks when the hold button is pressed and held for 2 seconds", () => {
    vi.useFakeTimers();
    render(<WaterLocker copy={COPY} />);

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

    expect(screen.getByText("Screen locked — water detected")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /hold/i });

    act(() => {
      fireEvent.mouseDown(button);
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Screen locked — water detected")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.queryByText("Screen locked — water detected")).toBeNull();
  });

  it("unlocks when the hold button is activated with the keyboard", () => {
    vi.useFakeTimers();
    render(<WaterLocker copy={COPY} />);

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

    const button = screen.getByRole("button", { name: /hold/i });
    act(() => fireEvent.keyDown(button, { key: " " }));
    act(() => vi.advanceTimersByTime(2000));

    expect(screen.queryByText("Screen locked — water detected")).toBeNull();
  });
});
