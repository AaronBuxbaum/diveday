"use client";

import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBasemapMap } from "./leaflet-basemap";
import { clusterMapPoints, mapTargetIsVisible, separateShopAnchor } from "./map-clustering";
import { labelRectangle, placeMapLabel, rectanglesOverlap } from "./map-label-placement";
import {
  createClusterButton,
  createClusterPopup,
  createShopLandmark,
  createSiteButton,
  createSitePopup,
  createSiteTooltip,
} from "./map-markup";
import { clearMapViewport, readMapViewport, writeMapViewport } from "./map-viewport-storage";

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
  const restoredViewRef = useRef(false);
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

  // Initialize Leaflet once the client component has mounted.
  useEffect(() => {
    if (!containerRef.current) return;
    let isCancelled = false;

    import("leaflet").then((L) => {
      if (isCancelled || !containerRef.current) return;
      if (mapRef.current) return;

      const savedView = viewportStorageKey ? readMapViewport(viewportStorageKey) : null;
      restoredViewRef.current = savedView !== null;
      const map = createBasemapMap(L, containerRef.current, {
        center: savedView
          ? [savedView.latitude, savedView.longitude]
          : [center.latitude, center.longitude],
        zoom: savedView?.zoom ?? zoom,
        zoomControl: true,
        holdsCenter: () => !showsOverview(map, lastFitRef.current),
      });

      // The shop sits over the sites' pins and under every card: a site's
      // hover label and its open card (tooltips 650, popups 700) are read
      // over the shop's pin, never behind it. Its stem runs under the pins
      // (600), so a line to the shop never crosses a site (Aaron, 2026-10-23).
      map.createPane("shopAnchor").style.zIndex = "620";
      map.createPane("shopStem").style.zIndex = "590";

      mapRef.current = map;
      setMapInstance(map);
    });

    return () => {
      isCancelled = true;
      if (mapRef.current) {
        if (viewportStorageKey)
          persistMapView(mapRef.current, viewportStorageKey, lastFitRef, restoredViewRef);
        mapRef.current.remove();
        markersRef.current.clear();
        mapRef.current = null;
        lastFitRef.current = null;
        setMapInstance(null);
      }
    };
  }, [center.latitude, center.longitude, viewportStorageKey, zoom]);

  useOverviewAndCamera({
    mapInstance,
    mapRef,
    allCoordinates,
    zoom,
    viewportStorageKey,
    lastFitRef,
    restoredViewRef,
    markers: markersRef.current,
  });

  // Render only pins near the viewport and cluster close points to keep marker
  // work proportional to the visible map while retaining every site in bounds.
  useEffect(() => {
    if (!mapInstance) return;

    let isCancelled = false;
    let updateQueued = false;
    let isClearingMarkers = false;
    let isSelecting = false;
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
        markersRef.current.get("shop-stem"),
      );

    // A pin answers its own button's click, never Leaflet's: Leaflet drops a
    // click while it thinks the map was last dragged, and a pin's press never
    // reaches the map to tell it otherwise, so after any drag a pin could go
    // dead until the empty map was pressed (Aaron, 2026-10-22). The click stops
    // at the button, so Leaflet neither drops it nor toggles the card shut.
    const selectFromMap = (pinId: string, marker: LeafletMarker) => {
      isSelecting = true;
      try {
        activePinIdRef.current = pinId;
        marker.closeTooltip();
        marker.openPopup();
      } finally {
        isSelecting = false;
      }
      setActivePinId(pinId);
      onSelectPin?.(pinId);
    };

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
        markersRef.current.set("shop-stem", addShopStem(L, mapInstance, shopAnchor));
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
          const button = createClusterButton(count, label);
          const icon = L.divIcon({
            html: button,
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
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            openMapCluster(L, mapInstance, marker, group, clusterLabel);
          });
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
        const button = createSiteButton(pin, colorClass, ringClass);
        const icon = L.divIcon({
          html: button,
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
        // The open card already names the selected site; its hover label
        // would only cover the card.
        if (!isSelected) bindSiteTooltip(marker, pin);
        bindTooltipFocus(marker, "button");
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          selectFromMap(pin.id, marker);
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
      // Opening another site's card closes this one on the way; that is a
      // new selection, not a cleared one.
      if (!isClearingMarkers && !isSelecting) {
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
    if (selected) {
      marker.closeTooltip();
      marker.unbindTooltip();
    } else if (!marker.getTooltip()) {
      const pin = pins.find((candidate) => key === `site:${candidate.id}`);
      if (pin) bindSiteTooltip(marker, pin);
    }
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
 * Keep the untouched overview fitted as its container changes size, and keep
 * the reader's own camera, never a fit, for the next visit in this tab.
 */
function useOverviewAndCamera({
  mapInstance,
  mapRef,
  allCoordinates,
  zoom,
  viewportStorageKey,
  lastFitRef,
  restoredViewRef,
  markers,
}: {
  mapInstance: LeafletMap | null;
  mapRef: { current: LeafletMap | null };
  allCoordinates: [number, number][];
  zoom: number;
  viewportStorageKey: string | undefined;
  lastFitRef: { current: FittedOverview | null };
  restoredViewRef: { current: boolean };
  markers: ReadonlyMap<string, LeafletMarker>;
}) {
  useEffect(() => {
    if (!mapInstance || allCoordinates.length === 0 || restoredViewRef.current) return;
    // A fit without animation ends its move before it is recorded as the
    // overview, so the camera is settled again once it is: a fit is never kept.
    const settle = viewportStorageKey
      ? () => persistMapView(mapInstance, viewportStorageKey, lastFitRef, restoredViewRef)
      : undefined;
    return keepOverviewFitted(mapInstance, allCoordinates, zoom, lastFitRef, markers, settle);
  }, [allCoordinates, lastFitRef, mapInstance, markers, restoredViewRef, viewportStorageKey, zoom]);

  useEffect(() => {
    if (!mapInstance || !viewportStorageKey) return;
    const saveView = () => {
      if (mapRef.current === mapInstance) {
        persistMapView(mapInstance, viewportStorageKey, lastFitRef, restoredViewRef);
      }
    };
    saveView();
    mapInstance.on("moveend", saveView);
    return () => {
      saveView();
      mapInstance.off("moveend", saveView);
    };
  }, [lastFitRef, mapInstance, mapRef, restoredViewRef, viewportStorageKey]);
}

/**
 * Keep the reader's camera for the next visit in this tab, never the map's own
 * overview fit: a fit kept at one width came back at another (a desktop's zoom
 * on a phone) and, being "restored", was never fitted again, so most of the
 * shop's sites sat outside it. An untouched overview clears what an earlier
 * camera left, so the next visit fits its own container.
 */
function persistMapView(
  map: LeafletMap,
  key: string,
  lastFit: { current: FittedOverview | null },
  restoredView: { current: boolean },
) {
  const overview = lastFit.current;
  // A map left before it has fitted holds only its default camera, which nobody
  // chose; kept, it would come back "restored", never be fitted, and show the
  // few sites near that default. Only a restored camera has no overview to match.
  if (!overview && !restoredView.current) return;
  if (showsOverview(map, overview)) {
    clearMapViewport(key);
    return;
  }
  const position = map.getCenter();
  writeMapViewport(key, {
    latitude: position.lat,
    longitude: position.lng,
    zoom: map.getZoom(),
  });
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
  zoom: number,
  lastFit: { current: FittedOverview | null },
  markers: ReadonlyMap<string, LeafletMarker>,
  onFitted?: () => void,
) {
  const coordinateKey = coordinates
    .map(([latitude, longitude]) => `${String(latitude)},${String(longitude)}`)
    .join(";");
  const fitOverview = () => {
    if (coordinates.length === 1) {
      map.setView(coordinates[0], Math.min(map.getZoom(), zoom), { animate: false });
    } else {
      map.fitBounds(coordinates, { padding: [68, 68], animate: false });
    }
    lastFit.current = {
      map,
      coordinates: coordinateKey,
      center: map.getCenter(),
      zoom: map.getZoom(),
    };
    onFitted?.();
  };
  if (lastFit.current?.map !== map || lastFit.current.coordinates !== coordinateKey) fitOverview();

  const resize = () => {
    // Preserve a user's pan/zoom, and let the open popup's own update pan it.
    if (!showsOverview(map, lastFit.current)) return;
    if (Array.from(markers.values()).some((marker) => marker.isPopupOpen())) return;
    fitOverview();
  };
  map.on("resize", resize);
  return () => {
    map.off("resize", resize);
  };
}

/** Whether the map still shows the overview it last fitted, untouched by the reader. */
function showsOverview(map: LeafletMap, overview: FittedOverview | null): boolean {
  if (!overview || overview.map !== map || map.getZoom() !== overview.zoom) return false;
  // Leaflet rounds container centers to pixels during invalidateSize.
  const drift = map
    .project(map.getCenter(), overview.zoom)
    .distanceTo(map.project(overview.center, overview.zoom));
  return drift <= 1;
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
    iconAnchor: [22, 22],
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
    direction: "top",
    offset: [0, -68],
    opacity: 1,
    className: "leaflet-site-tooltip leaflet-shop-tooltip",
  });
  marker.on("tooltipopen", () =>
    updateShopMarkerPosition(map, marker, markers.values(), markers.get("shop-stem")),
  );
  bindTooltipFocus(marker, "[role=img]");
  updateShopMarkerPosition(map, marker, [], markers.get("shop-stem"));
  return marker;
}

/** The line from a shop badge pushed aside back to the shop's own spot. */
function addShopStem(
  L: typeof import("leaflet"),
  map: LeafletMap,
  anchor: ShopAnchor,
): LeafletMarker {
  return L.marker([anchor.latitude, anchor.longitude], {
    icon: L.divIcon({
      html: '<span class="leaflet-shop-stem__line"></span>',
      className: "leaflet-shop-stem",
      iconSize: [0, 0],
    }),
    interactive: false,
    keyboard: false,
    pane: "shopStem",
  }).addTo(map);
}

/**
 * Place the shop's badge on its own spot, or beside it when a pin or a control
 * is there, with a stem back only then. A shop off the map is not drawn at
 * all: a badge pinned to the edge read as a shop that was there (Aaron,
 * 2026-10-23).
 */
function updateShopMarkerPosition(
  map: LeafletMap,
  marker?: LeafletMarker,
  markers: Iterable<LeafletMarker> = [],
  stem?: LeafletMarker,
) {
  const element = marker?.getElement();
  if (!marker || !element) return;
  const stemElement = stem?.getElement();
  const point = map.latLngToContainerPoint(marker.getLatLng());
  const size = map.getSize();
  const onMap = point.x >= 0 && point.y >= 0 && point.x <= size.x && point.y <= size.y;
  element.style.display = onMap ? "" : "none";
  if (!onMap) {
    marker.closeTooltip();
    if (stemElement) stemElement.style.display = "none";
    return;
  }
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
  const badge = placeMapLabel(point, { x: 44, y: 44 }, size, targets);
  const dx = badge.x - point.x;
  const dy = badge.y - point.y;
  element.style.marginLeft = `${dx - 22}px`;
  element.style.marginTop = `${dy - 22}px`;
  if (stemElement) {
    // Only a badge moved off its spot needs a line back to it; one still
    // covering the spot (within its own radius) points at it already.
    const length = Math.hypot(dx, dy);
    stemElement.style.display = length <= 22 ? "none" : "";
    stemElement.style.marginLeft = `${dx}px`;
    stemElement.style.marginTop = `${dy}px`;
    stemElement.style.setProperty("--shop-stem-length", `${length}px`);
    stemElement.style.setProperty("--shop-stem-angle", `${Math.atan2(dx, -dy)}rad`);
  }
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

function bindSiteTooltip(marker: LeafletMarker, pin: MapPin) {
  marker.bindTooltip(createSiteTooltip(pin), {
    direction: "top",
    offset: [0, -12],
    opacity: 1,
    className: "leaflet-site-tooltip",
  });
}

function bindTooltipFocus(marker: LeafletMarker, selector: string) {
  const target = marker.getElement()?.querySelector<HTMLElement>(selector);
  target?.addEventListener("focus", () => marker.openTooltip());
  target?.addEventListener("blur", () => marker.closeTooltip());
}
