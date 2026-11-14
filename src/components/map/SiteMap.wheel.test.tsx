// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteMap from "./SiteMap";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const CENTER = { latitude: 25.01, longitude: -80.37 };
const PIN = { id: "reef", name: "Reef", ...CENTER };

describe("SiteMap wheel zoom", () => {
  it("leaves ordinary wheel scrolling alone and zooms with either modifier", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    const { container, unmount } = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-marker button")).not.toBeNull(),
    );
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not mount");
    const element = map.getContainer();
    const wheel = (modifiers: WheelEventInit = {}) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -120,
        ...modifiers,
      });
      element.dispatchEvent(event);
      return event;
    };
    const initialZoom = map.getZoom();
    expect(wheel().defaultPrevented).toBe(false);
    expect(map.getZoom()).toBe(initialZoom);
    expect(wheel({ metaKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(map.getZoom()).toBeGreaterThan(initialZoom));
    expect(wheel().defaultPrevented).toBe(false);
    const afterMeta = map.getZoom();
    expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(map.getZoom()).toBeGreaterThan(afterMeta));
    expect(map.touchZoom.enabled()).toBe(true);
    expect(map.keyboard.enabled()).toBe(true);
    expect(container.querySelector(".leaflet-control-zoom")).not.toBeNull();
    unmount();
    expect(wheel({ metaKey: true }).defaultPrevented).toBe(false);
  });
});
