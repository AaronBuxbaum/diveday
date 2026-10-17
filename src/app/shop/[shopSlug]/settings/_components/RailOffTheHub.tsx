"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** `/shop/<slug>/settings` itself: the hub, which is already the whole map. */
const HUB_PATH = /^\/shop\/[^/]+\/settings\/?$/;

/**
 * **The rail only inside a setting** (fifth-loop ideas, item 58). On the hub
 * the rail listed the same rows as the page beside it, every row twice; there
 * the page is the map. Inside a setting the rail is the way across, so it
 * stays.
 */
export function RailOffTheHub({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return HUB_PATH.test(pathname ?? "") ? null : children;
}

export function isSettingsHubPath(pathname: string): boolean {
  return HUB_PATH.test(pathname);
}
