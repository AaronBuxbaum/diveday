"use client";

import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { mapTileLayer } from "@/lib/carto";
import { clusterMapPoints, mapTargetIsVisible, separateShopAnchor } from "./map-clustering";
import { labelRectangle, placeMapLabel, rectanglesOverlap } from "./map-label-placement";
import { mapCoordinateKey, readMapViewport, writeMapViewport } from "./map-viewport-storage";

export type MapPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  subtitle?: string | null;
  details?: string[];
  description?: string | null;
  href?: string;
  hrefLabel?: string;
  tone?: "primary" | "warning" | "default";
};

export type ShopAnchor = {
  latitude: number;
  longitude: number;
  name?: string;
};

export type SiteMapProps = {
  center: { latitude: number; longitude: number };
  zoom?: number;
  shopAnchor?: ShopAnchor | null;
  pins: MapPin[];
  selectedPinId?: string | null;
  onSelectPin?: (id: string | null) => void;
  className?: string;
  shopLabel?: string;
  clusterLabel: string;
  viewportStorageKey?: string;
};

type FittedOverview = {
  map: LeafletMap;
  coordinates: string;
  center: ReturnType<LeafletMap["getCenter"]>;
  zoom: number;
};

const pinPath =
  "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

export default function SiteMap({
  center,
  zoom = 11,
  shopAnchor,
  pins,
  selectedPinId,
  onSelectPin,
  className = "h-full w-full",
  shopLabel = "Dive shop",
  clusterLabel,
  viewportStorageKey,
}: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());
  const lastFitRef = useRef<FittedOverview | null>(null);
  /** The pins a restored camera was saved against; the overview refits once they change. */
  const restoredViewRef = useRef<string | null>(null);
  const [activePinId, setActivePinId] = useState(selectedPinId ?? null);
  const activePinIdRef = useRef(selectedPinId ?? null);
  useEffect(() => {
    activePinIdRef.current = selectedPinId ?? null;
    setActivePinId(selectedPinId ?? null);
  }, [selectedPinId]);
  const allCoordinates = useMemo(() => {
    const coordinates: [number, number][] = [];
    if (shopAnchor) coordinates.push([shopAnchor.latitude, shopAnchor.longitude]);
    coordinates.push(...pins.map((pin): [number, number] => [pin.latitude, pin.longitude]));
    return coordinates;
  }, [pins, shopAnchor]);
  const coordinateKey = useMemo(() => mapCoordinateKey(allCoordinates), [allCoordinates]);
  // Read by the save paths, which outlive the render that set them up.
  const coordinateKeyRef = useRef(coordinateKey);
  coordinateKeyRef.current = coordinateKey;

  // Initialize Leaflet once the client component has mounted.
  useEffect(() => {
    if (!containerRef.current) return;
    let isCancelled = false;

    import("leaflet").then((L) => {
      if (isCancelled || !containerRef.current) return;
      if (mapRef.current) return;

      const savedView = viewportStorageKey
        ? readMapViewport(viewportStorageKey, coordinateKeyRef.current)
        : null;
      restoredViewRef.current = savedView ? coordinateKeyRef.current : null;
      const map = L.map(containerRef.current, {
        center: savedView
          ? [savedView.latitude, savedView.longitude]
          : [center.latitude, center.longitude],
        zoom: savedView?.zoom ?? zoom,
        zoomControl: true,
        attributionControl: false,
      });

      map.createPane("shopAnchor").style.zIndex = "750";
      map.createPane("shopTooltip").style.zIndex = "760";
      L.control.attribution({ prefix: false }).addTo(map);

      const tileLayer = mapTileLayer("light_all");
      L.tileLayer(tileLayer.url, {
        attribution:
          tileLayer.provider === "carto"
            ? '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
            : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      setMapInstance(map);
    });

    return () => {
      isCancelled = true;
      if (mapRef.current) {
        if (viewportStorageKey) {
          persistMapView(mapRef.current, viewportStorageKey, coordinateKeyRef.current);
        }
        mapRef.current.remove();
        markersRef.current.clear();
        mapRef.current = null;
        lastFitRef.current = null;
        setMapInstance(null);
      }
    };
  }, [center.latitude, center.longitude, viewportStorageKey, zoom]);

  useOverviewFit({
    mapInstance,
    allCoordinates,
    coordinateKey,
    zoom,
    lastFitRef,
    markersRef,
    restoredViewRef,
  });
  useViewportSaving(mapInstance, mapRef, viewportStorageKey, coordinateKeyRef);

  // Render only pins near the viewport and cluster close points to keep marker
  // work proportional to the visible map while retaining every site in bounds.
  useEffect(() => {
    if (!mapInstance) return;

    let isCancelled = false;
    let updateQueued = false;
    let isClearingMarkers = false;
    let popupOpen = false;
    let leaflet: typeof import("leaflet") | null = null;

    const clearMarkers = () => {
      isClearingMarkers = true;
      try {
        mapInstance.closePopup();
        markersRef.current.forEach((marker) => {
          marker.remove();
        });
        markersRef.current.clear();
      } finally {
        isClearingMarkers = false;
      }
    };

    const updateShop = () =>
      updateShopMarkerPosition(
        mapInstance,
        markersRef.current.get("shop-anchor"),
        markersRef.current.values(),
      );

    const renderMarkers = (L: typeof import("leaflet"), openSelectedPopup = false) => {
      if (isCancelled || mapRef.current !== mapInstance) return;
      clearMarkers();

      const visibleBounds = mapInstance.getBounds().pad(0.35);
      const mapSize = mapInstance.getSize();
      const inViewport = mapSize.x > 0 && mapSize.y > 0;
      const controlRectangles = mapControlRectangles(mapInstance.getContainer());
      const visiblePoints = pins
        .filter((pin) => !inViewport || visibleBounds.contains([pin.latitude, pin.longitude]))
        .map((pin) => {
          const projected = mapInstance.project(
            [pin.latitude, pin.longitude],
            mapInstance.getZoom(),
          );
          return { pin, x: projected.x, y: projected.y };
        });

      const shopPoint =
        shopAnchor && inViewport
          ? mapInstance.project([shopAnchor.latitude, shopAnchor.longitude], mapInstance.getZoom())
          : null;
      const { groups } = separateShopAnchor(
        clusterMapPoints(visiblePoints, activePinIdRef.current),
        visiblePoints,
        shopPoint,
        (pin) =>
          mapTargetIsVisible(
            mapInstance.latLngToContainerPoint([pin.latitude, pin.longitude]),
            58,
            mapSize,
            controlRectangles,
          ),
      );
      // Geographic shop/site/cluster positions and their distinct roles do
      // not form a uniform control row. Size, focus and overlap rules still apply.
      if (shopAnchor) {
        markersRef.current.set(
          "shop-anchor",
          addShopMarker(L, mapInstance, shopAnchor, shopLabel, markersRef.current),
        );
      }
      groups.forEach((group, groupIndex) => {
        const pin = group[0];
        if (!pin) return;
        const isSelected = pin.id === activePinIdRef.current;
        const position: [number, number] = [pin.latitude, pin.longitude];
        if (
          inViewport &&
          !isSelected &&
          !mapTargetIsVisible(
            mapInstance.latLngToContainerPoint(position),
            58,
            mapSize,
            controlRectangles,
          )
        ) {
          return;
        }

        if (group.length > 1) {
          const count = group.length;
          const label = `${count} ${clusterLabel}`;
          const icon = L.divIcon({
            html: createClusterButton(count, label),
            className: "leaflet-site-cluster-marker",
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          });
          // The first point is a real representative with clear target
          // spacing; averaging positions would put neighbors together again.
          const marker = L.marker(position, {
            icon,
            keyboard: false,
            autoPanOnFocus: false,
            zIndexOffset: 600,
          }).addTo(mapInstance);
          const tooltip = document.createElement("span");
          tooltip.textContent = label;
          marker.bindTooltip(tooltip, {
            direction: "top",
            offset: [0, -15],
            opacity: 1,
            className: "leaflet-site-tooltip",
          });
          bindTooltipFocus(marker, "button");
          marker.on("click", () => openMapCluster(L, mapInstance, marker, group, clusterLabel));
          markersRef.current.set(`cluster:${groupIndex}`, marker);
          return;
        }

        const colorClass =
          pin.tone === "warning"
            ? "bg-warning-strong text-surface"
            : pin.tone === "primary"
              ? "bg-primary text-surface"
              : "bg-surface text-foreground";
        const ringClass = isSelected
          ? "ring-4 ring-primary scale-110 z-50"
          : "ring-2 ring-surface hover:scale-105";
        const icon = L.divIcon({
          html: createSiteButton(pin, colorClass, ringClass),
          className: "leaflet-site-marker",
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          popupAnchor: [0, -24],
        });
        const marker = L.marker([pin.latitude, pin.longitude], {
          icon,
          keyboard: false,
          autoPanOnFocus: false,
          zIndexOffset: isSelected ? 1000 : 100,
        }).addTo(mapInstance);

        marker.bindPopup(createSitePopup(pin), {
          className: "leaflet-site-popup",
          maxWidth: 320,
          autoPanPaddingTopLeft: [12, 110],
          autoPanPaddingBottomRight: [12, 12],
        });
        marker.bindTooltip(createSiteTooltip(pin), {
          direction: "top",
          offset: [0, -12],
          opacity: 1,
          className: "leaflet-site-tooltip",
        });
        bindTooltipFocus(marker, "button");
        marker.on("click", () => {
          activePinIdRef.current = pin.id;
          setActivePinId(pin.id);
          onSelectPin?.(pin.id);
        });
        markersRef.current.set(`site:${pin.id}`, marker);
        if (isSelected && openSelectedPopup) marker.openPopup();
      });
      updateShop();
    };

    const scheduleRender = () => {
      if (updateQueued) return;
      updateQueued = true;
      queueMicrotask(() => {
        updateQueued = false;
        // Leaflet can emit moveend during auto-pan before popupopen. Check
        // again here so that queued work cannot clear the popup it just opened.
        if (leaflet && !isCancelled && !popupOpen) renderMarkers(leaflet);
      });
    };

    const handleViewEnd = () => {
      updateShop();
      if (!popupOpen) scheduleRender();
    };
    const handleSelect = () => {
      if (leaflet) renderMarkers(leaflet, true);
    };
    const handleResize = () => {
      updateShop();
      markersRef.current.forEach(updateOpenPopup);
    };
    const handlePopupOpen = () => {
      popupOpen = true;
    };
    const handlePopupClose = () => {
      popupOpen = false;
      if (!isClearingMarkers) {
        activePinIdRef.current = null;
        setActivePinId(null);
        onSelectPin?.(null);
        scheduleRender();
      }
    };

    import("leaflet").then((L) => {
      if (isCancelled || mapRef.current !== mapInstance) return;
      leaflet = L;
      mapInstance.on("zoomend moveend", handleViewEnd);
      mapInstance.on("resize", handleResize);
      mapInstance.on("siteselect", handleSelect);
      mapInstance.on("popupopen", handlePopupOpen);
      mapInstance.on("popupclose", handlePopupClose);
      renderMarkers(L, true);
    });

    return () => {
      isCancelled = true;
      mapInstance.off("zoomend moveend", handleViewEnd);
      mapInstance.off("resize", handleResize);
      mapInstance.off("siteselect", handleSelect);
      mapInstance.off("popupopen", handlePopupOpen);
      mapInstance.off("popupclose", handlePopupClose);
    };
  }, [clusterLabel, mapInstance, onSelectPin, pins, shopAnchor, shopLabel]);

  // Selecting a site moves only the map. It never scrolls the page to the list.
  useEffect(() => {
    if (!mapInstance) return;
    activePinIdRef.current = activePinId;
    selectMapPin(mapInstance, pins, activePinId, markersRef.current);
  }, [activePinId, mapInstance, pins]);

  return <div ref={containerRef} className={className} />;
}

function openMapCluster(
  L: typeof import("leaflet"),
  map: LeafletMap,
  marker: LeafletMarker,
  group: MapPin[],
  clusterLabel: string,
) {
  const currentZoom = map.getZoom();
  const maximumZoom = map.getMaxZoom();
  const targetZoom = Number.isFinite(maximumZoom) && maximumZoom >= 0 ? maximumZoom : 19;
  if (currentZoom < targetZoom) {
    const bounds = L.latLngBounds(group.map((pin) => [pin.latitude, pin.longitude]));
    const fittedZoom = map.getBoundsZoom(bounds, false, L.point(96, 96));
    if (fittedZoom <= currentZoom) {
      map.setView(bounds.getCenter(), Math.min(targetZoom, currentZoom + 1));
    } else {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: targetZoom });
    }
    return;
  }

  marker
    .bindPopup(createClusterPopup(group, clusterLabel), {
      className: "leaflet-site-cluster-popup",
      maxWidth: 360,
      autoPanPaddingTopLeft: [12, 110],
      autoPanPaddingBottomRight: [12, 12],
    })
    .openPopup();
}

