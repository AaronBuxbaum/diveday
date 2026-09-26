// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmbientContrastControl,
  type AmbientContrastCopy,
  AmbientGlareDetector,
  CONTRAST_MODE_STORAGE_KEY,
  GLARE_LUX_THRESHOLD,
} from "./AmbientGlareDetector";

const contrastCopy: AmbientContrastCopy = {
  modeLabel: "Boat mode",
  labelAuto: "Auto",
  labelStandard: "Land mode",
  labelFull: "Boat mode",
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

/** Pushes one lux reading through the mocked sensor, as the hardware would. */
function emitReading(lux: number) {
  act(() => {
    if (MockAmbientLightSensor.mockInstance) {
      MockAmbientLightSensor.mockInstance.illuminance = lux;
    }
    for (const cb of MockAmbientLightSensor.listeners.reading || []) {
      cb();
    }
  });
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
  /**
   * The markup the server sends already has Auto selected — the control's real
   * state until this device says otherwise.
   *
   * It used to gate the selected state behind a `mounted` flag, so the rendered
   * HTML showed a three-way segmented control with *nothing* chosen until React
   * hydrated. On screen that is a crew member looking at an unanswered control;
   * in the visual suite it was a race, caught once as a single dark-390 capture
   * whose Auto pill was unfilled while the other three variants had it filled.
   */
  it("paints Auto as the chosen mode in server-rendered markup, before any effect runs", () => {
    const html = renderToStaticMarkup(<AmbientContrastControl copy={contrastCopy} />);
    // The one checked radio, and it is the first of the three.
    expect(html.match(/checked/g) ?? []).toHaveLength(1);
    expect(html.indexOf("checked")).toBeLessThan(html.indexOf("Land mode"));
  });

  it("keeps a stored choice once the effect has read it", async () => {
    localStorage.setItem(CONTRAST_MODE_STORAGE_KEY, "full");
    render(<AmbientContrastControl copy={contrastCopy} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Boat mode" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Auto" })).not.toBeChecked();
  });

  it("does not add glare-mode class by default", () => {
    render(<AmbientGlareDetector />);
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });

  it("adds glare-mode class on a high sensor reading in auto mode, and drops it on a low one", () => {
    vi.stubGlobal("AmbientLightSensor", MockAmbientLightSensor);

    render(<AmbientGlareDetector />);

    emitReading(GLARE_LUX_THRESHOLD + 1000);
    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);

    emitReading(GLARE_LUX_THRESHOLD - 1000);
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });

  it("forces glare-mode to be disabled in standard mode override", () => {
    vi.stubGlobal("AmbientLightSensor", MockAmbientLightSensor);

    render(
      <>
        <AmbientGlareDetector />
        <AmbientContrastControl copy={contrastCopy} />
      </>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Land mode" }));
    });

    // The selected option *is* the readout — there is no second chip repeating it.
    expect(screen.getByRole("radio", { name: "Land mode" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Auto" })).not.toBeChecked();

    // A bright reading arrives from the sensor…
    emitReading(GLARE_LUX_THRESHOLD + 5000);

    // …but glare-mode stays off: the Land mode override wins.
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
      fireEvent.click(screen.getByRole("radio", { name: "Boat mode" }));
    });

    expect(screen.getByRole("radio", { name: "Boat mode" })).toBeChecked();

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

    expect(screen.getByRole("radio", { name: "Boat mode" })).toBeChecked();
    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);
  });

  /**
   * **The capsule hugs its three words** (docs/design/pixel-craft.md, classes
   * 5 and 12). The track was a block-level flex row with no `w-fit`, so on
   * `/ready` at 1280 it ran 528px with its three options in the first 200 and
   * 61% of it an empty tail; on a phone 42%.
   */
  it("draws a track that hugs its options, never the column's width", () => {
    render(<AmbientContrastControl copy={contrastCopy} />);
    const track = screen.getByRole("radio", { name: "Auto" }).closest("label")?.parentElement;
    expect(track).toHaveClass("w-fit", "max-w-full");
  });

  /**
   * **The caption sits inside the tile, not in its border.** The manifest and
   * the offline copy border this fieldset (`rounded-inset border … p-3`), and
   * a fieldset's first legend is laid *into* its block-start border, which it
   * cuts: "BOAT MODE" stood on a gap in the tile's top edge. A floated legend
   * is not the fieldset's rendered legend (HTML's rendering rules), so it lays
   * out as the first thing inside the padding. Its bottom margin is the gap to
   * the track, because a top margin on the box after a float is taken up by
   * the float itself and would render as nothing.
   */
  it("keeps its caption inside a bordered tile, clear of the border", () => {
    const { container } = render(
      <AmbientContrastControl
        copy={contrastCopy}
        className="rounded-inset border border-border bg-surface-sunken p-3"
      />,
    );
    const legend = container.querySelector("legend");
    expect(legend).toHaveClass("float-start", "w-full", "mb-1.5");
    const track = screen.getByRole("radio", { name: "Auto" }).closest("label")?.parentElement;
    expect(track).not.toHaveClass("mt-1.5");
    // Still the group's name, whatever it looks like.
    expect(screen.getByRole("group", { name: "Boat mode" })).toBe(
      container.querySelector("fieldset"),
    );
  });

  it("uses the AmbientLightSensor API when available on window and triggers reading", () => {
    vi.stubGlobal("AmbientLightSensor", MockAmbientLightSensor);

    render(<AmbientGlareDetector />);

    expect(MockAmbientLightSensor.mockInstance).not.toBeNull();
    expect(MockAmbientLightSensor.mockInstance?.start).toHaveBeenCalled();

    // Trigger high lux reading
    emitReading(GLARE_LUX_THRESHOLD + 2000);
    expect(document.documentElement.classList.contains("glare-mode")).toBe(true);

    // Trigger low lux reading
    emitReading(GLARE_LUX_THRESHOLD - 2000);
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
  });
});
