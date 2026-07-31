// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WATER_LOCKER_DISABLED_STORAGE_KEY,
  WaterLocker,
  type WaterLockerCopy,
  WaterLockerToggle,
  type WaterLockerToggleCopy,
} from "./WaterLocker";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
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

const TOGGLE_COPY: WaterLockerToggleCopy = {
  disableToggleLabel: "Disable spray guard on this device",
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

  it("never locks when the spray guard has been disabled on this device (task 78)", async () => {
    localStorage.setItem(WATER_LOCKER_DISABLED_STORAGE_KEY, "true");
    render(<WaterLocker copy={COPY} />);
    // The preference loads in an effect after mount — wait for it before
    // asserting the multi-touch anomaly is ignored.
    await act(async () => {});

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

    expect(screen.queryByText("Screen locked — water detected")).toBeNull();
  });

  it("releases an in-progress lock the instant the toggle disables it, same tab", async () => {
    render(
      <>
        <WaterLocker copy={COPY} />
        <WaterLockerToggle copy={TOGGLE_COPY} />
      </>,
    );
    await act(async () => {});

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

    const checkbox = screen.getByRole("checkbox", { name: "Disable spray guard on this device" });
    act(() => fireEvent.click(checkbox));

    expect(screen.queryByText("Screen locked — water detected")).toBeNull();
    expect(localStorage.getItem(WATER_LOCKER_DISABLED_STORAGE_KEY)).toBe("true");
  });

  it("re-locks after the toggle is switched back on", async () => {
    render(
      <>
        <WaterLocker copy={COPY} />
        <WaterLockerToggle copy={TOGGLE_COPY} />
      </>,
    );
    await act(async () => {});

    const checkbox = screen.getByRole("checkbox", { name: "Disable spray guard on this device" });
    act(() => fireEvent.click(checkbox)); // disable
    act(() => fireEvent.click(checkbox)); // re-enable

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
  });
});