function selectMapPin(
  map: LeafletMap,
  pins: MapPin[],
  activePinId: string | null,
  markers: ReadonlyMap<string, LeafletMarker>,
) {
  // Preserve the marker and its open card when only selection changes. Closing
  // and recreating it would leave Leaflet's fading old popup beside the new one.
  markers.forEach((marker, key) => {
    if (!key.startsWith("site:")) return;
    const selected = key === `site:${activePinId}`;
    marker.setZIndexOffset(selected ? 1000 : 100);
    const button = marker.getElement()?.querySelector("button");
    for (const className of ["ring-4", "ring-primary", "scale-110", "z-50"]) {
      button?.classList.toggle(className, selected);
    }
    for (const className of ["ring-2", "ring-surface", "hover:scale-105"]) {
      button?.classList.toggle(className, !selected);
    }
  });
  if (!activePinId) return;
  const pin = pins.find((candidate) => candidate.id === activePinId);
  if (!pin) return;

  const position: [number, number] = [pin.latitude, pin.longitude];
  if (!map.getBounds().contains(position)) {
    map.panTo(position, { animate: true });
  }
  const marker = markers.get(`site:${activePinId}`);
  if (marker) {
    if (!marker.isPopupOpen()) marker.openPopup();
  } else {
    // A list can select a site that currently belongs to a cluster.
    map.fire("siteselect");
  }
}

