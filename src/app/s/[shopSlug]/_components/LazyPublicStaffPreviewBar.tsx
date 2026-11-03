"use client";

import dynamic from "next/dynamic";

/**
 * **The staff preview bar for a public page, loaded on its own.**
 *
 * The root `not-found.tsx` reaches `PublicShopShell`, so whatever the shell
 * imports statically is on the floor every route pays before it paints
 * (`scripts/perf-budget.mjs`). The bar is mounted only after the server's live
 * same-shop staff check; no diver should download it. Same split as
 * `LazyCommandPalette`: a Client Component because `next/dynamic` only splits a
 * Client Component's import.
 */
export const LazyPublicStaffPreviewBar = dynamic(() =>
  import("./PublicStaffPreviewBar").then((module) => module.PublicStaffPreviewBar),
);
