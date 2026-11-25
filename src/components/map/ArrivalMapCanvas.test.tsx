// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARRIVAL_MAP_ZOOM, ArrivalMapCanvas } from "./ArrivalMapCanvas";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("arrival map", () => {
  it("opens on the shop at a street-readable zoom with one marker, not on the world", async () => {
    const L = await import("leaflet");
    const setView = vi.spyOn(L.Map.prototype, "setView");
    const { container } = render(
      <ArrivalMapCanvas title="Map of the dock" center={[25.0865, -80.4473]} />,
    );
    await waitFor(() => expect(container.querySelector(".leaflet-control-zoom")).not.toBeNull());
    expect(ARRIVAL_MAP_ZOOM).toBeGreaterThanOrEqual(15);
    const map = setView.mock.contexts.find((context) => context instanceof L.Map);
    if (!(map instanceof L.Map)) throw new Error("Map did not open on a view");
    expect(map.getZoom()).toBe(ARRIVAL_MAP_ZOOM);
    expect(map.getCenter().lat).toBeCloseTo(25.0865, 4);
    expect(map.getCenter().lng).toBeCloseTo(-80.4473, 4);
    expect(container.querySelectorAll(".leaflet-overlay-pane path")).toHaveLength(1);
  });

  it("zooms only on modified wheel, while retaining touch, keyboard and controls", async () => {
    const L = await import("leaflet");
    const setZoomAround = vi.spyOn(L.Map.prototype, "setZoomAround");
    const { container, unmount } = render(
      <ArrivalMapCanvas title="Map of the dock" center={[25, -80]} />,
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
    // The card opens near the top of the zoom range; back out so each way in has room.
    map.setZoom(10, { animate: false });
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
    const zoomBeforeKeyboard = map.getZoom();
    element.focus();
    fireEvent.keyDown(document, { key: "+", keyCode: 187 });
    await waitFor(() => expect(map.getZoom()).toBeGreaterThan(zoomBeforeKeyboard));
    unmount();
    expect(wheel({ metaKey: true }).defaultPrevented).toBe(false);
  });
});