/**
 * Keep the untouched overview fitted as its container changes size. A restored camera holds
 * until the pins differ from the ones it was saved against.
 */
function useOverviewFit({
  mapInstance,
  allCoordinates,
  coordinateKey,
  zoom,
  lastFitRef,
  markersRef,
  restoredViewRef,
}: {
  mapInstance: LeafletMap | null;
  allCoordinates: [number, number][];
  coordinateKey: string;
  zoom: number;
  lastFitRef: { current: FittedOverview | null };
  markersRef: { current: Map<string, LeafletMarker> };
  restoredViewRef: { current: string | null };
}) {
  useEffect(() => {
    if (!mapInstance || allCoordinates.length === 0) return;
    if (restoredViewRef.current !== null) {
      if (restoredViewRef.current === coordinateKey) return;
      restoredViewRef.current = null;
    }
    return keepOverviewFitted(
      mapInstance,
      allCoordinates,
      coordinateKey,
      zoom,
      lastFitRef,
      markersRef.current,
    );
  }, [allCoordinates, coordinateKey, mapInstance, zoom, lastFitRef, markersRef, restoredViewRef]);
}

/** Save the camera, with the pins it was taken against, on every settled move and on unmount. */
function useViewportSaving(
  mapInstance: LeafletMap | null,
  mapRef: { current: LeafletMap | null },
  viewportStorageKey: string | undefined,
  coordinateKeyRef: { current: string },
) {
  useEffect(() => {
    if (!mapInstance || !viewportStorageKey) return;
    const saveView = () => {
      if (mapRef.current === mapInstance) {
        persistMapView(mapInstance, viewportStorageKey, coordinateKeyRef.current);
      }
    };
    saveView();
    mapInstance.on("moveend", saveView);
    return () => {
      saveView();
      mapInstance.off("moveend", saveView);
    };
  }, [mapInstance, mapRef, viewportStorageKey, coordinateKeyRef]);
}

