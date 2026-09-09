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
  // **The composed pages scope their own element ids to this departure.** Both
  // carry fixed ids (`roll-call-list`, `tanks-heading`, …) that are correct on
  // a route showing one boat and silently wrong on a document showing several:
  // every reference in the second departure resolves to the first departure's
  // element, and two of those sections are the ones that say whether a boat is
  // safe to leave. `src/lib/element-id.ts` carries the full reasoning, and the
  // reason this rides on `searchParams` rather than a prop is that a page
  // component's props are pinned to Next's `PageProps`.
  const searchParams = Promise.resolve({ idPrefix: tripId });
  const db = await getDb();
  // **The overview resolves alone, first.** It is the cheapest of the three
  // reads and the one that answers "is this departure still there", and the
  // other two cannot answer it politely: the manifest page's own reply to a
  // vanished trip is `notFound()`, which throws, and a throw inside a
  // `Promise.all` beside it is the *caller's* answer rather than this
  // departure's. Sequencing it costs one round trip on a document nobody
  // navigates twice, and buys the day's paper a boat that can go missing
  // without taking the rest of the stack with it.
  const details = await getTripOverview(db, shop, tripId, actorPersonId);
  if (!details) return null;

  const [manifest, prep] = await Promise.all([
    TripManifestPage({ params, searchParams }),
    TripPrepPage({ params, searchParams }),
  ]);

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
