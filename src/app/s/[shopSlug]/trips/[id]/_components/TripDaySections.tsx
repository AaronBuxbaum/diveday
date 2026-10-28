import type { ComponentProps, ReactNode } from "react";
import { TripDayPlan } from "./TripDayPlan";
import { TripPitch } from "./TripPitch";

type Props = ComponentProps<typeof TripPitch> &
  Pick<ComponentProps<typeof TripDayPlan>, "shop" | "sightings" | "siteReviews">;

/** The longer site reports and pitch follow public booking in a single desktop grid row. */
export function TripSupportingDetails({ shop, sightings, siteReviews, ...pitch }: Props) {
  return (
    <div className="space-y-10">
      {!pitch.embed ? (
        <TripDayPlan
          content="reports"
          briefings={pitch.briefings}
          sightings={sightings}
          siteReviews={siteReviews}
          shop={shop}
          locale={pitch.locale}
        />
      ) : null}
      <TripPitch {...pitch} />
    </div>
  );
}

/** The public compact itinerary and boat photo precede booking; embeds retain the full plan. */
export function TripItinerary({
  embed,
  children,
  ...plan
}: ComponentProps<typeof TripDayPlan> & { embed: boolean; children?: ReactNode }) {
  return (
    <div className={embed ? "space-y-4" : "mt-10 space-y-4 lg:mt-0 lg:col-start-1 lg:row-start-2"}>
      <TripDayPlan {...plan} content={embed ? "full" : "itinerary"} />
      {children}
    </div>
  );
}
