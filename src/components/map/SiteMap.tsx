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
        const shopIconHtml = `
          <div class="flex items-center justify-center size-8 rounded-full bg-foreground text-surface shadow-md ring-2 ring-surface border border-border">
            <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="5" r="3" />
              <line x1="12" y1="22" x2="12" y2="8" />
              <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
            </svg>
          </div>
        `;
        const shopIcon = L.divIcon({
          html: shopIconHtml,
          className: "leaflet-shop-marker",
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -18],
        });
        const shopMarker = L.marker([shopAnchor.latitude, shopAnchor.longitude], {
          icon: shopIcon,
          zIndexOffset: 500,
        }).addTo(mapInstance);

        shopMarker.bindPopup(`<strong>${shopAnchor.name || shopLabel}</strong>`);
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

        const pinHtml = `
          <button type="button" class="group flex items-center justify-center size-7 rounded-full ${colorClass} shadow-md border border-border transition-transform ${ringClass}" aria-label="${pin.name}">
            <svg class="size-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </button>
        `;

        const icon = L.divIcon({
          html: pinHtml,
          className: "leaflet-site-marker",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -16],
        });

        const marker = L.marker([pin.latitude, pin.longitude], {
          icon,
          zIndexOffset: isSelected ? 1000 : 100,
        }).addTo(mapInstance);

        const popupContent = `
          <div class="space-y-1">
            <p class="font-medium text-sm">${pin.name}</p>
            ${pin.subtitle ? `<p class="text-xs text-muted">${pin.subtitle}</p>` : ""}
            ${pin.href ? `<a href="${pin.href}" class="inline-block mt-1 text-xs text-primary font-medium hover:underline">View details &rarr;</a>` : ""}
          </div>
        `;
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
