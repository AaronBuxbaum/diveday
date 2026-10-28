// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Map as LeafletMap } from "leaflet";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CENTER = { latitude: 25.01, longitude: -80.37 };
const PIN: MapPin = {
  id: "reef",
  name: "Molasses & French Reef",
  subtitle: "Outer bank",
  href: "/shop/blue-mantis/dive-sites/reef?tab=details&from=map",
  hrefLabel: "Open site",
  ...CENTER,
};

describe("SiteMap popup resize behavior", () => {
  it("keeps a site popup inside the resized map while auto-pan is in flight", async () => {
    const L = await import("leaflet");
    const dimensions = { width: 640, height: 440 };
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    const resizeCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? dimensions.width : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? dimensions.height : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-popup") ||
        this.classList.contains("leaflet-popup-content")
        ? 264
        : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("leaflet-popup")) return 260;
      return this.classList.contains("leaflet-popup-content") ? 240 : 0;
    });

    const originalPanBy = L.Map.prototype.panBy;
    let allowAnimatedPan = false;
    const panBy = vi.spyOn(L.Map.prototype, "panBy").mockImplementation(function (
      this: LeafletMap,
      offset,
      options,
    ) {
      return originalPanBy.call(this, offset, {
        ...options,
        animate: allowAnimatedPan && options?.animate !== false,
      });
    });
    const { container } = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-marker button")).not.toBeNull(),
    );
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Leaflet map did not mount");

    // Put the site beside the map's right edge. Its initial opening pan is
    // synchronous so the resize below starts from a known, visible popup.
    map.panBy([-260, 0], { animate: false });
    const pin = container.querySelector(".leaflet-site-marker button");
    if (!(pin instanceof HTMLButtonElement)) throw new Error("Site marker did not mount");
    fireEvent.click(pin);
    await waitFor(() =>
      expect(container.querySelector(".leaflet-popup-content h2")).toHaveTextContent(PIN.name),
    );
    const popupElement = container.querySelector<HTMLElement>(".leaflet-site-popup");
    if (!popupElement) throw new Error("Popup did not mount");
    const popupRight = () => {
      const position = map.layerPointToContainerPoint(L.DomUtil.getPosition(popupElement));
      return position.x + Number.parseFloat(popupElement.style.left) + popupElement.offsetWidth;
    };
    expect(popupRight()).toBeLessThanOrEqual(dimensions.width);

    // The resize invokes SiteMap's popup update, which needs to pan 1px+
    // to keep the selected card inside the narrower viewport. Let Leaflet's
    // normal animation settle before checking its final position.
    allowAnimatedPan = true;
    dimensions.width = 391;
    resizeCallbacks[0]?.([], {} as ResizeObserver);
    expect(panBy.mock.calls.at(-1)?.[1]?.animate).not.toBe(false);
    await waitFor(() => expect(popupRight()).toBeLessThanOrEqual(dimensions.width), {
      timeout: 500,
    });
  });
});
