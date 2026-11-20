import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { cardSummaryClass, sectionCardClass } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { getTripConservationPanel } from "@/features/conservation";
import type { TripGuests } from "@/features/trip-guests";
import { LostItemsSection } from "../../manifest/_components/LostItemsSection";
import { ConservationPanel } from "../ConservationPanel";
import { TripAboutLinks } from "../TripAboutLinks";
import { TripPromoteAndActivity } from "../TripRosterContent";
import type { PhaseRecordContext } from "./WaterPhase";

/**
 * **Wrapped up's More** (ADR 20261117-trip-page-clock), closed: what the
 * owner reads or records once the boat is back but not every day. What was
 * found aboard, the conservation record, the activity, and the trip's links.
 * The species seen stay with each dive's log above, where the crew logged them.
 */
export async function WrappedMore({
  record,
  roster,
}: {
  record: PhaseRecordContext;
  roster: TripGuests;
}) {
  const { context, tripId, locale, t } = record;
  const { db, shop, session } = context;
  const personId = session.user.personId;
  // `null` when the shop has conservation off, or the trip was cancelled.
  const conservation = await getTripConservationPanel(db, shop.id, tripId, personId);
  return (
    // The header's Activity row links to `#trip-activity`, and What happened's
    // Left aboard row to `#found-aboard`, inside this card: the card opens for them.
    <AutoOpenDetails
      openOnHash={["trip-activity", "conservation", "found-aboard"]}
      id="wrapped-more"
      className={sectionCardClass({ padding: "none", className: "group/more" })}
    >
      <summary className={cardSummaryClass({ className: "min-h-14 px-4 py-4 sm:px-6" })}>
        <SummaryCaret className="group-open/more:rotate-90" />
        <span className="font-semibold">{t("trips.clock.wrapped.more")}</span>
      </summary>
      <div className="space-y-6 px-4 pb-4 sm:px-6">
        {shop.lostFoundEnabled ? (
          <LostItemsSection
            t={t}
            shopId={shop.id}
            tripId={tripId}
            open
            seats={roster.roster.map(({ booking, person }) => ({
              bookingId: booking.id,
              name: person.fullName,
            }))}
          />
        ) : null}
        {conservation ? (
          <section id="conservation" aria-labelledby="conservation-heading" className="space-y-3">
            <h3 id="conservation-heading" className={ITEM_TITLE_CLASS}>
              {t("trips.conservation.heading")}
            </h3>
            <ConservationPanel
              panel={conservation}
              tripId={tripId}
              shopSlug={shop.slug}
              t={t}
              locale={locale}
              timeZone={shop.timezone}
            />
          </section>
        ) : null}
        <TripAboutLinks
          shop={shop}
          personId={personId}
          shopSlug={shop.slug}
          tripId={tripId}
          t={t}
        />
        <TripPromoteAndActivity
          guests={roster}
          shopSlug={shop.slug}
          locale={locale}
          shop={shop}
          mayDiscount={false}
          recordOnly
        />
      </div>
    </AutoOpenDetails>
  );
}
