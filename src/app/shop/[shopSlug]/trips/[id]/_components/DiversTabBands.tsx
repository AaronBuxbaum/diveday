import type { TripOverview } from "@/features/trip-overview";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { DepartureConflicts } from "./DepartureConflicts";
import { MinimumSeatsBand } from "./MinimumSeatsBand";

/**
 * The bands that open the Divers tab, above the pulse: the minimum head count
 * while it is still a question, then what this departure is standing in that a
 * person has to sort out (issue #4474).
 */
export function DiversTabBands({
  overview,
  showMinimum,
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  overview: NonNullable<TripOverview>;
  showMinimum: boolean;
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const { trip, cancelled } = overview;
  return (
    <>
      {showMinimum ? (
        <MinimumSeatsBand
          trip={trip}
          booked={trip.booked}
          locale={locale}
          timeZone={timeZone}
          t={t}
        />
      ) : null}
      <DepartureConflicts
        shopSlug={shopSlug}
        tripId={trip.id}
        dock={overview.dockObservations}
        clashes={cancelled ? [] : overview.seatClashes}
        t={t}
      />
    </>
  );
}