function persistMapView(map: LeafletMap, key: string, coordinates: string) {
  const position = map.getCenter();
  writeMapViewport(
    key,
    { latitude: position.lat, longitude: position.lng, zoom: map.getZoom() },
    coordinates,
  );
}

function updateOpenPopup(marker: LeafletMarker) {
  if (!marker.isPopupOpen()) return;
  const popup = marker.getPopup();
  if (!popup) return;
  const focused = document.activeElement;
  const restoreFocus = focused instanceof HTMLElement && popup.getElement()?.contains(focused);
  // Public update reattaches DOM content while measuring its resized layout.
  // Keep the same keyboard target, without scrolling or taking outside focus.
  popup.update();
  if (restoreFocus && focused.isConnected) focused.focus({ preventScroll: true });
}

function keepOverviewFitted(
  map: LeafletMap,
  coordinates: [number, number][],
  coordinateKey: string,
  zoom: number,
  lastFit: { current: FittedOverview | null },
  markers: ReadonlyMap<string, LeafletMarker>,
) {
  const fitOverview = () => {
    if (coordinates.length === 1) {
      map.setView(coordinates[0], Math.min(map.getZoom(), zoom), { animate: false });
    } else {
      map.fitBounds(coordinates, { padding: [68, 68], maxZoom: 11, animate: false });
    }
    lastFit.current = {
      map,
      coordinates: coordinateKey,
      center: map.getCenter(),
      zoom: map.getZoom(),
    };
  };
  if (lastFit.current?.map !== map || lastFit.current.coordinates !== coordinateKey) fitOverview();

  const resize = () => {
    const overview = lastFit.current;
    if (!overview || overview.map !== map || map.getZoom() !== overview.zoom) return;
    // Leaflet rounds container centers to pixels during invalidateSize.
    // Preserve a user's pan/zoom, and let the open popup's own update pan it.
    const drift = map
      .project(map.getCenter(), overview.zoom)
      .distanceTo(map.project(overview.center, overview.zoom));
    if (drift > 1 || Array.from(markers.values()).some((marker) => marker.isPopupOpen())) return;
    fitOverview();
  };
  map.on("resize", resize);
  return () => {
    map.off("resize", resize);
  };
}

