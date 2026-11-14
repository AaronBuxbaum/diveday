"use client";

import { useOnline } from "@/components/use-online";
import { ArrivalMapCanvas } from "./map/ArrivalMapCanvas";
import { useMapReachable } from "./use-map-reachable";

/** Show the map only when its basemap host is reachable and the device is online. */
export function ArrivalMap({
  title,
  query,
  zoomHint,
}: {
  title: string;
  query: string;
  zoomHint: string;
}) {
  const reachable = useMapReachable(true);
  const online = useOnline();
  if (!reachable || !online) return null;
  return (
    <div className="relative isolate mb-5 aspect-[16/9] overflow-hidden rounded-inset bg-surface-sunken print:hidden">
      <ArrivalMapCanvas title={title} query={query} />
      <p className="pointer-events-none absolute bottom-2 start-2 z-[400] rounded bg-surface px-2 py-1 text-xs text-muted">
        {zoomHint}
      </p>
    </div>
  );
}
