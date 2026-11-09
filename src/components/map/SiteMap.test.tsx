// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Map as LeafletMap } from "leaflet";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

beforeAll(async () => {
  await import("leaflet");
});
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

async function markerButton(container: HTMLElement) {
  await waitFor(() =>
    expect(container.querySelector(".leaflet-site-marker button")).not.toBeNull(),
  );
  const button = container.querySelector(".leaflet-site-marker button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Site marker did not mount");
  return button;
}

function popup(container: HTMLElement) {
  const content = container.querySelector(".leaflet-popup-content");
  if (!(content instanceof HTMLElement)) throw new Error("Popup did not open");
  return content;
}

async function sizedOverview(dimensions: { width: number; height: number }) {
  const L = await import("leaflet");
  const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
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
  const view = render(
    <SiteMap
      center={{ latitude: 0, longitude: 0 }}
      pins={[-120, 120].map((longitude) => ({
        ...PIN,
        id: String(longitude),
        latitude: 0,
        longitude,
      }))}
      clusterLabel="dive sites"
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll(".leaflet-site-marker button")).toHaveLength(2),
  );
  const map = getContainer.mock.contexts[0];
  if (!(map instanceof L.Map)) throw new Error("Leaflet map did not mount");
  return { ...view, map };
}

describe("SiteMap labels through Leaflet", () => {
  it("gives isolated site targets a 44px Leaflet hit area", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    const { container } = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
    );
    await markerButton(container);
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not mount");
    const sizes: unknown[] = [];
    map.eachLayer((layer) => {
      if (
        layer instanceof L.Marker &&
        layer.getElement()?.classList.contains("leaflet-site-marker")
      ) {
        sizes.push(layer.options.icon?.options.iconSize, layer.options.icon?.options.iconAnchor);
      }
    });
    expect(sizes).toEqual([
      [44, 44],
      [22, 22],
    ]);
  });

  it("keeps the shop badge clear of a cluster above its geographic anchor and its tooltip above the stem", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 640 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 440 : 0;
    });
    const clusterPoint = L.CRS.EPSG3857.latLngToPoint(
      L.latLng(CENTER.latitude, CENTER.longitude),
      11,
    ).subtract([0, 48]);
    const clusterLocation = L.CRS.EPSG3857.pointToLatLng(clusterPoint, 11);
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[0, 1].map((index) => ({
          ...PIN,
          id: String(index),
          latitude: clusterLocation.lat,
          longitude: clusterLocation.lng,
        }))}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() => expect(container.querySelector(".leaflet-site-cluster")).not.toBeNull());
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not mount");
    const shop = container.querySelector<HTMLElement>(".leaflet-shop-marker");
    const landmark = shop?.querySelector<HTMLElement>("[role=img]");
    if (!shop || !landmark) throw new Error("Shop did not mount");
    const shopPoint = map.latLngToContainerPoint([CENTER.latitude, CENTER.longitude]);
    const cluster = map.latLngToContainerPoint(clusterLocation);
    const badge = {
      x: shopPoint.x + Number.parseFloat(shop.style.marginLeft) + 22,
      y: shopPoint.y + Number.parseFloat(shop.style.marginTop) + 22,
    };
    expect(Math.abs(badge.x - cluster.x) >= 48 || Math.abs(badge.y - cluster.y) >= 48).toBe(true);
    fireEvent.focus(landmark);
    expect(shopPoint.x + Number.parseFloat(shop.style.marginLeft) + 22).toBe(badge.x);
    expect(shopPoint.y + Number.parseFloat(shop.style.marginTop) + 22).toBe(badge.y);
    const tooltip = container.querySelector<HTMLElement>(".leaflet-shop-tooltip");
    expect(tooltip).not.toBeNull();
    // Every hover label and card is read over the shop, never behind it:
    // the shop's pane sits above the pins (600) and below Leaflet's tooltip
    // (650) and popup (700) panes, and its own label is an ordinary tooltip.
    expect(tooltip?.parentElement).toHaveClass("leaflet-tooltip-pane");
    const shopPane = Number(shop.parentElement?.style.zIndex);
    expect(shopPane).toBeGreaterThan(600);
    expect(shopPane).toBeLessThan(650);
    // The shop's line runs under the pins (600), so it never crosses a site.
    const stem = container.querySelector<HTMLElement>(".leaflet-shop-stem");
    expect(Number(stem?.parentElement?.style.zIndex)).toBeLessThan(600);
  });

  it("draws the shop on its own spot with no line when nothing is there, and not at all off the map", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 640 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 440 : 0;
    });
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[{ ...PIN, latitude: CENTER.latitude + 1, longitude: CENTER.longitude + 1 }]}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() => expect(container.querySelector(".leaflet-shop-marker")).not.toBeNull());
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not mount");
    const element = (selector: string) => {
      const found = container.querySelector<HTMLElement>(selector);
      if (!found) throw new Error(`${selector} did not mount`);
      return found;
    };
    map.setView([CENTER.latitude, CENTER.longitude], 10, { animate: false });
    await waitFor(() => {
      expect(element(".leaflet-shop-marker").style.marginLeft).toBe("-22px");
      expect(element(".leaflet-shop-marker").style.marginTop).toBe("-22px");
      expect(element(".leaflet-shop-marker").style.display).toBe("");
      expect(element(".leaflet-shop-stem").style.display).toBe("none");
    });

    // A site on the shop's own spot pushes the badge aside: now it needs the line.
    map.setView([CENTER.latitude + 1, CENTER.longitude + 1], 10, { animate: false });
    map.setView([CENTER.latitude, CENTER.longitude], 4, { animate: false });
    await waitFor(() => expect(element(".leaflet-shop-stem").style.display).toBe(""));

    map.setView([CENTER.latitude + 5, CENTER.longitude + 5], 10, { animate: false });
    await waitFor(() => {
      expect(element(".leaflet-shop-marker").style.display).toBe("none");
      expect(element(".leaflet-shop-stem").style.display).toBe("none");
    });
  });

  it("fits a noncoincident cluster fully in one click and lets a smaller cluster advance again", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 640 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 440 : 0;
    });
    const pins = [0, 0.002, 0.00201].map((longitude) => ({
      ...PIN,
      id: String(longitude),
      latitude: 0,
      longitude,
    }));
    const { container } = render(
      <SiteMap center={{ latitude: 0, longitude: 0 }} pins={pins} clusterLabel="dive sites" />,
    );
    await waitFor(() => expect(getContainer.mock.contexts[0]).toBeDefined());
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not mount");
    await act(async () => map.setView([0, 0], 11, { animate: false }));
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-cluster")).toHaveAccessibleName("3 dive sites"),
    );
    const startZoom = map.getZoom();
    const cluster = container.querySelector(".leaflet-site-cluster");
    if (!cluster) throw new Error("Cluster did not mount");
    fireEvent.click(cluster);
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-cluster")).toHaveAccessibleName("2 dive sites"),
    );
    expect(map.getZoom()).toBeGreaterThan(startZoom + 3);
    expect(container.querySelectorAll(".leaflet-site-marker")).toHaveLength(1);
    for (const pin of pins) {
      const point = map.latLngToContainerPoint([pin.latitude, pin.longitude]);
      expect(point.x).toBeGreaterThanOrEqual(48);
      expect(point.x).toBeLessThanOrEqual(640 - 48);
      expect(point.y).toBeGreaterThanOrEqual(48);
      expect(point.y).toBeLessThanOrEqual(440 - 48);
    }
    const fittedZoom = map.getZoom();
    const smaller = container.querySelector(".leaflet-site-cluster");
    if (!smaller) throw new Error("Smaller cluster did not mount");
    fireEvent.click(smaller);
    await waitFor(() => expect(map.getZoom()).toBeGreaterThan(fittedZoom));
  });

  it.each([
    [4, 220],
    [30, 60],
    [4, 4],
  ])(
    "keeps the shop badge and tooltip clear of map controls at coordinate %spx, %spx",
    async (horizontal, vertical) => {
      const L = await import("leaflet");
      const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains("leaflet-container") ? 640 : 0;
      });
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains("leaflet-container") ? 440 : 0;
      });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        if (this.classList.contains("leaflet-container")) return new DOMRect(0, 0, 640, 440);
        if (this.classList.contains("leaflet-control-zoom")) return new DOMRect(10, 10, 44, 88);
        return new DOMRect();
      });
      const { container } = render(
        <SiteMap
          center={CENTER}
          pins={[PIN]}
          shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
          clusterLabel="dive sites"
        />,
      );
      fireEvent.click(await markerButton(container));
      await waitFor(() => expect(container.querySelector(".leaflet-site-popup")).not.toBeNull());
      const popupElement = container.querySelector(".leaflet-site-popup");
      const map = getContainer.mock.contexts[0];
      if (!(map instanceof L.Map)) throw new Error("Map did not mount");
      const point = map.latLngToContainerPoint([CENTER.latitude, CENTER.longitude]);
      map.panBy([point.x - horizontal, point.y - vertical], { animate: false });
      const shop = container.querySelector<HTMLElement>(".leaflet-shop-marker");
      if (!shop) throw new Error("Shop did not mount");
      const anchor = map.latLngToContainerPoint([CENTER.latitude, CENTER.longitude]);
      const left = anchor.x + Number.parseFloat(shop.style.marginLeft);
      expect(left).toBeGreaterThanOrEqual(4);
      expect(left + 44).toBeLessThanOrEqual(640 - 4);
      const top = anchor.y + Number.parseFloat(shop.style.marginTop);
      expect(left < 54 && left + 44 > 10 && top < 98 && top + 44 > 10).toBe(false);
      expect(container.querySelector(".leaflet-site-popup")).toBe(popupElement);
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains("leaflet-tooltip") ? 200 : 0;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains("leaflet-tooltip") ? 40 : 0;
      });
      const landmark = shop.querySelector<HTMLElement>("[role=img]");
      if (!landmark) throw new Error("Shop landmark did not mount");
      fireEvent.focus(landmark);
      const tooltip = container.querySelector<HTMLElement>(".leaflet-shop-tooltip");
      if (!tooltip) throw new Error("Shop tooltip did not open");
      const tooltipPosition = map.layerPointToContainerPoint(L.DomUtil.getPosition(tooltip));
      expect(tooltipPosition.x).toBeGreaterThanOrEqual(4);
      expect(tooltipPosition.x + tooltip.offsetWidth).toBeLessThanOrEqual(640 - 4);
      expect(
        tooltipPosition.x < 54 &&
          tooltipPosition.x + tooltip.offsetWidth > 10 &&
          tooltipPosition.y < 98 &&
          tooltipPosition.y + tooltip.offsetHeight > 10,
      ).toBe(false);
    },
  );

  it("keeps one popup DOM node when selecting a site with Leaflet fade animation enabled", async () => {
    const L = await import("leaflet");
    const original = Object.getOwnPropertyDescriptor(L.Browser, "any3d");
    Object.defineProperty(L.Browser, "any3d", { configurable: true, value: true });
    try {
      const { container } = render(
        <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
      );
      const button = await markerButton(container);
      expect(container.querySelector(".leaflet-container")).toHaveClass("leaflet-fade-anim");
      await act(async () => fireEvent.click(button));
      expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1);
      expect(container.querySelector(".leaflet-site-marker button")).toBe(button);
      expect(button).toHaveClass("ring-4");
    } finally {
      if (original) Object.defineProperty(L.Browser, "any3d", original);
    }
  });

  it("keeps no camera for an overview nobody moved, so the next visit fits its own size", async () => {
    // The fit is the map's, not the reader's: kept, it came back at a phone
    // width as a desktop's zoom and hid most of the shop's sites.
    const key = "test-map-untouched";
    sessionStorage.clear();
    const first = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" viewportStorageKey={key} />,
    );
    await markerButton(first.container);
    // Nothing kept while it is open either: a reload unmounts nothing.
    expect(sessionStorage.getItem(`diveday:map:${key}`)).toBeNull();
    first.unmount();
    expect(sessionStorage.getItem(`diveday:map:${key}`)).toBeNull();
    sessionStorage.clear();
  });

  it("keeps no camera when the map is left before it has fitted its overview", async () => {
    // A staff member who follows a link the moment the map is created leaves
    // it holding only its default camera. Kept, that camera came back as a
    // "restored" view that was never fitted, and the library showed 3 of 8 sites.
    const L = await import("leaflet");
    const key = "test-map-left-early";
    sessionStorage.clear();
    let leave: (() => void) | undefined;
    const createPane = L.Map.prototype.createPane;
    vi.spyOn(L.Map.prototype, "createPane").mockImplementation(function (
      this: LeafletMap,
      name: string,
      container?: HTMLElement,
    ) {
      const pane = createPane.call(this, name, container);
      if (name === "shopStem") queueMicrotask(() => leave?.());
      return pane;
    });
    const view = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" viewportStorageKey={key} />,
    );
    const left = new Promise<void>((resolve) => {
      leave = () => {
        view.unmount();
        resolve();
      };
    });
    await left;
    expect(sessionStorage.getItem(`diveday:map:${key}`)).toBeNull();
    sessionStorage.clear();
  });

  it("restores the settled camera after unmount without fitting the overview again", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    const key = "test-map-camera";
    sessionStorage.clear();
    const props = {
      center: CENTER,
      pins: [PIN],
      clusterLabel: "dive sites",
      viewportStorageKey: key,
    };
    const first = render(<SiteMap {...props} />);
    await markerButton(first.container);
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not mount");
    map.setView([26, -81], 7, { animate: false });
    first.unmount();
    getContainer.mockClear();
    const second = render(<SiteMap {...props} />);
    await markerButton(second.container);
    const restored = getContainer.mock.contexts[0];
    if (!(restored instanceof L.Map)) throw new Error("Restored map did not mount");
    expect(restored.getZoom()).toBe(7);
    expect(restored.getCenter().lat).toBeCloseTo(26);
    expect(restored.getCenter().lng).toBeCloseTo(-81);
    sessionStorage.clear();
  });

  it("opens an isolated marker at the wide overview and switches selected popups", async () => {
    const { container } = await sizedOverview({ width: 640, height: 440 });
    const buttons = container.querySelectorAll<HTMLButtonElement>(".leaflet-site-marker button");
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(container.querySelectorAll(".leaflet-site-marker .ring-4")).toHaveLength(1),
    );
    const other = container.querySelector<HTMLButtonElement>(
      ".leaflet-site-marker button:not(.ring-4)",
    );
    if (!other) throw new Error("Other site marker did not remain clickable");
    fireEvent.click(other);
    await waitFor(() =>
      expect(container.querySelectorAll(".leaflet-site-marker .ring-4")).toHaveLength(1),
    );
    expect(container.querySelector(".leaflet-site-marker .ring-4")).toHaveAccessibleName(PIN.name);
    expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1);
  });

  // Aaron, 2026-10-22: clicks "randomly" did nothing. Leaflet drops a click
  // while its map drag still reads as moved, and a pin's own press never
  // reached the map to reset that, so after any drag every pin went dead.
  it("opens a pin's card after the map was dragged", async () => {
    const L = await import("leaflet");
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    const { container } = await sizedOverview({ width: 640, height: 440 });
    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Map did not mount");
    const draggable = (map.dragging as unknown as { _draggable: { _moved: boolean } })._draggable;
    draggable._moved = true;
    const [first, second] = container.querySelectorAll<HTMLButtonElement>(
      ".leaflet-site-marker button",
    );
    if (!first || !second) throw new Error("Two site markers did not mount");
    fireEvent.click(first);
    await waitFor(() => expect(popup(container).querySelector("h2")).not.toBeNull());
    fireEvent.click(second);
    await waitFor(() => expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1));
    expect(container.querySelector(".leaflet-site-marker .ring-4")).toBe(
      container.querySelectorAll(".leaflet-site-marker button")[1] ?? null,
    );
  });

  it("keeps a selected site's card open when its pin is clicked again", async () => {
    const { container } = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
    );
    const button = await markerButton(container);
    fireEvent.click(button);
    await waitFor(() => expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1));
    fireEvent.click(await markerButton(container));
    expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1);
  });

  it("shows no hover label on the selected site, and brings it back once deselected", async () => {
    const { container } = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
    );
    fireEvent.click(await markerButton(container));
    await waitFor(() => expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1));
    fireEvent.mouseOver(await markerButton(container));
    expect(container.querySelector(".leaflet-site-tooltip")).toBeNull();
    const close = container.querySelector<HTMLElement>(".leaflet-popup-close-button");
    if (!close) throw new Error("Popup has no close button");
    fireEvent.click(close);
    await waitFor(() => expect(container.querySelector(".leaflet-site-popup")).toBeNull());
    fireEvent.mouseOver(await markerButton(container));
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-tooltip")).toHaveTextContent(PIN.name),
    );
  });

  it("refits the untouched overview on resize so both edge sites remain visible", async () => {
    const dimensions = { width: 640, height: 440 };
    const { container, map } = await sizedOverview(dimensions);
    const overviewZoom = map.getZoom();
    dimensions.width = 320;
    map.invalidateSize({ animate: false });
    await Promise.resolve();
    expect(map.getZoom()).toBeLessThan(overviewZoom);
    await waitFor(() =>
      expect(container.querySelectorAll(".leaflet-site-marker button")).toHaveLength(2),
    );
  });

  it.each(["pan", "zoom"] as const)(
    "preserves a manually changed %s when resized",
    async (gesture) => {
      const dimensions = { width: 640, height: 440 };
      const { map } = await sizedOverview(dimensions);
      if (gesture === "pan") map.panBy([80, 40], { animate: false });
      else map.setZoom(map.getZoom() + 1, { animate: false });
      const manualCenter = map.getCenter();
      const manualZoom = map.getZoom();
      dimensions.width = 320;
      map.invalidateSize({ animate: false });
      await Promise.resolve();
      expect(map.getZoom()).toBe(manualZoom);
      expect(
        map.project(map.getCenter()).distanceTo(map.project(manualCenter)),
      ).toBeLessThanOrEqual(1);
    },
  );

  it("keeps the shop as a named hover landmark without a click action", async () => {
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[PIN]}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    const siteButton = await markerButton(container);
    expect(siteButton).toHaveAccessibleName(PIN.name);
    const shop = container.querySelector(".leaflet-shop-marker [role=img]");
    expect(shop).toHaveAccessibleName("Blue Mantis");
    expect(shop).toHaveAttribute("tabindex", "0");
    expect(container.querySelector(".leaflet-shop-marker button")).toBeNull();
    if (!(shop instanceof HTMLElement)) throw new Error("Shop landmark did not mount");
    fireEvent.mouseOver(shop);
    await waitFor(() =>
      expect(container.querySelector(".leaflet-tooltip")).toHaveTextContent("Blue Mantis"),
    );
    fireEvent.click(shop);
    expect(container.querySelector(".leaflet-popup")).toBeNull();
  });

  it.each(["site", "cluster"] as const)(
    "does not let %s pointer activation focus the map or scroll the page",
    async (role) => {
      const { container } = render(
        <SiteMap
          center={CENTER}
          pins={role === "site" ? [PIN] : [PIN, { ...PIN, id: "nearby" }]}
          shopAnchor={null}
          clusterLabel="dive sites"
        />,
      );
      const selector = {
        site: ".leaflet-site-marker button",
        cluster: "button.leaflet-site-cluster",
      }[role];
      await waitFor(() => expect(container.querySelector(selector)).not.toBeNull());
      const button = container.querySelector(selector);
      const map = container.querySelector(".leaflet-container");
      if (!(button instanceof HTMLButtonElement) || !(map instanceof HTMLElement)) {
        throw new Error("Map target did not mount");
      }
      const focus = vi.spyOn(map, "focus");
      const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
      button.focus();
      fireEvent.mouseDown(button, { button: 0 });
      fireEvent.mouseUp(button, { button: 0 });

      expect(focus).not.toHaveBeenCalled();
      expect(scroll).not.toHaveBeenCalled();
      expect(button).toHaveFocus();
      fireEvent.click(button);
      if (role !== "cluster") expect(popup(container)).toBeInTheDocument();
    },
  );

  it("keeps a hostile-shaped site name inside its marker label", async () => {
    const name = '"><img src=x onerror="alert(1)"><span data-injected="yes">';
    const { container } = render(
      <SiteMap center={CENTER} pins={[{ ...PIN, name }]} clusterLabel="dive sites" />,
    );
    const button = await markerButton(container);
    expect(button).toHaveAttribute("aria-label", name);
    expect(container.querySelector("[data-injected], img[onerror]")).toBeNull();
  });

  it("renders site names and subtitles literally in the popup", async () => {
    const name = '<img src=x onerror="alert(1)"> Reef & <b>Friends</b>';
    const subtitle = '<svg onload="alert(2)"></svg> <a href="javascript:alert(3)">Bank</a>'; // diveday:allow-scroll-preservation: hostile test input.
    const { container } = render(
      <SiteMap center={CENTER} pins={[{ ...PIN, name, subtitle }]} clusterLabel="dive sites" />,
    );
    fireEvent.click(await markerButton(container));
    const content = popup(container);
    expect(content.querySelector("h2")?.textContent).toBe(name);
    expect(content.querySelector("p")?.textContent).toBe(subtitle);
    expect(content.querySelector("img, svg, b, [onerror], [onload]")).toBeNull();
    expect(content.querySelectorAll("a")).toHaveLength(1);
  });

  it.each(["name", "fallback"])("renders the shop %s literally", async (source) => {
    const label = '<img src=x onerror="alert(1)"> Blue & <b>Mantis</b>';
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[]}
        shopAnchor={{ ...CENTER, name: source === "name" ? label : undefined }}
        shopLabel={label}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() => expect(container.querySelector(".leaflet-shop-marker")).not.toBeNull());
    const anchor = container.querySelector(".leaflet-shop-marker");
    if (!anchor) throw new Error("Shop marker did not mount");
    const button = anchor.querySelector("[role=img]");
    if (!button) throw new Error("Shop landmark did not mount");
    expect(button).toHaveAttribute("aria-label", label);
    fireEvent.mouseOver(button);
    await waitFor(() =>
      expect(container.querySelector(".leaflet-tooltip")).toHaveTextContent(label),
    );
    expect(
      container.querySelector(".leaflet-tooltip img, .leaflet-tooltip b, [onerror]"),
    ).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " \tjava\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ])("omits an unsafe details link: %s", async (href) => {
    const { container } = render(
      <SiteMap center={CENTER} pins={[{ ...PIN, href }]} clusterLabel="dive sites" />,
    );
    fireEvent.click(await markerButton(container));
    const content = popup(container);
    expect(content.querySelector("h2")?.textContent).toBe(PIN.name);
    expect(content.querySelector("a")).toBeNull();
  });

  it.each([
    PIN.href,
    "https://example.com/reef?q=a&b=c",
    "http://example.com/reef",
    '/reef?name=" onclick="alert(1)',
  ])("preserves a normal details link and map selection: %s", async (href) => {
    const onSelectPin = vi.fn();
    const { container, rerender } = render(
      <SiteMap
        center={CENTER}
        pins={[{ ...PIN, href }]}
        onSelectPin={onSelectPin}
        clusterLabel="dive sites"
      />,
    );
    const button = await markerButton(container);
    expect(button).toHaveAttribute("aria-label", PIN.name);
    fireEvent.keyPress(button, { key: "Enter", keyCode: 13, charCode: 13 });
    fireEvent.click(button);
    expect(onSelectPin).toHaveBeenCalledTimes(1);
    expect(onSelectPin).toHaveBeenCalledWith(PIN.id);
    const link = popup(container).querySelector("a");
    expect(link).toHaveAttribute("href", href ?? "");
    expect(link).toHaveTextContent("Open site →");
    expect(link).not.toHaveAttribute("onclick");
    rerender(
      <SiteMap
        center={CENTER}
        pins={[{ ...PIN, href }]}
        selectedPinId={PIN.id}
        onSelectPin={onSelectPin}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-marker button")).toHaveClass("ring-4"),
    );
    expect(popup(container).querySelector("h2")?.textContent).toBe(PIN.name);
    await waitFor(() => expect(container.querySelectorAll(".leaflet-site-popup")).toHaveLength(1));
  });

  it("shows the site name and useful facts on hover", async () => {
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[{ ...PIN, details: ["12–18 m", "Beginner"] }]}
        clusterLabel="dive sites"
      />,
    );
    fireEvent.mouseOver(await markerButton(container));
    await waitFor(() => {
      expect(container.querySelector(".leaflet-tooltip")?.textContent).toContain(PIN.name);
      expect(container.querySelector(".leaflet-tooltip")?.textContent).toContain(
        "12–18 m · Beginner",
      );
      expect(container.querySelector(".leaflet-tooltip")?.textContent).not.toContain(PIN.subtitle);
    });
  });

  it("keeps a selected popup mounted through synchronous auto-pan and lets it close", async () => {
    const L = await import("leaflet");
    const dimensions = { width: 640, height: 440 };
    const getContainer = vi.spyOn(L.Map.prototype, "getContainer");
    // Supply the layout metrics jsdom cannot measure; Leaflet performs the
    // projection, popup positioning, auto-pan and event dispatch itself.
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
    vi.spyOn(L.Map.prototype, "panBy").mockImplementation(function (
      this: LeafletMap,
      offset,
      options,
    ) {
      return originalPanBy.call(this, offset, { ...options, animate: false });
    });
    const events = vi.spyOn(L.Map.prototype, "fire");
    const { container } = render(
      <>
        <button type="button" data-outside-map>
          Outside the map
        </button>
        <SiteMap center={CENTER} pins={[PIN]} selectedPinId={PIN.id} clusterLabel="dive sites" />
      </>,
    );
    await markerButton(container);
    await waitFor(() => expect(popup(container).querySelector("h2")).toHaveTextContent(PIN.name));
    const eventNames = events.mock.calls.map(([name]) => name);
    const autoPanIndex = eventNames.indexOf("autopanstart");
    expect(autoPanIndex).toBeGreaterThan(-1);
    expect(eventNames.indexOf("moveend", autoPanIndex)).toBeLessThan(
      eventNames.indexOf("popupopen"),
    );
    expect(eventNames.filter((name) => name === "popupopen")).toHaveLength(1);
    expect(eventNames.filter((name) => name === "popupclose")).toHaveLength(0);

    const map = getContainer.mock.contexts[0];
    if (!(map instanceof L.Map)) throw new Error("Leaflet map did not mount");
    const popupElement = container.querySelector(".leaflet-site-popup");
    if (!(popupElement instanceof HTMLElement)) throw new Error("Popup did not mount");
    const selectedButton = container.querySelector(".leaflet-site-marker button");
    const outside = container.querySelector("[data-outside-map]");
    if (!(outside instanceof HTMLButtonElement)) throw new Error("Outside control did not mount");
    outside.focus();
    dimensions.width = 600;
    map.invalidateSize({ animate: false });
    await Promise.resolve();
    expect(outside).toHaveFocus();
    map.panBy([-120, 0], { animate: false });
    const focusedLink = popup(container).querySelector("a");
    if (!(focusedLink instanceof HTMLAnchorElement)) throw new Error("Popup details did not mount");
    focusedLink.focus();
    expect(focusedLink).toHaveFocus();
    dimensions.width = 320;
    map.invalidateSize({ animate: false });
    await Promise.resolve();
    const position = map.layerPointToContainerPoint(L.DomUtil.getPosition(popupElement));
    const left = position.x + Number.parseFloat(popupElement.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + popupElement.offsetWidth).toBeLessThanOrEqual(dimensions.width);
    const top =
      position.y - popupElement.offsetHeight - Number.parseFloat(popupElement.style.bottom);
    // The two 44px zoom targets occupy x10..54, y10..98. Their names and
    // popup content must remain readable together after a desktop-to-phone resize.
    const overlapsZoomControls =
      left < 54 &&
      left + popupElement.offsetWidth > 10 &&
      top < 98 &&
      top + popupElement.offsetHeight > 10;
    expect(overlapsZoomControls).toBe(false);
    expect(container.querySelector(".leaflet-site-popup")).toBe(popupElement);
    expect(container.querySelector(".leaflet-site-marker button")).toBe(selectedButton);
    expect(focusedLink).toHaveFocus();

    const close = container.querySelector(".leaflet-popup-close-button");
    if (!(close instanceof HTMLElement)) throw new Error("Popup close button did not mount");
    fireEvent.click(close);
    await Promise.resolve();
    expect(container.querySelector(".leaflet-site-popup")).toBeNull();
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-marker button")).not.toHaveClass("ring-4"),
    );
    dimensions.width = 640;
    map.invalidateSize({ animate: false });
    await Promise.resolve();
    expect(container.querySelector(".leaflet-site-popup")).toBeNull();
  });

  it("keeps every clustered site reachable without overlapping the shop target", async () => {
    const L = await import("leaflet");
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 640 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("leaflet-container") ? 440 : 0;
    });
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[PIN, { ...PIN, id: "neighbor" }]}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-site-cluster")).toHaveAccessibleName("2 dive sites"),
    );
    const cluster = container.querySelector(".leaflet-site-cluster-marker");
    const shop = container.querySelector(".leaflet-shop-marker");
    if (!(cluster instanceof HTMLElement)) throw new Error("Cluster marker did not mount");
    expect(shop).toBeInstanceOf(HTMLElement);
    if (shop instanceof HTMLElement) {
      // Leaflet supplies both actual projected centers, independent of
      // jsdom's absent CSS layout. Their 44px/32px targets need 38px clearance.
      expect(
        L.DomUtil.getPosition(cluster).distanceTo(L.DomUtil.getPosition(shop).add([0, -48])),
      ).toBeGreaterThanOrEqual(38);
    }
  });

  it("keeps clustered site labels literal at maximum zoom", async () => {
    const name = '<img src=x onerror="alert(1)"> Reef & <b>Friends</b>';
    const subtitle = '<b onmouseover="alert(2)">Bank</b>';
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[
          { ...PIN, name, subtitle },
          { ...PIN, id: "neighbor", name: "Nearby reef" },
        ]}
        clusterLabel="dive sites"
      />,
    );
    const clusterButton = async () => {
      await waitFor(() => expect(container.querySelector(".leaflet-site-cluster")).not.toBeNull());
      const button = container.querySelector(".leaflet-site-cluster");
      if (!(button instanceof HTMLButtonElement)) throw new Error("Cluster button did not mount");
      return button;
    };

    // Coincident coordinates are already at the maximum overview zoom.
    const button = await clusterButton();
    expect(button).toHaveAccessibleName("2 dive sites");
    fireEvent.click(button);
    const content = popup(container);
    expect(content.querySelector(".leaflet-site-cluster-card__name")?.textContent).toBe(name);
    expect(content.querySelector(".leaflet-site-cluster-card__location")?.textContent).toBe(
      subtitle,
    );
    expect(content.querySelector("img, b, [onerror], [onmouseover]")).toBeNull();
  });
});
