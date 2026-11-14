import type { ComponentProps } from "react";
import { DayBuddyPlanning } from "./DayBuddyPlanning";
import { TripMoreActions } from "./TripMoreActions";
import { TripPromoteAndActivity } from "./TripRosterContent";
import { assignedCrewNames, type TripAboutRowsContext } from "./trip-about-rows";

type Props = Pick<
  ComponentProps<typeof TripPromoteAndActivity>,
  "guests" | "tripNotice" | "mayDiscount"
> &
  Pick<
    ComponentProps<typeof TripMoreActions>,
    "mayChangeDeparture" | "lifecycleStatus" | "refundsHeld"
  > &
  Omit<ComponentProps<typeof DayBuddyPlanning>, "open"> & {
    overview: TripAboutRowsContext["overview"];
    buddies?: string;
  };

/** Optional planning and departure administration stay with The day. */
export function TripDayOperations({
  context,
  overview,
  tripId,
  locale,
  t,
  guests,
  tripNotice,
  mayDiscount,
  mayChangeDeparture,
  lifecycleStatus,
  refundsHeld,
  buddies,
  buddyError,
}: Props) {
  const { shop, session } = context;
  const shopSlug = shop.slug;
  const { trip, canConfigure, series } = overview;
  return (
    <>
      <DayBuddyPlanning {...{ context, tripId, locale, t, buddyError }} open={buddies === "open"} />
      <TripPromoteAndActivity
        {...{ guests, shopSlug, locale, shop, tripNotice, mayDiscount }}
        dayOnly
        more={
          !mayChangeDeparture && !(canConfigure && series) ? undefined : (
            <TripMoreActions
              {...{
                shop,
                shopSlug,
                tripId,
                mayChangeDeparture,
                lifecycleStatus,
                refundsHeld,
                locale,
                t,
              }}
              personId={session.user.personId}
              startsAt={trip.startsAt}
              series={canConfigure ? series : null}
              crewNames={assignedCrewNames(overview)}
            />
          )
        }
      />
    </>
  );
}
