"use client";

import dynamic from "next/dynamic";

/**
 * **The idle-session guard for the 404 page, loaded on its own.**
 *
 * The root `not-found.tsx` is in every route's client graph, so a static import
 * of `StaffActivity` put the idle dialog on the floor every diver pays
 * (`scripts/perf-budget.mjs`). Only a signed-in staffer with an idle clock sees
 * it. A Client Component because `next/dynamic` only splits a Client Component's
 * import; the staff shell imports `StaffActivity` statically.
 */
export const LazyStaffActivity = dynamic(() =>
  import("./StaffActivity").then((module) => module.StaffActivity),
);
