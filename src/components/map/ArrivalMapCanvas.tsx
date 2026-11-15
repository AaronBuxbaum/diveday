"use client";

import { useEffect, useRef } from "react";
import { createInteractiveMap } from "./modifier-wheel-map";

/** OSM's former embed framed coordinate pairs and otherwise showed the world. */
export function arrivalCoordinates(query: string): [number, number] | null {
  const parts = query.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const [latitude, longitude] = parts as [number, number];
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? [latitude, longitude] : null;
}

export function ArrivalMapCanvas({ title, query }: { title: string; query: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      const coordinates = arrivalCoordinates(query);
      map = createInteractiveMap(L, ref.current, {
        center: coordinates ?? [0, 0],
        zoom: coordinates ? 15 : 1,
        zoomControl: true,
        privateMap: true,
      });
      if (coordinates) L.circleMarker(coordinates, { radius: 8 }).addTo(map);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [query]);
  return <section ref={ref} aria-label={title} className="h-full w-full" />;
}
