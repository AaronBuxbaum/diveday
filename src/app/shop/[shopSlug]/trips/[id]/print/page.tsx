import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { getTripOverview } from "@/db/trips-overview";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { AutoPrint } from "../_components/AutoPrint";
import { TripPageHeader } from "../_components/TripPageHeader";
import TripManifestPage from "../manifest/page";
import TripPrepPage from "../prep/page";
import { PacketDives } from "./_components/PacketDives";

export const metadata: Metadata = {
  title: "Trip packet — DiveDay",
};

// The trip layout owns the blocking staff shell; this page still opts into the
// same instant-navigation contract as the four tabs it composes.
export const instant = true;

/**
 * **The browser-print packet for a departure: a document, not four live pages
 * stacked.**
 *
 * It used to compose all four human-facing trip tabs. Under print media that
 * left **42 buttons, 9 selects, 48 inputs and 13 textareas** on the sheet a
 * captain carries — including "Cancel trip", "Remove booking" nine times over,
 * and a bare "×" (issue #814). `docs/design/principles.md` §6 asks for "print
 * output as considered as screen output", and a rectangle labelled "Cancel
 * trip" beside a roster is not that.
 *
 * Two of the four tabs are working pages rather than documents, and they were
 * the whole problem — I attributed every control before changing anything:
 *
 * - **Overview** held 8 buttons, all 9 selects and most of the inputs, because
 *   it *is* the trip's edit form. Its facts existed only inside form controls,
 *   which is why hiding controls alone would have taken the dive plan off the
 *   sheet with them. `PacketDives` renders those facts as words instead, from
 *   the same reader the Overview page uses.
 * - **Guests** held the other 34. It contributes nothing to paper: the
 *   manifest section below already prints the same roster read-only, with each
 *   diver's emergency contact and the head count. What Guests uniquely offers
 *   is actions — send a waiver, remove a booking, save a contact — and none of
 *   those can happen on paper.
 *
 * **Manifest and Prep contribute zero controls** and are composed unchanged:
 * their own pages already carry `print:hidden` where it matters, and each stays
 * the source of truth for its facts so the packet cannot drift from the screen
 * staff just reviewed.
 *
 * A rule in `globals.css` scoped to `.trip-print-bundle` hides any control that
 * ever reaches this page again. It is a backstop rather than the fix, and it is
 * only safe *because* of the above: with the two form-bearing tabs gone,
 * nothing value-bearing is left inside a control, so hiding one loses nothing.
 * `e2e/trips.spec.ts` asserts the count is zero under print emulation.
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

  const { shop, session } = await requireShopSurface(resolvedParams.shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const safeParams = Promise.resolve({ ...resolvedParams, id: tripId });
  const searchParams = Promise.resolve({});
  const manifestSearchParams = Promise.resolve({});
  const db = await getDb();
  const [details, manifest, prep] = await Promise.all([
    getTripOverview(db, shop, tripId, session.user.personId),
    TripManifestPage({ params: safeParams, searchParams: manifestSearchParams }),
    TripPrepPage({ params: safeParams, searchParams }),
  ]);
  // The same answer the Overview page gives a trip that is gone or another
  // shop's — the reader is scoped by the shop this surface already resolved.
  if (!details) notFound();

  return (
    <div className="trip-print-bundle">
      <AutoPrint readySelector="[data-trip-guests-ready]" />
      <header className="mb-10 border-b border-border pb-6 print:mb-6">
        <p className={EYEBROW_CLASS}>DiveDay</p>
        <h1 className={`mt-2 ${SHELL_TITLE_CLASS}`}>{t("shared.printPacket.title")}</h1>
      </header>

      <section aria-labelledby="print-dives" className="print-bundle-page">
        <h2 id="print-dives" className="sr-only">
          Dives
        </h2>
        {/* Each section breaks onto its own page, so page one has to say which
            departure it is — through the same header the four tabs wear, not a
            hand-rolled title line that would drift from them. */}
        <TripPageHeader
          trip={details.trip}
          boardHref={shopPath(resolvedParams.shopSlug, "schedule", "board")}
          backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
          locale={locale}
          timeZone={shop.timezone}
        />
        <PacketDives
          dives={details.tripDiveList.map(({ dive, diveSite }) => ({
            diveNumber: dive.diveNumber,
            heading: diveSite?.name ?? dive.title,
            travelMinutes: dive.travelMinutes,
            description: dive.description,
          }))}
          description={details.trip.description}
          meetingPointLabel={details.trip.meetingPointLabel}
          meetingPointAddress={details.trip.meetingPointAddress}
          conditions={details.trip.conditionsSummary}
          t={t}
        />
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
