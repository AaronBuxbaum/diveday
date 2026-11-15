"use client";

import { type ReactNode, useState } from "react";
import { MapWheelHint } from "@/components/map/MapWheelHint";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";
import { QuietSiteMap } from "./QuietSiteMap";
import { FilterByMapSwitch, useMapFollow } from "./useMapFollow";

export function SiteLibraryLayout({
  shopAnchor,
  viewportStorageKey,
  pins,
  clusterLabel,
  zoomHint,
  views,
  followLabel,
  areaCount,
  scoped,
  baseHref,
  children,
}: {
  shopAnchor: ShopAnchor | null;
  viewportStorageKey?: string;
  pins: MapPin[];
  clusterLabel: string;
  zoomHint: string;
  views?: ReactNode;
  /** The words on the map's switch that makes the list follow it. */
  followLabel: string;
  /** How many sites the map's area holds, said beside the switch while it is on. */
  areaCount: string;
  /** Whether the list is currently narrowed to the map's area (`?area=`). */
  scoped: boolean;
  /** The library's URL with every other choice kept and no `area`/`page`. */
  baseHref: string;
  children: ReactNode;
}) {
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const follow = useMapFollow({ scoped, baseHref });

  const defaultCenter = shopAnchor
    ? { latitude: shopAnchor.latitude, longitude: shopAnchor.longitude }
    : pins[0]
      ? { latitude: pins[0].latitude, longitude: pins[0].longitude }
      : { latitude: 25.0117, longitude: -80.4223 };

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div
        data-testid="map-container"
        className="relative isolate h-[440px] w-full overflow-hidden rounded-xl border border-border bg-surface-sunken sm:h-[540px] lg:h-[620px]"
      >
        <MapWheelHint hint={zoomHint}>
          <QuietSiteMap
            viewportStorageKey={viewportStorageKey}
            center={defaultCenter}
            zoom={11}
            shopAnchor={shopAnchor}
            pins={pins}
            clusterLabel={clusterLabel}
            selectedPinId={selectedPinId}
            onSelectPin={setSelectedPinId}
            onViewChange={follow.onViewChange}
            className="h-full w-full"
          />
        </MapWheelHint>
        {views ? (
          <div className="absolute bottom-9 start-3 z-[1000] max-w-[calc(100%-1.5rem)]">
            {views}
          </div>
        ) : null}
        <FilterByMapSwitch
          following={follow.following}
          onToggle={follow.toggle}
          label={followLabel}
          count={areaCount}
        />
      </div>
      <div className="min-w-0 w-full">{children}</div>
    </div>
  );
}