function mapControlRectangles(container: HTMLElement) {
  const mapRectangle = container.getBoundingClientRect();
  return Array.from(container.querySelectorAll(".leaflet-control"))
    .map((control) => control.getBoundingClientRect())
    .filter((control) => control.width > 0 && control.height > 0)
    .map((control) => ({
      left: control.left - mapRectangle.left,
      right: control.right - mapRectangle.left,
      top: control.top - mapRectangle.top,
      bottom: control.bottom - mapRectangle.top,
    }));
}

function addShopMarker(
  L: typeof import("leaflet"),
  map: LeafletMap,
  anchor: ShopAnchor,
  label: string,
  markers: ReadonlyMap<string, LeafletMarker>,
): LeafletMarker {
  const icon = L.divIcon({
    html: createShopLandmark(anchor.name || label),
    className: "leaflet-shop-marker",
    iconSize: [44, 44],
    iconAnchor: [22, 70],
  });
  const marker = L.marker([anchor.latitude, anchor.longitude], {
    icon,
    keyboard: false,
    pane: "shopAnchor",
    autoPanOnFocus: false,
    zIndexOffset: 2000,
  }).addTo(map);
  const tooltip = document.createElement("span");
  tooltip.textContent = anchor.name || label;
  marker.bindTooltip(tooltip, {
    pane: "shopTooltip",
    direction: "top",
    offset: [0, -68],
    opacity: 1,
    className: "leaflet-site-tooltip leaflet-shop-tooltip",
  });
  marker.on("tooltipopen", () => updateShopMarkerPosition(map, marker, markers.values()));
  bindTooltipFocus(marker, "[role=img]");
  updateShopMarkerPosition(map, marker);
  return marker;
}

