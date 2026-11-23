"use client";

import { useEffect, useRef } from "react";
import { createInteractiveMap } from "./modifier-wheel-map";

/** Street-readable: a block or two around the dock fills a phone-wide card. */
export const ARRIVAL_MAP_ZOOM = 16;

export function ArrivalMapCanvas({
  title,
  center,
}: {
  title: string;
  center: readonly [number, number];
}) {
  const ref = useRef<HTMLElement>(null);
  const [latitude, longitude] = center;
  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      map = createInteractiveMap(L, ref.current, {
        center: [latitude, longitude],
        zoom: ARRIVAL_MAP_ZOOM,
        zoomControl: true,
        privateMap: true,
      });
      L.circleMarker([latitude, longitude], { radius: 8 }).addTo(map);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [latitude, longitude]);
  return <section ref={ref} aria-label={title} className="h-full w-full" />;
}
