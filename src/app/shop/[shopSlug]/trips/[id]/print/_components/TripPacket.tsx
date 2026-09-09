import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { getTripOverview, type TripOverviewShop } from "@/db/trips-overview";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { TripPageHeader } from "../../_components/TripPageHeader";
import TripManifestPage from "../../manifest/page";
import TripPrepPage from "../../prep/page";
import { PacketDives } from "./PacketDives";

/**
 * The marker `AutoPrint` waits for before it opens the print dialog: the last
 * thing either packet renders, so its presence means the whole document has
 * mounted.
 */
export const PACKET_READY_SELECTOR = "[data-packet-ready]";

/** Renders {@link PACKET_READY_SELECTOR}. Place it last, inside the bundle. */
export function PacketReady() {
  return <div data-packet-ready className="contents" />;
}

/**
 * **One departure as three printed sections** — the dive plan, the manifest,
 * and the morning packing list.
 *
 * Extracted from the trip packet page so the day's paper (N-54) is the *same*
 * document repeated per departure rather than a second assembly of the same
 * facts. Both callers wrap it in `.trip-print-bundle`, which is what hides any
 * control that reaches paper and what breaks each section onto its own sheet.
 *
 * The two composed pages stay the source of truth for their own facts, exactly
 * as the packet's docblock argues: they contribute zero controls, and reusing
 * the page means the sheet cannot drift from the screen staff just reviewed.
 * The dive plan is the one part rendered here, because on the Overview tab
 * those facts live inside form controls and paper has no forms.
 *
 * Returns `null` for a departure that is gone. A missing trip is a `notFound()`
 * for the single-trip packet, whose whole subject it is; on the day's sheet it
 * is one boat of several, and the honest answer is to print the rest.
 */
export async function TripPacket({
  shopSlug,
  shop,
  tripId,
  actorPersonId,
  locale,
  t,
}: {
  shopSlug: string;
  shop: TripOverviewShop;
  /** Already validated as a UUID by the caller. */
  tripId: string;
  actorPersonId: string;
  locale: string;
  t: StaffTranslator;
}): Promise<ReactNode> {
  const params = Promise.resolve({ shopSlug, id: tripId });
  const searchParams = Promise.resolve({});
  const db = await getDb();
  const [details, manifest, prep] = await Promise.all([
    getTripOverview(db, shop, tripId, actorPersonId),
    TripManifestPage({ params, searchParams }),
    TripPrepPage({ params, searchParams }),
  ]);
  if (!details) return null;

  return (
    <>
      {/* Section ids carry the trip id: the day's sheet holds one of these
          blocks per departure, and a repeated `aria-labelledby` target would
          point every heading at the first boat's. */}
      <section aria-labelledby={`print-dives-${tripId}`} className="print-bundle-page">
        <h2 id={`print-dives-${tripId}`} className="sr-only">
          {t("shared.printPacket.divesHeading")}
        </h2>
        {/* Each section breaks onto its own page, so page one has to say which
            departure it is — through the same header the four tabs wear, not a
            hand-rolled title line that would drift from them. */}
        <TripPageHeader
          trip={details.trip}
          boardHref={shopPath(shopSlug, "schedule", "board")}
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
      <section aria-labelledby={`print-manifest-${tripId}`} className="print-bundle-page">
        <h2 id={`print-manifest-${tripId}`} className="sr-only">
          {t("trips.subNav.manifest")}
        </h2>
        {manifest}
      </section>
      <section aria-labelledby={`print-prep-${tripId}`} className="print-bundle-page">
        <h2 id={`print-prep-${tripId}`} className="sr-only">
          {t("trips.subNav.prep")}
        </h2>
        {prep}
      </section>
    </>
  );
}
