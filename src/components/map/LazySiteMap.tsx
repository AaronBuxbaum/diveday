"use client";

import dynamic from "next/dynamic";
import type { SiteMapProps } from "./SiteMap";

/**
 * Dynamic client-only wrapper for Leaflet SiteMap.
 * Keeps Leaflet's window dependency out of SSR.
 */
export const LazySiteMap = dynamic(() => import("./SiteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface-sunken/40 text-muted">
      <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  ),
});
