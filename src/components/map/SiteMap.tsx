"use client";

import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { cartoTileUrl } from "@/lib/carto";

export type MapPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  subtitle?: string | null;
  href?: string;
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
}: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());

  // Initialize the Leaflet map once on mount
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

      L.tileLayer(cartoTileUrl("light_all"), {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
        subdomains: "abcd",
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
        setMapInstance(null);
      }
    };
  }, [center.latitude, center.longitude, zoom]);

  // Update shop anchor and pins whenever they or the selected pin change
  useEffect(() => {
    if (!mapInstance) return;

    let isCancelled = false;
    import("leaflet").then((L) => {
      if (isCancelled || !mapRef.current) return;

      // Clear previous markers
      markersRef.current.forEach((marker) => {
        marker.remove();
      });
      markersRef.current.clear();

      // Plot shop anchor if provided
      if (shopAnchor) {
        const shopButton = document.createElement("button");
        shopButton.type = "button";
        shopButton.className =
          "flex items-center justify-center size-8 rounded-full bg-foreground text-surface shadow-md ring-2 ring-surface border border-border";
        shopButton.setAttribute("aria-label", shopAnchor.name || shopLabel);
        // Native buttons activate on click; Leaflet also opens popups on Enter keypress.
        shopButton.addEventListener("keypress", (event) => event.stopPropagation());
        const shopSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        shopSvg.setAttribute("class", "size-4");
        shopSvg.setAttribute("viewBox", "0 0 24 24");
        shopSvg.setAttribute("fill", "none");
        shopSvg.setAttribute("stroke", "currentColor");
        shopSvg.setAttribute("stroke-width", "2");
        shopSvg.setAttribute("stroke-linecap", "round");
        shopSvg.setAttribute("stroke-linejoin", "round");
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
        shopSvg.append(circle, line, path);
        shopButton.append(shopSvg);
        const shopIcon = L.divIcon({
          html: shopButton,
          className: "leaflet-shop-marker",
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -18],
        });
        const shopMarker = L.marker([shopAnchor.latitude, shopAnchor.longitude], {
          icon: shopIcon,
          keyboard: false,
          zIndexOffset: 500,
        }).addTo(mapInstance);

        const shopPopup = document.createElement("strong");
        shopPopup.textContent = shopAnchor.name || shopLabel;
        shopMarker.bindPopup(shopPopup);
      }

      // Plot site pins
      pins.forEach((pin) => {
        const isSelected = pin.id === selectedPinId;
        const colorClass =
          pin.tone === "warning"
            ? "bg-warning-strong text-surface"
            : pin.tone === "primary"
              ? "bg-primary text-surface"
              : "bg-surface text-foreground";

        const ringClass = isSelected
          ? "ring-4 ring-primary scale-110 z-50"
          : "ring-2 ring-surface hover:scale-105";

        const pinButton = document.createElement("button");
        pinButton.type = "button";
        pinButton.className = `group flex items-center justify-center size-7 rounded-full ${colorClass} shadow-md border border-border transition-transform ${ringClass}`;
        pinButton.setAttribute("aria-label", pin.name);
        pinButton.addEventListener("keypress", (event) => event.stopPropagation());
        const pinSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        pinSvg.setAttribute("class", "size-3.5");
        pinSvg.setAttribute("viewBox", "0 0 24 24");
        pinSvg.setAttribute("fill", "currentColor");
        const pinPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pinPath.setAttribute(
          "d",
          "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
        );
        pinSvg.append(pinPath);
        pinButton.append(pinSvg);

        const icon = L.divIcon({
          html: pinButton,
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

        const popupContent = document.createElement("div");
        popupContent.className = "space-y-1";
        const name = document.createElement("p");
        name.className = "font-medium text-sm";
        name.textContent = pin.name;
        popupContent.append(name);
        if (pin.subtitle) {
          const subtitle = document.createElement("p");
          subtitle.className = "text-xs text-muted";
          subtitle.textContent = pin.subtitle;
          popupContent.append(subtitle);
        }
        if (pin.href) {
          const link = document.createElement("a");
          link.setAttribute("href", pin.href);
          // Browser URL parsing handles relative links and obfuscated schemes alike.
          if (link.protocol === "http:" || link.protocol === "https:") {
            link.className = "inline-block mt-1 text-xs text-primary font-medium hover:underline";
            link.textContent = "View details →";
            popupContent.append(link);
          }
        }
        marker.bindPopup(popupContent);

        marker.on("click", () => {
          if (onSelectPin) {
            onSelectPin(pin.id);
          }
        });

        markersRef.current.set(pin.id, marker);

        if (isSelected) {
          marker.openPopup();
        }
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [mapInstance, pins, selectedPinId, shopAnchor, shopLabel, onSelectPin]);

  // Center on selected pin if changed
  useEffect(() => {
    if (!selectedPinId || !mapInstance) return;
    const pin = pins.find((p) => p.id === selectedPinId);
    if (pin) {
      mapInstance.panTo([pin.latitude, pin.longitude], { animate: true });
      const marker = markersRef.current.get(selectedPinId);
      if (marker && !marker.isPopupOpen()) {
        marker.openPopup();
      }
    }
  }, [selectedPinId, pins, mapInstance]);

  return <div ref={containerRef} className={className} />;
}
