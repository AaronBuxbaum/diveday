"use client";

import { type ReactNode, useState } from "react";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";
import { QuietSiteMap } from "./QuietSiteMap";

export function SiteLibraryLayout({
  shopAnchor,
  viewportStorageKey,
  pins,
  clusterLabel,
  children,
}: {
  shopAnchor: ShopAnchor | null;
  viewportStorageKey?: string;
  pins: MapPin[];
  clusterLabel: string;
  children: ReactNode;
}) {
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const defaultCenter = shopAnchor
    ? { latitude: shopAnchor.latitude, longitude: shopAnchor.longitude }
    : pins[0]
      ? { latitude: pins[0].latitude, longitude: pins[0].longitude }
      : { latitude: 25.0117, longitude: -80.4223 };

  // **The list first, the map under it** (visual review 2026-10-24, A35):
  // the sites are what a staffer came to open; the map is a second reading of
  // the same rows, in a 16:9 box on a muted ground that stays empty while the
  // map library loads.
  return (
    <div className="mt-6 flex flex-col gap-8">
      <div className="min-w-0 w-full">{children}</div>
      <div className="aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-surface-sunken">
        <QuietSiteMap
          viewportStorageKey={viewportStorageKey}
          center={defaultCenter}
          zoom={11}
          shopAnchor={shopAnchor}
          pins={pins}
          clusterLabel={clusterLabel}
          selectedPinId={selectedPinId}
          onSelectPin={setSelectedPinId}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
