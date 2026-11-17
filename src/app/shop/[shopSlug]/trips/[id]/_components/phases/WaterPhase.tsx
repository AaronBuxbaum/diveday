import type { ReactNode } from "react";
import type { requireShopSurface } from "@/features/session";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { depthInUnit } from "@/lib/depth-units";
import { shopPath } from "@/lib/staff-notices";
import { readManifestView } from "../../manifest/_components/manifest-view";
import { TripDiveRecord } from "../TripDiveRecord";
import { TripIncidentReports } from "../TripIncidentReports";
import { TripSentenceLine } from "../TripSentenceLine";
import type { TripSentence } from "../trip-sentence";
import { waterSentence } from "../water-copy";
import { DaySoFarCard, NotYetBackCard } from "./WaterPanels";
import { loggableDives, waterStandingOf } from "./water-reading";

export type PhaseRecordContext = {
  context: Pick<Awaited<ReturnType<typeof requireShopSurface>>, "db" | "shop" | "session">;
  tripId: string;
  locale: string;
  t: StaffTranslator;
};

/**
 * **On the water** (ADR 20261117-trip-page-clock): the shop's phase while the
 * crew works Roll call on the boat. The sentence and the "Not yet recorded
 * back" list come only from what the roll call recorded (`waterStanding`);
 * then the day so far, each dive's log, the incident reports, and the guests.
 */
export async function WaterPhase({
  guests,
  record,
  sentence,
  cancelled,
  door: hasDoor,
}: {
  guests: ReactNode;
  record: PhaseRecordContext;
  /** The frame's sentence: what the schedule or the crew's word says. */
  sentence: TripSentence;
  cancelled: boolean;
  /** Whether Roll call has its dark door yet (`tripFrame`). */
  door: boolean;
}) {
  const { context, tripId, locale, t } = record;
  const { shop } = context;
  const timeZone = shop.timezone;
  const rollCallHref = shopPath(shop.slug, "trips", tripId, "manifest");
  const door = hasDoor ? { href: rollCallHref, label: t("trips.clock.rollCall") } : null;
  const view = await readManifestView({ ...context, shopSlug: shop.slug, tripId, locale, t });
  const reports = (
    <TripIncidentReports shop={shop} personId={context.session.user.personId} tripId={tripId} />
  );
  if (view.status !== "ready") {
    return (
      <div data-phase-panel="water" className="space-y-10">
        <TripSentenceLine sentence={sentence} rollCall={door} />
        {reports}
        {guests}
      </div>
    );
  }
  const standing = waterStandingOf(view);
  const latestDive = standing.latest?.dive ?? 0;
  const words = { locale, timeZone, t };
  return (
    <div data-phase-panel="water" className="space-y-6 sm:space-y-10">
      <TripSentenceLine
        sentence={waterSentence(standing, sentence, { ...words, cancelled }, t)}
        rollCall={door}
      />
      <NotYetBackCard
        standing={standing}
        rollCallHref={
          latestDive > 0 ? `${rollCallHref}?checkpoint=after_dive_${latestDive}` : rollCallHref
        }
        {...words}
      />
      <DaySoFarCard
        standing={standing}
        depth={(meters) =>
          t("manifest.executedDive.summaryDepth", {
            depth: depthInUnit(meters, shop.depthUnit),
            unit: shop.depthUnit === "feet" ? "ft" : "m",
          })
        }
        {...words}
      />
      <TripDiveRecord
        view={view}
        dives={loggableDives(standing, { back: false })}
        shop={shop}
        tripId={tripId}
        locale={locale}
        t={t}
      />
      {reports}
      {guests}
    </div>
  );
}
