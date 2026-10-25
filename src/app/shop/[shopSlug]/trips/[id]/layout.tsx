import { notFound } from "next/navigation";
import { uuidParam } from "@/lib/uuid";
import { RehearsalBanner } from "./_components/RehearsalBanner";
import { TRIP_SHELL_CLASS } from "./_components/trip-shell";

// Restored after CI. ARCH-7 removed this as provably-unread by
// `isPageAllowedToBlock`, which stops at the outermost `instant` — the shop
// layout's. The reasoning still looks right and the build agreed, but three
// Playwright specs then went intermittently red on CI and never locally, two
// of them on a nested trip surface under this very layout, failing in
// hydration-shaped ways: a `?notice=` banner rendered twice in the DOM, and
// banners that were absent when asserted. That is one change too close to
// those symptoms to leave in on a safety-critical staff surface for the sake
// of deleting a line. Put back until someone can show the two are unrelated.
// See ADR 20260803-instant-opt-out-placement.
export const instant = false;

/**
 * One shell for every trip surface — Trip, Manifest, and Prep. The `<main>`
 * landmark and work-surface width live here; each page puts the shared nav
 * immediately below its own masthead so the composition reads in the same
 * order as the design: identity, surfaces, then work.
 *
 * Boat Mode is deliberately not owned here. It is a manifest-only working
 * surface, so its palette, sensor detector, and control live at the bottom of
 * `manifest/page.tsx`; Trip and Prep keep the ordinary staff treatment even
 * when a device has a stored Boat Mode preference.
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id } = await params;
  // The layout runs before every trip child page. Reject malformed ids here so
  // the activity-count query never compares arbitrary text with a UUID column
  // and turns a normal typo into the trip error boundary.
  if (!uuidParam(id)) notFound();
  return (
    // A staff page at `full` width (`_components/staff-page.ts`), every tab
    // of a departure alike. The day's packet wears the same shell, for the
    // same paper gutter.
    <main className={TRIP_SHELL_CLASS}>
      {/* A rehearsal says so above every trip surface (ADR
          20261012-rehearsal-departures); nothing for an ordinary departure.
          Awaited with the layout, never streamed behind a null fallback: a
          banner that lands after the page has painted is one somebody has
          already read past. This layout may block (`instant = false`). */}
      <RehearsalBanner shopSlug={shopSlug} tripId={id} />
      {children}
    </main>
  );
}
