import { notFound } from "next/navigation";
import { getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
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
 * Boat Mode is deliberately not owned here. It is a manifest-only working
 * surface, so its palette, sensor detector, and control live at the bottom of
 * `manifest/page.tsx`; Overview, Guests, and Prep keep the ordinary staff
 * treatment even when a device has a stored Boat Mode preference.
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
  // The same call every page beneath this layout makes. It used to resolve the
  // shop by slug while its children resolved it by session id — one row, two
  // queries, same request — and it left the layout relying on the shop shell
  // two levels up for the cross-tenant check rather than making it itself.
  const { db, shop } = await requireShopSurface(shopSlug);
  const trip = await getTripWithBooked(db, shop.id, id);
  const guestCount = trip?.booked ?? 0;
  // Staff read the nav in the language their own device asks for, same
  // negotiation as every trip page (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const subNavCopy: TripSubNavCopy = {
    ariaLabel: t("trips.subNav.ariaLabel"),
    overview: t("trips.subNav.overview"),
    guests: t("trips.subNav.guests"),
    manifest: t("trips.subNav.manifest"),
    prep: t("trips.subNav.prep"),
  };
  return (
    // `max-w-5xl`, the staff work-surface tier (docs/design/principles.md
    // #10) — the trip family sat at the in-between `max-w-4xl` the principles
    // call legacy, and a redesign is the sanctioned moment to move to a tier.
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 print:max-w-none print:px-10 print:py-8">
      <div className="mb-6 print:hidden">
        <TripSubNav
          shopSlug={shopSlug}
          tripId={id}
          guestCount={guestCount}
          copy={subNavCopy}
          className="w-full"
        />
      </div>
      {children}
    </main>
  );
}
