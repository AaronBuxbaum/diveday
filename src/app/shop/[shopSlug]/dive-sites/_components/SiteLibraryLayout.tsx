"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { MapPin, ShopAnchor } from "@/components/map/SiteMap";
import { Switch } from "@/components/ui/Switch";
import { QuietSiteMap } from "./QuietSiteMap";

type MapArea = { south: number; west: number; north: number; east: number };

/** The `?area=` value for a rectangle; `parseMapArea` reads it back server-side. */
const areaParam = (a: MapArea) =>
  [a.south, a.west, a.north, a.east].map((value) => value.toFixed(4)).join(",");

/** How long the map holds still before the list follows it. */
const FOLLOW_DELAY_MS = 350;

export function SiteLibraryLayout({
  shopAnchor,
  viewportStorageKey,
  pins,
  clusterLabel,
  catalog,
  followLabel,
  scoped,
  baseHref,
  children,
}: {
  shopAnchor: ShopAnchor | null;
  viewportStorageKey?: string;
  pins: MapPin[];
  clusterLabel: string;
  catalog?: ReactNode;
  /** The words beside the switch that makes the list follow the map. */
  followLabel: string;
  /** Whether the list is currently narrowed to the map's area (`?area=`). */
  scoped: boolean;
  /** The library's URL with every other choice kept and no `area`/`page`. */
  baseHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [following, setFollowing] = useState(scoped);
  const latestArea = useRef<MapArea | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setFollowing(scoped), [scoped]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const go = useCallback(
    (area: MapArea | null) => {
      const joiner = baseHref.includes("?") ? "&" : "?";
      const href = area ? `${baseHref}${joiner}area=${areaParam(area)}` : baseHref;
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [baseHref, router],
  );

  // The map reports every settle; the list only listens while the switch is on.
  const followingRef = useRef(following);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  const onViewChange = useCallback(
    (area: MapArea) => {
      latestArea.current = area;
      if (!followingRef.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => go(area), FOLLOW_DELAY_MS);
    },
    [go],
  );

  const defaultCenter = shopAnchor
    ? { latitude: shopAnchor.latitude, longitude: shopAnchor.longitude }
    : pins[0]
      ? { latitude: pins[0].latitude, longitude: pins[0].longitude }
      : { latitude: 25.0117, longitude: -80.4223 };

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div>
        <div className="h-[440px] w-full overflow-hidden rounded-xl border border-border bg-surface-sunken sm:h-[540px] lg:h-[620px]">
          <QuietSiteMap
            viewportStorageKey={viewportStorageKey}
            center={defaultCenter}
            zoom={11}
            shopAnchor={shopAnchor}
            pins={pins}
            clusterLabel={clusterLabel}
            selectedPinId={selectedPinId}
            onSelectPin={setSelectedPinId}
            onViewChange={onViewChange}
            className="h-full w-full"
          />
        </div>
        <Switch
          className="mt-3"
          checked={following}
          label={followLabel}
          onChange={(next) => {
            setFollowing(next);
            if (timer.current) clearTimeout(timer.current);
            go(next ? latestArea.current : null);
          }}
        />
      </div>
      <div className="min-w-0 w-full">
        {catalog}
        {children}
      </div>
    </div>
  );
}
