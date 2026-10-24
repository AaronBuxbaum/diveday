"use client";

import dynamic from "next/dynamic";

/**
 * The library's map, client-only like `LazySiteMap`, with nothing drawn while
 * Leaflet loads (visual review 2026-10-24, A35): the box under the list keeps
 * its muted ground and no spinner turns in it.
 */
export const QuietSiteMap = dynamic(() => import("@/components/map/SiteMap"), {
  ssr: false,
  loading: () => null,
});
