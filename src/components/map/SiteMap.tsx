"use client";

import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { mapTileLayer } from "@/lib/carto";
import { clusterMapPoints, mapTargetIsVisible, separateShopAnchor } from "./map-clustering";

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
}: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());
  const lastFitRef = useRef<{ map: LeafletMap; coordinates: string } | null>(null);
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

      const map = L.map(containerRef.current, {
        center: [center.latitude, center.longitude],
        zoom,
        zoomControl: true,
        attributionControl: false,
      });

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
        mapRef.current.remove();
        mapRef.current = null;
        lastFitRef.current = null;
        setMapInstance(null);
      }
    };
  }, [center.latitude, center.longitude, zoom]);

  // Fit the complete data set once, then let map gestures control the viewport.
  useEffect(() => {
    if (!mapInstance || allCoordinates.length === 0) return;

    const coordinateKey = allCoordinates
      .map(([latitude, longitude]) => `${String(latitude)},${String(longitude)}`)
      .join(";");
    if (
      lastFitRef.current?.map === mapInstance &&
      lastFitRef.current.coordinates === coordinateKey
    ) {
      return;
    }

    lastFitRef.current = { map: mapInstance, coordinates: coordinateKey };
    if (allCoordinates.length === 1) {
      mapInstance.setView(allCoordinates[0], Math.min(mapInstance.getZoom(), zoom), {
        animate: false,
      });
      return;
    }

    mapInstance.fitBounds(allCoordinates, { padding: [68, 68], maxZoom: 11 });
  }, [allCoordinates, mapInstance, zoom]);

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
      const { groups, showShopAnchor } = separateShopAnchor(
        clusterMapPoints(visiblePoints, selectedPinId),
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
      if (
        shopAnchor &&
        showShopAnchor &&
        (!inViewport ||
          mapTargetIsVisible(
            mapInstance.latLngToContainerPoint([shopAnchor.latitude, shopAnchor.longitude]),
            32,
            mapSize,
            controlRectangles,
          ))
      ) {
        markersRef.current.set("shop-anchor", addShopMarker(L, mapInstance, shopAnchor, shopLabel));
      }
      groups.forEach((group, groupIndex) => {
        const pin = group[0];
        if (!pin) return;
        const isSelected = pin.id === selectedPinId;
        const position: [number, number] = [pin.latitude, pin.longitude];
        if (
          inViewport &&
          !isSelected &&
          !mapTargetIsVisible(
            mapInstance.latLngToContainerPoint(position),
            group.length > 1 ? 58 : 32,
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
          marker.on("click", () => {
            const currentZoom = mapInstance.getZoom();
            const maximumZoom = mapInstance.getMaxZoom();
            const targetZoom = Math.min(maximumZoom < 0 ? 19 : maximumZoom, currentZoom + 3);
            if (targetZoom > currentZoom) {
              mapInstance.fitBounds(
                group.map((pin) => [pin.latitude, pin.longitude] as [number, number]),
                { padding: [36, 36], maxZoom: targetZoom },
              );
              return;
            }

            marker
              .bindPopup(createClusterPopup(group, clusterLabel), {
                className: "leaflet-site-cluster-popup",
                maxWidth: 360,
              })
              .openPopup();
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
        const icon = L.divIcon({
          html: createSiteButton(pin, colorClass, ringClass),
          className: "leaflet-site-marker",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -16],
        });
        const marker = L.marker([pin.latitude, pin.longitude], {
          icon,
          keyboard: false,
          zIndexOffset: isSelected ? 1000 : 100,
        }).addTo(mapInstance);

        marker.bindPopup(createSitePopup(pin), {
          className: "leaflet-site-popup",
          maxWidth: 320,
        });
        marker.bindTooltip(createSiteTooltip(pin), {
          direction: "top",
          offset: [0, -12],
          opacity: 1,
          className: "leaflet-site-tooltip",
        });
        marker.on("click", () => onSelectPin?.(pin.id));
        markersRef.current.set(`site:${pin.id}`, marker);
        if (isSelected && openSelectedPopup) marker.openPopup();
      });
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
      if (!popupOpen) scheduleRender();
    };
    const handleResize = () => {
      markersRef.current.forEach((marker) => {
        if (marker.isPopupOpen()) marker.getPopup()?.update();
      });
    };
    const handlePopupOpen = () => {
      popupOpen = true;
    };
    const handlePopupClose = () => {
      popupOpen = false;
      if (!isClearingMarkers) scheduleRender();
    };

    import("leaflet").then((L) => {
      if (isCancelled || mapRef.current !== mapInstance) return;
      leaflet = L;
      mapInstance.on("zoomend moveend", handleViewEnd);
      mapInstance.on("resize", handleResize);
      mapInstance.on("popupopen", handlePopupOpen);
      mapInstance.on("popupclose", handlePopupClose);
      renderMarkers(L, true);
    });

    return () => {
      isCancelled = true;
      mapInstance.off("zoomend moveend", handleViewEnd);
      mapInstance.off("resize", handleResize);
      mapInstance.off("popupopen", handlePopupOpen);
      mapInstance.off("popupclose", handlePopupClose);
    };
  }, [clusterLabel, mapInstance, onSelectPin, pins, selectedPinId, shopAnchor, shopLabel]);

  // Selecting a site moves only the map. It never scrolls the page to the list.
  useEffect(() => {
    if (!selectedPinId || !mapInstance) return;
    const pin = pins.find((candidate) => candidate.id === selectedPinId);
    if (!pin) return;

    const position: [number, number] = [pin.latitude, pin.longitude];
    if (!mapInstance.getBounds().contains(position)) {
      mapInstance.panTo(position, { animate: true });
    }
    const marker = markersRef.current.get(`site:${selectedPinId}`);
    if (marker && !marker.isPopupOpen()) marker.openPopup();
  }, [mapInstance, pins, selectedPinId]);

  return <div ref={containerRef} className={className} />;
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
): LeafletMarker {
  const icon = L.divIcon({
    html: createShopButton(anchor.name || label),
    className: "leaflet-shop-marker",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
  const marker = L.marker([anchor.latitude, anchor.longitude], {
    icon,
    keyboard: false,
    zIndexOffset: 500,
  }).addTo(map);
  const popup = document.createElement("strong");
  popup.textContent = anchor.name || label;
  return marker.bindPopup(popup);
}

function createShopButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "flex items-center justify-center size-8 rounded-full bg-foreground text-surface shadow-md ring-2 ring-surface border border-border";
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
  button.className = `group flex items-center justify-center size-7 rounded-full ${colorClass} shadow-md border border-border transition-transform ${ringClass}`;
  button.setAttribute("aria-label", pin.name);
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("keypress", (event) => event.stopPropagation());

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "size-3.5");
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

  if (pin.subtitle) {
    const subtitle = document.createElement("span");
    subtitle.className = "leaflet-site-tooltip__location";
    subtitle.textContent = pin.subtitle;
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
