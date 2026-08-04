import { AmbientContrastControl, AmbientGlareDetector } from "@/components/AmbientGlareDetector";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { BulkWaiverSelectionProvider } from "./_components/RosterBulkWaiverSelection";
import { TripSubNav, type TripSubNavCopy } from "./_components/TripSubNav";

// Restored after CI. ARCH-7 removed this as provably-unread by
// `isPageAllowedToBlock`, which stops at the outermost `instant` — the shop
// layout's. The reasoning still looks right and the build agreed, but three
// Playwright specs then went intermittently red on CI and never locally, two
// of them on `trips/[id]/guests` under this very layout, failing in
// hydration-shaped ways: a `?notice=` banner rendered twice in the DOM, and
// banners that were absent when asserted. That is one change too close to
// those symptoms to leave in on a safety-critical staff surface for the sake
// of deleting a line. Put back until someone can show the two are unrelated.
// See ADR 20260803-instant-opt-out-placement.
export const instant = false;

/**
 * One shell for every trip surface — Overview, Guests, Manifest, Prep. Owning
 * the container width, padding, and the sub-nav here (rather than repeating them
 * in each page) is what keeps the four tabs visually identical, and it keeps the
 * nav mounted across navigations so switching surfaces never re-renders or
 * re-fetches the spine — only the page body below swaps. The `<main>` landmark
 * lives here; pages render their content directly.
 *
 * Also owns **boat mode** — the sunlight/wet-hands treatment (bigger targets,
 * boosted ink) that used to be scoped to the Manifest alone. A crew member who
 * turns it on to run a roll call is on the same boat when they open Guests to
 * fix a blocker or Prep to check the tanks, so it belongs to the trip, not to
 * one tab: the `.boat-mode` wrapper, the ambient-light detector, and the one
 * Auto / Land / Boat control all live here and stay mounted across tab
 * switches. The choice itself is per-device and persists in `localStorage`
 * (`AmbientGlareDetector`).
 *
 * Also owns `BulkWaiverSelectionProvider` (Guests' "tick a few divers, then
 * send" state) for the same reason: it must survive the Guests page body's
 * own re-renders across a diver-add redirect, which this layout — staying
 * mounted while only `{children}` swaps — does for free. See that
 * component's docstring for the failure mode this avoids. Wrapping it here
 * costs nothing on Overview/Manifest/Prep: nothing there reads the context.
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  // Staff read the nav in the language their own device asks for, same
  // negotiation as every trip page (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const subNavCopy: TripSubNavCopy = {
    ariaLabel: t("trips.subNav.ariaLabel"),
    overview: t("trips.subNav.overview"),
    guests: t("trips.subNav.guests"),
    manifest: t("trips.subNav.manifest"),
    prep: t("trips.subNav.prep"),
  };
  return (
    <main className="boat-mode mx-auto w-full max-w-4xl flex-1 px-6 py-10 print:max-w-none print:px-10 print:py-8">
      <AmbientGlareDetector />
      {/* `items-end`, so the nav's pill and the control's pill share a bottom
          edge — the control carries a legend above it, and centring the two
          boxes puts their visible pills a few pixels out of line. */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <TripSubNav shopSlug={shopSlug} tripId={id} copy={subNavCopy} className="min-w-64 flex-1" />
        <AmbientContrastControl
          copy={{
            modeLabel: t("shared.boatMode.modeLabel"),
            labelAuto: t("shared.boatMode.labelAuto"),
            labelLand: t("shared.boatMode.labelLand"),
            labelBoat: t("shared.boatMode.labelBoat"),
          }}
        />
      </div>
      <BulkWaiverSelectionProvider>{children}</BulkWaiverSelectionProvider>
    </main>
  );
}
