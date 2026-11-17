import type { ComponentProps } from "react";
import { TripAboutLinks } from "./TripAboutLinks";
import { TripDiveRecord } from "./TripDiveRecord";
import { TripIncidentReports } from "./TripIncidentReports";
import type { TripPromoteAndActivity } from "./TripRosterContent";
import { TripPromoteAndActivity as TripActivity } from "./TripRosterContent";

export function TripRecordPanel({
  context,
  tripId,
  locale,
  t,
  guests,
}: ComponentProps<typeof TripDiveRecord> & {
  guests: ComponentProps<typeof TripPromoteAndActivity>["guests"];
}) {
  const { shop, session } = context;
  const shopSlug = shop.slug;
  return (
    <section className="space-y-6">
      <TripAboutLinks
        shop={shop}
        personId={session.user.personId}
        shopSlug={shopSlug}
        tripId={tripId}
        t={t}
      />
      <TripDiveRecord {...{ context, tripId, locale, t }} />
      <TripIncidentReports shop={shop} personId={session.user.personId} tripId={tripId} />
      <TripActivity {...{ guests, shopSlug, locale, shop }} mayDiscount={false} recordOnly />
    </section>
  );
}
