import { staffTranslator } from "@/i18n/staff-messages";
import { RosterMixedTrainingDepthWarning } from "./RosterMixedTrainingDepthWarning";
import { TrainingPlan } from "./TrainingPlan";
import type { TripRosterContentContext } from "./TripRosterContent";

export function TrainingPlanWithDepth({ context }: { context: TripRosterContentContext }) {
  const { guests, shopSlug, locale, actions, record } = context;
  const { trip, roster } = guests;
  const t = staffTranslator(locale);
  return (
    <>
      {!trip.course ? (
        <TrainingPlan
          shopId={trip.shopId}
          shopSlug={shopSlug}
          tripId={trip.id}
          canEdit={
            Boolean(actions.markTrainingDiveAction) && !record && trip.status !== "cancelled"
          }
          t={t}
        />
      ) : null}
      <RosterMixedTrainingDepthWarning marks={guests.trainingMarks?.bySeat} roster={roster} t={t} />
    </>
  );
}
