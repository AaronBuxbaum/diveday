// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Map as LeafletMap } from "leaflet";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import SiteMap, { type MapPin } from "./SiteMap";

beforeAll(async () => {
  await import("leaflet");
});
afterEach(() => {
  cleanup();
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

  it("gives each marker one named native button without an interactive wrapper", async () => {
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[PIN]}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    const siteButton = await markerButton(container);
    const shopMarker = container.querySelector(".leaflet-shop-marker");
    const siteMarker = container.querySelector(".leaflet-site-marker");
    expect(siteButton).toHaveAccessibleName(PIN.name);
    for (const marker of [siteMarker, shopMarker]) {
      expect(marker).not.toHaveAttribute("role", "button");
      expect(marker).not.toHaveAttribute("tabindex");
      expect(marker?.querySelectorAll("button")).toHaveLength(1);
    }
    expect(shopMarker?.querySelector("button")).toHaveAccessibleName("Blue Mantis");
  });

  it("opens the shop popup once for the native Enter activation sequence", async () => {
    const { container } = render(
      <SiteMap
        center={CENTER}
        pins={[]}
        shopAnchor={{ ...CENTER, name: "Blue Mantis" }}
        clusterLabel="dive sites"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".leaflet-shop-marker button")).not.toBeNull(),
    );
    const button = container.querySelector(".leaflet-shop-marker button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Shop button did not mount");
    fireEvent.keyPress(button, { key: "Enter", keyCode: 13, charCode: 13 });
    fireEvent.click(button);
    expect(popup(container).querySelector("strong")?.textContent).toBe("Blue Mantis");
  });

  it.each(["site", "shop", "cluster"] as const)(
    "does not let %s pointer activation focus the map or scroll the page",
    async (role) => {
      const { container } = render(
        <SiteMap
          center={CENTER}
          pins={role === "shop" ? [] : role === "site" ? [PIN] : [PIN, { ...PIN, id: "nearby" }]}
          shopAnchor={role === "shop" ? { ...CENTER, name: "Blue Mantis" } : null}
          clusterLabel="dive sites"
        />,
      );
      const selector = {
        site: ".leaflet-site-marker button",
        shop: ".leaflet-shop-marker button",
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
    const button = anchor.querySelector("button");
    if (!button) throw new Error("Shop button did not mount");
    expect(button).toHaveAttribute("aria-label", label);
    fireEvent.click(button);
    const content = popup(container);
    expect(content.querySelector("strong")?.textContent).toBe(label);
    expect(content.querySelector("img, b, [onerror]")).toBeNull();
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

  it("shows the site name and location on hover", async () => {
    const { container } = render(
      <SiteMap center={CENTER} pins={[PIN]} clusterLabel="dive sites" />,
    );
    fireEvent.mouseOver(await markerButton(container));
    await waitFor(() => {
      expect(container.querySelector(".leaflet-tooltip")?.textContent).toContain(PIN.name);
      expect(container.querySelector(".leaflet-tooltip")?.textContent).toContain(PIN.subtitle);
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
    expect(container.querySelector(".leaflet-site-popup")).toBe(popupElement);
    expect(container.querySelector(".leaflet-site-marker button")).toBe(selectedButton);
    expect(focusedLink).toHaveFocus();

    const close = container.querySelector(".leaflet-popup-close-button");
    if (!(close instanceof HTMLElement)) throw new Error("Popup close button did not mount");
    fireEvent.click(close);
    await Promise.resolve();
    expect(container.querySelector(".leaflet-site-popup")).toBeNull();
    expect(container.querySelector(".leaflet-site-marker button")).toHaveClass("ring-4");
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
    if (shop instanceof HTMLElement) {
      // Leaflet supplies both actual projected centers, independent of
      // jsdom's absent CSS layout. Their 44px/32px targets need 38px clearance.
      expect(
        L.DomUtil.getPosition(cluster).distanceTo(L.DomUtil.getPosition(shop)),
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

    // Three genuine cluster activations advance 11 -> 14 -> 17 -> 19; the
    // next activation opens the still-coincident sites' list.
    for (const _zoom of [14, 17, 19]) {
      const button = await clusterButton();
      expect(button).toHaveAccessibleName("2 dive sites");
      fireEvent.click(button);
      await waitFor(() => expect(button).not.toBeInTheDocument());
    }
    fireEvent.click(await clusterButton());
    const content = popup(container);
    expect(content.querySelector(".leaflet-site-cluster-card__name")?.textContent).toBe(name);
    expect(content.querySelector(".leaflet-site-cluster-card__location")?.textContent).toBe(
      subtitle,
    );
    expect(content.querySelector("img, b, [onerror], [onmouseover]")).toBeNull();
  });
});
