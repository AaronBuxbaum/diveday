// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HAPTICS_STORAGE_KEY,
  hapticsAvailable,
  hapticsEnabled,
  setHapticsEnabled,
  vibrate,
} from "./haptics";

/**
 * The channel's two facts, pinned: it does not exist on an iPhone, and it can
 * be turned off. Both used to be true only by accident — the call sites
 * feature-detected inline and nothing could be switched off at all (issue
 * #817).
 */
const withVibrate = (impl?: (pattern: number | number[]) => boolean) => {
  if (impl) Object.defineProperty(navigator, "vibrate", { value: impl, configurable: true });
  else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "vibrate");
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  withVibrate();
  window.localStorage.clear();
});

describe("haptics", () => {
  it("reports no channel on a device without one — every iPhone", () => {
    withVibrate();
    expect(hapticsAvailable()).toBe(false);
    // And asking for a buzz there is a no-op, not a throw.
    expect(() => vibrate(10)).not.toThrow();
  });

  it("buzzes when the device can and the preference is untouched", () => {
    const spy = vi.fn(() => true);
    withVibrate(spy);
    expect(hapticsAvailable()).toBe(true);
    // Default on: a tick on a wet deck is the point of the feature, and
    // nobody turns on a feedback layer they have never felt.
    expect(hapticsEnabled()).toBe(true);
    vibrate([40, 40, 40]);
    expect(spy).toHaveBeenCalledWith([40, 40, 40]);
  });

  it("stays silent once this device turns it off, and comes back when it is turned on", () => {
    const spy = vi.fn(() => true);
    withVibrate(spy);

    setHapticsEnabled(false);
    expect(window.localStorage.getItem(HAPTICS_STORAGE_KEY)).toBe("off");
    vibrate(10);
    expect(spy).not.toHaveBeenCalled();

    setHapticsEnabled(true);
    vibrate(10);
    expect(spy).toHaveBeenCalledWith(10);
  });

  it("announces the change so a live control can follow it", () => {
    const heard = vi.fn();
    window.addEventListener("diveday:haptics-change", heard);
    setHapticsEnabled(false);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("diveday:haptics-change", heard);
  });

  /**
   * A haptic is decoration. A platform that refuses one — a permissions
   * policy, a browser that throws on an odd pattern — must not take the
   * roll-call tap that asked for it.
   */
  it("swallows a refusal from the platform", () => {
    withVibrate(() => {
      throw new Error("blocked by permissions policy");
    });
    expect(() => vibrate([100, 50, 100])).not.toThrow();
  });

  it("keeps the channel when storage itself refuses to answer", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    // Losing the preference must not lose the feature.
    expect(hapticsEnabled()).toBe(true);
    getItem.mockRestore();
  });
});