function updateShopMarkerPosition(
  map: LeafletMap,
  marker?: LeafletMarker,
  markers: Iterable<LeafletMarker> = [],
) {
  const element = marker?.getElement();
  if (!marker || !element) return;
  const point = map.latLngToContainerPoint(marker.getLatLng());
  const size = map.getSize();
  const controls = mapControlRectangles(map.getContainer());
  const targets = [...controls];
  for (const layer of markers) {
    if (layer === marker) continue;
    const target = layer.getElement();
    if (
      !target?.classList.contains("leaflet-site-marker") &&
      !target?.classList.contains("leaflet-site-cluster-marker")
    )
      continue;
    targets.push(labelRectangle(map.latLngToContainerPoint(layer.getLatLng()), { x: 58, y: 58 }));
  }
  const badge = placeMapLabel({ x: point.x, y: point.y - 48 }, { x: 44, y: 44 }, size, targets);
  const dx = badge.x - point.x;
  const dy = badge.y - point.y;
  element.style.marginLeft = `${dx - 22}px`;
  element.style.marginTop = `${dy - 22}px`;
  element.style.setProperty("--shop-stem-length", `${Math.hypot(dx, dy)}px`);
  element.style.setProperty("--shop-stem-angle", `${Math.atan2(dx, -dy)}rad`);
  const tooltip = marker.getTooltip();
  if (tooltip) {
    const content = tooltip.getElement();
    const tooltipSize = { x: content?.offsetWidth ?? 0, y: content?.offsetHeight ?? 0 };
    const above = placeMapLabel(
      { x: badge.x, y: badge.y - 26 - tooltipSize.y / 2 },
      tooltipSize,
      size,
      [],
    );
    const aboveRectangle = labelRectangle(above, tooltipSize);
    const fitsAbove =
      aboveRectangle.bottom <= badge.y - 22 &&
      !controls.some((control) => rectanglesOverlap(aboveRectangle, control));
    const position = placeMapLabel(
      fitsAbove ? above : { x: badge.x, y: badge.y + 26 + tooltipSize.y / 2 },
      tooltipSize,
      size,
      controls,
    );
    tooltip.options.direction = "center";
    tooltip.options.offset = [position.x - point.x, position.y - point.y];
    if (marker.isTooltipOpen()) tooltip.update();
  }
}

function bindTooltipFocus(marker: LeafletMarker, selector: string) {
  const target = marker.getElement()?.querySelector<HTMLElement>(selector);
  target?.addEventListener("focus", () => marker.openTooltip());
  target?.addEventListener("blur", () => marker.closeTooltip());
}

function createShopLandmark(label: string): HTMLSpanElement {
  const button = document.createElement("span");
  button.setAttribute("role", "img");
  button.tabIndex = 0;
  button.className =
    "leaflet-shop-landmark flex items-center justify-center size-11 rounded-full bg-foreground text-surface shadow-md ring-2 ring-surface border border-border";
  button.setAttribute("aria-label", label);
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("keypress", (event) => event.stopPropagation());

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "size-4");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "5");
  circle.setAttribute("r", "3");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "12");
  line.setAttribute("y1", "22");
  line.setAttribute("x2", "12");
  line.setAttribute("y2", "8");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 12H2a10 10 0 0 0 20 0h-3");
  svg.append(circle, line, path);
  button.append(svg);
  return button;
}

