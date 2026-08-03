import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { BulkWaiverSelectionProvider } from "./_components/RosterBulkWaiverSelection";
import { TripSubNav, type TripSubNavCopy } from "./_components/TripSubNav";

// No `instant` config here. `/shop/[shopSlug]/layout.tsx`'s `instant = false` is
// the outermost one in every route through this layout, and `isPageAllowedToBlock`
// stops there — a second one at this depth was never read.
// See ADR 20260803-instant-opt-out-placement.

/**
 * One shell for every trip surface — Overview, Guests, Manifest, Prep. Owning
 * the container width, padding, and the sub-nav here (rather than repeating them
 * in each page) is what keeps the four tabs visually identical, and it keeps the
 * nav mounted across navigations so switching surfaces never re-renders or
 * re-fetches the spine — only the page body below swaps. The `<main>` landmark
 * lives here; pages render their content directly.
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
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 print:max-w-none print:px-10 print:py-8">
      <TripSubNav shopSlug={shopSlug} tripId={id} copy={subNavCopy} className="mb-6" />
      <BulkWaiverSelectionProvider>{children}</BulkWaiverSelectionProvider>
    </main>
  );
}
