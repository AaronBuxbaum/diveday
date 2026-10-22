"use client";

import { type ReactNode, useState } from "react";
import { LazySiteMap } from "@/components/map/LazySiteMap";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";

export function CatalogMapLayout({
  shopAnchor,
  pins,
  clusterLabel,
  children,
}: {
  shopAnchor: ShopAnchor | null;
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

  return (
    <div className="mt-8 flex flex-col gap-8">
      {/* Primary Map View */}
      <div className="w-full">
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="h-[440px] w-full sm:h-[540px] lg:h-[620px]">
            <LazySiteMap
              center={defaultCenter}
              zoom={10}
              shopAnchor={shopAnchor}
              pins={pins}
              clusterLabel={clusterLabel}
              selectedPinId={selectedPinId}
              onSelectPin={setSelectedPinId}
              className="h-full w-full"
            />
          </div>
        </div>
      </div>

      {/* Companion Ledger */}
      <div className="min-w-0 w-full">{children}</div>
    </div>
  );
}