function createSiteButton(pin: MapPin, colorClass: string, ringClass: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `group flex items-center justify-center size-11 rounded-full ${colorClass} shadow-md border border-border transition-transform ${ringClass}`;
  button.setAttribute("aria-label", pin.name);
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("keypress", (event) => event.stopPropagation());

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "size-5");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pinPath);
  svg.append(path);
  button.append(svg);
  return button;
}

function createClusterButton(count: number, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "leaflet-site-cluster";
  button.setAttribute("aria-label", label);
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("keypress", (event) => event.stopPropagation());
  const countLabel = document.createElement("span");
  countLabel.textContent = String(count);
  button.append(countLabel);
  return button;
}

function createSiteTooltip(pin: MapPin): HTMLDivElement {
  const tooltip = document.createElement("div");
  const name = document.createElement("span");
  name.className = "leaflet-site-tooltip__name";
  name.textContent = pin.name;
  tooltip.append(name);

  if (pin.details?.length) {
    const subtitle = document.createElement("span");
    subtitle.className = "leaflet-site-tooltip__location";
    subtitle.textContent = pin.details.join(" · ");
    tooltip.append(subtitle);
  }

  return tooltip;
}

function createSitePopup(pin: MapPin): HTMLElement {
  const article = document.createElement("article");
  article.className = "leaflet-site-card";
  const body = document.createElement("div");
  body.className = "leaflet-site-card__body";

  const title = document.createElement("h2");
  title.className = "leaflet-site-card__title";
  title.textContent = pin.name;
  body.append(title);

  if (pin.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "leaflet-site-card__location";
    subtitle.textContent = pin.subtitle;
    body.append(subtitle);
  }

  const details = (pin.details ?? []).filter(Boolean);
  if (details.length > 0) {
    const facts = document.createElement("ul");
    facts.className = "leaflet-site-card__facts";
    for (const detail of details) {
      const fact = document.createElement("li");
      fact.className = "leaflet-site-card__fact";
      fact.textContent = detail;
      facts.append(fact);
    }
    body.append(facts);
  }

  if (pin.description) {
    const description = document.createElement("p");
    description.className = "leaflet-site-card__description";
    description.textContent = pin.description;
    body.append(description);
  }

  article.append(body);
  const href = safeHref(pin.href);
  if (href && pin.hrefLabel) {
    const link = document.createElement("a");
    link.href = href;
    link.className = "leaflet-site-card__link";
    link.textContent = pin.hrefLabel;
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = " →";
    link.append(arrow);
    article.append(link);
  }

  return article;
}

function createClusterPopup(pins: MapPin[], clusterLabel: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "leaflet-site-cluster-card";
  const title = document.createElement("h2");
  title.className = "leaflet-site-cluster-card__title";
  title.textContent = `${pins.length} ${clusterLabel}`;
  section.append(title);

  const list = document.createElement("ul");
  list.className = "leaflet-site-cluster-card__list";
  for (const pin of pins) {
    const item = document.createElement("li");
    item.className = "leaflet-site-cluster-card__item";

    const href = safeHref(pin.href);
    if (href) {
      const name = document.createElement("a");
      name.href = href;
      name.className = "leaflet-site-cluster-card__name";
      name.textContent = pin.name;
      item.append(name);
    } else {
      const name = document.createElement("span");
      name.className = "leaflet-site-cluster-card__name";
      name.textContent = pin.name;
      item.append(name);
    }

    if (pin.subtitle) {
      const subtitle = document.createElement("span");
      subtitle.className = "leaflet-site-cluster-card__location";
      subtitle.textContent = pin.subtitle;
      item.append(subtitle);
    }

    const details = (pin.details ?? []).filter(Boolean);
    if (details.length > 0) {
      const facts = document.createElement("span");
      facts.className = "leaflet-site-cluster-card__facts";
      facts.textContent = details.join(" · ");
      item.append(facts);
    }

    list.append(item);
  }

  section.append(list);
  return section;
}

function safeHref(href?: string): string | null {
  if (!href) return null;
  const anchor = document.createElement("a");
  anchor.href = href;
  return anchor.protocol === "http:" || anchor.protocol === "https:" ? href : null;
}
