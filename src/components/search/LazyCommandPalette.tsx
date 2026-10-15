"use client";

import dynamic from "next/dynamic";

/**
 * **The palette for a page outside the staff shell, loaded on its own.**
 *
 * The root `not-found.tsx` is in every route's client graph, so whatever it
 * imports statically is on the floor every diver and marketing page pays before
 * it paints. A static import of `CommandPalette` here put the staff palette,
 * its icons and the ledger's row menu in all 107 routes, 13.8 KB gzip (code
 * review 2026-10-13b, item 7). Behind `next/dynamic` it is a chunk of its own:
 * the staff 404 still renders it on the server and preloads it, and no other
 * page fetches it. `scripts/perf-budget.mjs` fails a build whose shared floor
 * carries the palette's markers again.
 *
 * A Client Component because `next/dynamic` only splits a Client Component's
 * import; the staff shell's bar imports the palette statically, since every
 * staff page shows it at once.
 */
export const LazyCommandPalette = dynamic(() =>
  import("./CommandPalette").then((module) => module.CommandPalette),
);
