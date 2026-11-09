"use client";

import { type ReactNode, useMemo, useState } from "react";
import { LazySiteMap } from "@/components/map/LazySiteMap";
import type { MapPin, MapPinDetails, ShopAnchor } from "@/components/map/SiteMap";

import type { CatalogMapPin } from "../catalog-map-pins";

export function CatalogMapLayout({
  shopAnchor,
  viewportStorageKey,
  pins: compactPins,
  catalogPageHref,
  openSiteLabel,
  loadDetails,
  detailWords,
  clusterLabel,
  children,
}: {
  shopAnchor: ShopAnchor | null;
  viewportStorageKey?: string;
  pins: CatalogMapPin[];
  catalogPageHref: string;
  openSiteLabel: string;
  loadDetails: (slug: string) => Promise<MapPinDetails | null>;
  detailWords: { loading: string; unavailable: string };
  clusterLabel: string;
  children: ReactNode;
}) {
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const pins = useMemo(
    () =>
      compactPins.map(
        ({ slug, ...pin }): MapPin => ({
          ...pin,
          href: `${catalogPageHref}&template=${encodeURIComponent(slug)}`,
          hrefLabel: openSiteLabel,
          tone: "primary",
        }),
      ),
    [compactPins, catalogPageHref, openSiteLabel],
  );
  // Only successful detail reads are retained, for this revision's pin set.
  const loadPinDetails = useMemo(() => {
    const details = new Map<string, Promise<MapPinDetails | null>>();
    return (id: string) => {
      const pin = compactPins.find((candidate) => candidate.id === id);
      if (!pin) return Promise.resolve(null);
      let pending = details.get(id);
      if (!pending) {
        pending = loadDetails(pin.slug)
          .then((result) => {
            if (!result) details.delete(id);
            return result;
          })
          .catch((error: unknown) => {
            details.delete(id);
            throw error;
          });
        details.set(id, pending);
      }
      return pending;
    };
  }, [compactPins, loadDetails]);

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
              viewportStorageKey={viewportStorageKey}
              center={defaultCenter}
              zoom={10}
              shopAnchor={shopAnchor}
              pins={pins}
              loadPinDetails={loadPinDetails}
              pinDetailsWords={detailWords}
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
