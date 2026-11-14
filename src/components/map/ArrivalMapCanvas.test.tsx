// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArrivalMapCanvas, arrivalCoordinates } from "./ArrivalMapCanvas";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("arrival map", () => {
  it("preserves coordinate framing and does not geocode text", () => {
    expect(arrivalCoordinates("25.0106,-80.3756")).toEqual([25.0106, -80.3756]);
    expect(arrivalCoordinates("12 Dock Road, Key Largo FL")).toBeNull();
    expect(arrivalCoordinates("100,200")).toBeNull();
  });

  it("zooms only on modified wheel, while retaining touch, keyboard and controls", async () => {
    const L = await import("leaflet");
    const setZoomAround = vi.spyOn(L.Map.prototype, "setZoomAround");
    const { container, unmount } = render(
      <ArrivalMapCanvas title="Map of the dock" query="25,-80" />,
    );
    await waitFor(() => expect(container.querySelector(".leaflet-control-zoom")).not.toBeNull());
    const element = container.querySelector<HTMLElement>("section[aria-label]");
    if (!element) throw new Error("Map did not mount");
    expect(element).toHaveAccessibleName("Map of the dock");
    const wheel = (options: WheelEventInit = {}) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -120,
        ...options,
      });
      element.dispatchEvent(event);
      return event;
    };
    expect(wheel().defaultPrevented).toBe(false);
    expect(wheel({ metaKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(setZoomAround).toHaveBeenCalled());
    const map = setZoomAround.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not zoom");
    expect(map.getCenter().lat).toBeCloseTo(25, 3);
    expect(map.getCenter().lng).toBeCloseTo(-80, 3);
    const zoom = map.getZoom();
    expect(wheel().defaultPrevented).toBe(false);
    expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(map.getZoom()).toBeGreaterThan(zoom));
    expect(map.touchZoom.enabled()).toBe(true);
    expect(map.keyboard.enabled()).toBe(true);
    const zoomBeforeButton = map.getZoom();
    const zoomIn = container.querySelector<HTMLElement>(".leaflet-control-zoom-in");
    if (!zoomIn) throw new Error("Zoom control did not mount");
    fireEvent.click(zoomIn);
    await waitFor(() => expect(map.getZoom()).toBeGreaterThan(zoomBeforeButton));
    unmount();
    expect(wheel({ metaKey: true }).defaultPrevented).toBe(false);
  });
});
