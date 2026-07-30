// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AmbientContrastCopy,
  AmbientContrastSlider,
  AmbientGlareDetector,
  GLARE_LUX_THRESHOLD,
} from "./AmbientGlareDetector";

const contrastCopy: AmbientContrastCopy = {
  contrastAutoFallback: "Contrast: Auto",
  contrastIconTitle: "Contrast Icon",
  contrastLabel: "Contrast",
  labelAuto: "Auto",
  labelStandard: "Standard",
  labelFullAaa: "Full AAA",
  modeAuto: "Auto ☀",
  modeStandard: "Standard",
  modeFullAaa: "Full AAA ☀",
};

class MockAmbientLightSensor implements EventTarget {
  illuminance = 0;
  start = vi.fn();
  stop = vi.fn();
  static mockInstance: MockAmbientLightSensor | null = null;
  static listeners: Record<string, Array<() => void>> = {};

  constructor() {
    MockAmbientLightSensor.mockInstance = this;
  }

  addEventListener(type: string, callback: EventListenerOrEventListenerObject) {
    if (!MockAmbientLightSensor.listeners[type]) {
      MockAmbientLightSensor.listeners[type] = [];
    }
    MockAmbientLightSensor.listeners[type].push(callback as () => void);
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject) {
    if (MockAmbientLightSensor.listeners[type]) {
      MockAmbientLightSensor.listeners[type] = MockAmbientLightSensor.listeners[type].filter(
        (cb) => cb !== callback,
      );
    }
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("glare-mode");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockAmbientLightSensor.mockInstance = null;
  MockAmbientLightSensor.listeners = {};
});

describe("AmbientGlareDetector & AmbientContrastSlider", () => {
  it("does not add glare-mode class by default", () => {
    render(<AmbientGlareDetector />);
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });

  it("adds glare-mode class when custom event is dispatched with high lux in auto mode", () => {
    render(<AmbientGlareDetector />);

    act(() => {
      const event = new CustomEvent("diveday:set-lux", {
        detail: { lux: GLARE_LUX_THRESHOLD + 1000 },
      });
      window.dispatchEvent(event);
    });

    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);

    act(() => {
      const eventLow = new CustomEvent("diveday:set-lux", {
        detail: { lux: GLARE_LUX_THRESHOLD - 1000 },
      });
      window.dispatchEvent(eventLow);
    });

    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });

  it("forces glare-mode to be disabled in standard mode override", () => {
    render(
      <>
        <AmbientGlareDetector />
        <AmbientContrastSlider copy={contrastCopy} />
      </>,
    );

    // Set slider to Standard override (value = 1)
    const slider = screen.getByRole("slider") as HTMLInputElement;
    act(() => {
      fireEvent.change(slider, { target: { value: "1" } });
    });

    expect(slider.value).toBe("1");
    // Use getAllByText and choose index 0 to get the status badge instead of tick labels
    expect(screen.getAllByText("Standard")[0]).toBeInTheDocument();

    // Dispatch high lux event
    act(() => {
      const event = new CustomEvent("diveday:set-lux", {
        detail: { lux: GLARE_LUX_THRESHOLD + 5000 },
      });
      window.dispatchEvent(event);
    });

    // Should remain disabled due to Standard override
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });

  it("forces glare-mode to be active in full AAA mode override", () => {
    render(
      <>
        <AmbientGlareDetector />
        <AmbientContrastSlider copy={contrastCopy} />
      </>,
    );

    // Set slider to Full AAA override (value = 2)
    const slider = screen.getByRole("slider") as HTMLInputElement;
    act(() => {
      fireEvent.change(slider, { target: { value: "2" } });
    });

    expect(slider.value).toBe("2");
    expect(screen.getByText("Full AAA ☀")).toBeInTheDocument();

    // Glare mode should be active even if lux is low (which it is by default, 0)
    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);
  });

  it("persists override choice across page reloads via localStorage", () => {
    localStorage.setItem("diveday:contrast-mode", "full");

    render(
      <>
        <AmbientGlareDetector />
        <AmbientContrastSlider copy={contrastCopy} />
      </>,
    );

    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("2"); // Full AAA
    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);
  });

  it("uses the AmbientLightSensor API when available on window and triggers reading", () => {
    vi.stubGlobal("AmbientLightSensor", MockAmbientLightSensor);

    render(<AmbientGlareDetector />);

    expect(MockAmbientLightSensor.mockInstance).not.toBeNull();
    expect(MockAmbientLightSensor.mockInstance?.start).toHaveBeenCalled();

    // Trigger high lux reading
    act(() => {
      if (MockAmbientLightSensor.mockInstance) {
        MockAmbientLightSensor.mockInstance.illuminance = GLARE_LUX_THRESHOLD + 2000;
      }
      for (const cb of MockAmbientLightSensor.listeners.reading || []) {
        cb();
      }
    });

    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);

    // Trigger low lux reading
    act(() => {
      if (MockAmbientLightSensor.mockInstance) {
        MockAmbientLightSensor.mockInstance.illuminance = GLARE_LUX_THRESHOLD - 2000;
      }
      for (const cb of MockAmbientLightSensor.listeners.reading || []) {
        cb();
      }
    });

    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });
});
