import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { AutoPrint } from "../_components/AutoPrint";
import TripGuestsPage from "../guests/page";
import TripManifestPage from "../manifest/page";
import ManageTripPage from "../page";
import TripPrepPage from "../prep/page";

export const metadata: Metadata = {
  title: "Trip packet — DiveDay",
};

// The trip layout owns the blocking staff shell; this page still opts into the
// same instant-navigation contract as the four tabs it composes.
export const instant = true;

/**
 * The browser-print packet for a departure. It deliberately composes the four
 * human-facing trip tabs — Overview, Guests, Manifest, and Prep — rather than
 * exposing an offline/serialized payload or a data export. Each page remains
 * the source of truth for its own visual facts, so a printed packet cannot
 * quietly drift from the screen staff just reviewed.
 */
export default async function TripPrintPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const resolvedParams = await params;
  const { id } = resolvedParams;
  const tripId = uuidParam(id);
  if (!tripId) notFound();

  const { shop } = await requireShopSurface(resolvedParams.shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const safeParams = Promise.resolve({ ...resolvedParams, id: tripId });
  const searchParams = Promise.resolve({});
  const manifestSearchParams = Promise.resolve({});
  const [overview, guests, manifest, prep] = await Promise.all([
    ManageTripPage({ params: safeParams, searchParams }),
    TripGuestsPage({ params: safeParams, searchParams }),
    TripManifestPage({ params: safeParams, searchParams: manifestSearchParams }),
    TripPrepPage({ params: safeParams, searchParams }),
  ]);

  return (
    <div className="trip-print-bundle">
      <AutoPrint readySelector="[data-trip-guests-ready]" />
      <header className="mb-10 border-b border-border pb-6 print:mb-6">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">DiveDay</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("shared.printPacket.title")}
        </h1>
      </header>

      <section aria-labelledby="print-overview" className="print-bundle-page">
        <h2 id="print-overview" className="sr-only">
          Overview
        </h2>
        {overview}
      </section>
      <section aria-labelledby="print-guests" className="print-bundle-page">
        <h2 id="print-guests" className="sr-only">
          Guests
        </h2>
        {guests}
      </section>
      <section aria-labelledby="print-manifest" className="print-bundle-page">
        <h2 id="print-manifest" className="sr-only">
          Manifest
        </h2>
        {manifest}
      </section>
      <section aria-labelledby="print-prep" className="print-bundle-page">
        <h2 id="print-prep" className="sr-only">
          Prep
        </h2>
        {prep}
      </section>
    </div>
  );
}
