import type { ComponentProps } from "react";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { TripCapacityBadge } from "./TripPageHeader";
import { TripStageBadge } from "./TripTabs";

/** Shared header state, kept separate from the departure page's composition. */
export function TripHeaderBadges({
  trip,
  sailed,
  stage,
  tabsCopy,
  t,
}: {
  trip: ComponentProps<typeof TripCapacityBadge>["trip"];
  sailed: boolean;
  stage: ComponentProps<typeof TripStageBadge>["stage"];
  tabsCopy: ComponentProps<typeof TripStageBadge>["copy"];
  t: StaffTranslator;
}) {
  return (
    <>
      <TripStageBadge stage={stage} copy={tabsCopy} />
      <TripCapacityBadge
        trip={trip}
        finished={sailed}
        cancelledLabel={t("trips.detail.cancelledBadge")}
        t={t}
      />
    </>
  );
}
