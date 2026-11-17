import type { ComponentProps, ReactNode } from "react";
import { TripDiveRecord } from "../TripDiveRecord";
import { TripIncidentReports } from "../TripIncidentReports";

/**
 * **On the water** (ADR 20261117-trip-page-clock): the shop's phase while the
 * crew works Roll call on the boat. It hosts the guest list as recorded, each
 * dive's log, and the incident reports. Where people are is said only from
 * roll-call evidence, in the sentence above, never from the clock.
 */
export function WaterPhase({
  guests,
  record,
}: {
  guests: ReactNode;
  record: ComponentProps<typeof TripDiveRecord>;
}) {
  const { context } = record;
  return (
    <div data-phase-panel="water" className="space-y-10">
      {guests}
      <TripDiveRecord {...record} />
      <TripIncidentReports
        shop={context.shop}
        personId={context.session.user.personId}
        tripId={record.tripId}
      />
    </div>
  );
}
