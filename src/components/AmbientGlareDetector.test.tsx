// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmbientContrastControl,
  type AmbientContrastCopy,
  AmbientGlareDetector,
  GLARE_LUX_THRESHOLD,
} from "./AmbientGlareDetector";

const contrastCopy: AmbientContrastCopy = {
  contrastLabel: "Contrast",
  labelAuto: "Auto",
  labelStandard: "Standard",
  labelFullAaa: "Maximum",
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

describe("AmbientGlareDetector & AmbientContrastControl", () => {
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
        <AmbientContrastControl copy={contrastCopy} />
      </>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    });

    // The selected option *is* the readout — there is no second chip repeating it.
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Auto" })).not.toBeChecked();

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

  it("forces glare-mode to be active in maximum-contrast mode override", () => {
    render(
      <>
        <AmbientGlareDetector />
        <AmbientContrastControl copy={contrastCopy} />
      </>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Maximum" }));
    });

    expect(screen.getByRole("radio", { name: "Maximum" })).toBeChecked();

    // Glare mode should be active even if lux is low (which it is by default, 0)
    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);
  });

  it("persists override choice across page reloads via localStorage", () => {
    localStorage.setItem("diveday:contrast-mode", "full");

    render(
      <>
        <AmbientGlareDetector />
        <AmbientContrastControl copy={contrastCopy} />
      </>,
    );

    expect(screen.getByRole("radio", { name: "Maximum" })).toBeChecked();
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
