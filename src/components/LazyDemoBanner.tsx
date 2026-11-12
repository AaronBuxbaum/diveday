"use client";

import dynamic from "next/dynamic";

/**
 * **The demo banner, loaded on its own.**
 *
 * The root `not-found.tsx` reaches `PublicShopShell`, so it is in every route's
 * client graph, and a static import of `DemoBanner` put the banner, its role
 * picker and its start strip on the floor every diver pays
 * (`scripts/perf-budget.mjs`). Only the demo shop renders it. Behind
 * `next/dynamic` it is a chunk of its own, server-rendered and preloaded where
 * it shows, fetched by no other page. A Client Component because `next/dynamic`
 * only splits a Client Component's import.
 */
export const LazyDemoBanner = dynamic(() =>
  import("./DemoBanner").then((module) => module.DemoBanner),
);
