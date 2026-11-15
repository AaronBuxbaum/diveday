"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Switch } from "@/components/ui/Switch";

type MapArea = { south: number; west: number; north: number; east: number };

/** The `?area=` value for a rectangle; `parseMapArea` reads it back server-side. */
const areaParam = (a: MapArea) =>
  [a.south, a.west, a.north, a.east].map((value) => value.toFixed(4)).join(",");

/** How long the map holds still before the list follows it. */
const FOLLOW_DELAY_MS = 350;

/**
 * **Filter by map**, for both views: while it is on, the list narrows to what
 * the map is looking at, a moment after the map settles. `baseHref` is this
 * view's URL with every other choice kept and no `area`/`page`.
 */
export function useMapFollow({ scoped, baseHref }: { scoped: boolean; baseHref: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
  const toggle = (next: boolean) => {
    setFollowing(next);
    if (timer.current) clearTimeout(timer.current);
    go(next ? latestArea.current : null);
  };
  return { following, toggle, onViewChange };
}

/** The switch, drawn on the map's own corner rather than under it. */
export function FilterByMapSwitch({
  following,
  onToggle,
  label,
  count,
}: {
  following: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  /** How many sites are in view, said only while the switch is on. */
  count?: string;
}) {
  return (
    // Above Leaflet's own panes and controls, which stack up to 1000.
    <div className="absolute end-3 top-3 z-[1000]">
      <Switch
        className="shadow-md"
        checked={following}
        onChange={onToggle}
        label={
          <span>
            {label}
            {following && count ? (
              <span className="ms-2 font-normal text-muted">{count}</span>
            ) : null}
          </span>
        }
      />
    </div>
  );
}
