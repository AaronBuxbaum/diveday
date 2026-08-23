// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HapticsToggle } from "./HapticsToggle";
import { HAPTICS_STORAGE_KEY } from "./haptics";

const COPY = { label: "Buzz on each tap" };

const withVibrate = (present: boolean) => {
  if (present)
    Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true });
  else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "vibrate");
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  withVibrate(false);
  window.localStorage.clear();
});

describe("HapticsToggle", () => {
  /**
   * No iPhone implements `navigator.vibrate`, so offering the switch there
   * would be a control for a channel the device does not have — a question the
   * crew member cannot answer and does not need to (issue #817).
   */
  it("renders nothing on a device with no vibration motor", () => {
    withVibrate(false);
    const { container } = render(<HapticsToggle copy={COPY} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the switch on, since the channel is on until somebody says otherwise", () => {
    withVibrate(true);
    render(<HapticsToggle copy={COPY} />);
    expect(screen.getByLabelText("Buzz on each tap")).toBeChecked();
  });

  it("remembers this device's answer", () => {
    withVibrate(true);
    render(<HapticsToggle copy={COPY} />);
    fireEvent.click(screen.getByLabelText("Buzz on each tap"));

    expect(screen.getByLabelText("Buzz on each tap")).not.toBeChecked();
    expect(window.localStorage.getItem(HAPTICS_STORAGE_KEY)).toBe("off");
  });

  it("opens in the position this device left it in, not the default", () => {
    withVibrate(true);
    window.localStorage.setItem(HAPTICS_STORAGE_KEY, "off");
    render(<HapticsToggle copy={COPY} />);
    // Never a checked flash first: a device that turned it off would otherwise
    // be told, for a frame, that it is still buzzing.
    expect(screen.getByLabelText("Buzz on each tap")).not.toBeChecked();
  });
});
