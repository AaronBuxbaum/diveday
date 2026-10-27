"use client";

import { type ReactNode, useState } from "react";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";
import { QuietSiteMap } from "./QuietSiteMap";

export function SiteLibraryLayout({
  shopAnchor,
  viewportStorageKey,
  pins,
  clusterLabel,
  catalog,
  children,
}: {
  shopAnchor: ShopAnchor | null;
  viewportStorageKey?: string;
  pins: MapPin[];
  clusterLabel: string;
  catalog?: ReactNode;
  children: ReactNode;
}) {
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const defaultCenter = shopAnchor
    ? { latitude: shopAnchor.latitude, longitude: shopAnchor.longitude }
    : pins[0]
      ? { latitude: pins[0].latitude, longitude: pins[0].longitude }
      : { latitude: 25.0117, longitude: -80.4223 };

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div className="h-[440px] w-full overflow-hidden rounded-xl border border-border bg-surface-sunken sm:h-[540px] lg:h-[620px] print:hidden">
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
      <div className="min-w-0 w-full">
        {catalog}
        {children}
      </div>
    </div>
  );
}
