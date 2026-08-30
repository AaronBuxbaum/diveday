import { notFound } from "next/navigation";
import { uuidParam } from "@/lib/uuid";

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
 * when a device has a stored Boat Mode preference. `/guests` remains a
 * compatibility route for old links, but its roster is now the Trip body.
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { id } = await params;
  // The layout runs before every trip child page. Reject malformed ids here so
  // the activity-count query never compares arbitrary text with a UUID column
  // and turns a normal typo into the trip error boundary.
  if (!uuidParam(id)) notFound();
  return (
    // `max-w-5xl`, the staff work-surface tier (docs/design/principles.md
    // #10) — the trip family sat at the in-between `max-w-4xl` the principles
    // call legacy, and a redesign is the sanctioned moment to move to a tier.
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:px-10 print:py-8">
      {children}
    </main>
  );
}
