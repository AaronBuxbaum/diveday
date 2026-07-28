// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmbientGlareDetector, GLARE_LUX_THRESHOLD } from "./AmbientGlareDetector";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("glare-mode");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AmbientGlareDetector", () => {
  it("does not add glare-mode class by default", () => {
    render(<AmbientGlareDetector />);
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });

  it("adds glare-mode class when custom event is dispatched with high lux", () => {
    render(<AmbientGlareDetector />);

    const event = new CustomEvent("diveday:set-lux", {
      detail: { lux: GLARE_LUX_THRESHOLD + 1000 },
    });
    window.dispatchEvent(event);

    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);

    const eventLow = new CustomEvent("diveday:set-lux", {
      detail: { lux: GLARE_LUX_THRESHOLD - 1000 },
    });
    window.dispatchEvent(eventLow);

    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });

  it("handles experimental AmbientLightSensor if present", () => {
    let readingCallback: EventListenerOrEventListenerObject | null = null;
    let illuminanceValue = 0;

    class MockAmbientLightSensor {
      addEventListener = vi.fn((event: string, callback: EventListenerOrEventListenerObject) => {
        if (event === "reading") readingCallback = callback;
      });
      removeEventListener = vi.fn();
      start = vi.fn();
      stop = vi.fn();
      get illuminance() {
        return illuminanceValue;
      }
    }

    vi.stubGlobal("AmbientLightSensor", MockAmbientLightSensor);

    render(<AmbientGlareDetector />);

    expect(readingCallback).not.toBeNull();

    const invokeCallback = () => {
      if (readingCallback) {
        if (typeof readingCallback === "function") {
          readingCallback(new Event("reading"));
        } else {
          readingCallback.handleEvent(new Event("reading"));
        }
      }
    };

    // Simulate high light level
    illuminanceValue = GLARE_LUX_THRESHOLD + 5000;
    invokeCallback();
    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);

    // Simulate normal light level
    illuminanceValue = GLARE_LUX_THRESHOLD - 5000;
    invokeCallback();
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });
});
