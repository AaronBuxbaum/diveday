"use client";

import { type ReactNode, useState } from "react";
import { LazySiteMap } from "@/components/map/LazySiteMap";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";

export function CatalogMapLayout({
  shopAnchor,
  pins,
  children,
}: {
  shopAnchor: ShopAnchor | null;
  pins: MapPin[];
  children: ReactNode;
}) {
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const defaultCenter = shopAnchor
    ? { latitude: shopAnchor.latitude, longitude: shopAnchor.longitude }
    : pins[0]
      ? { latitude: pins[0].latitude, longitude: pins[0].longitude }
      : { latitude: 25.0117, longitude: -80.4223 };

  const handleSelectPin = (id: string | null) => {
    setSelectedPinId(id);
    if (id && typeof document !== "undefined") {
      const row = document.getElementById(`template-row-${id}`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  };

  return (
    <div className="mt-8 flex flex-col gap-6 xl:grid xl:grid-cols-12 xl:items-start xl:gap-8">
      {/* Primary Map View */}
      <div className="xl:col-span-7">
        <div className="sticky top-(--chrome-h) overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="h-[360px] w-full sm:h-[460px] xl:h-[620px]">
            <LazySiteMap
              center={defaultCenter}
              zoom={10}
              shopAnchor={shopAnchor}
              pins={pins}
              selectedPinId={selectedPinId}
              onSelectPin={handleSelectPin}
              className="h-full w-full"
            />
          </div>
        </div>
      </div>

      {/* Companion Ledger */}
      <div className="min-w-0 xl:col-span-5">{children}</div>
    </div>
  );
}
