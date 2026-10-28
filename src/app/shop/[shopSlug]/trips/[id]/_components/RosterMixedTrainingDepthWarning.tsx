import { MixedTrainingDepthWarning } from "@/components/MixedTrainingDepthWarning";
import type { TrainingMarkRosterSeat } from "@/db/training-marks";
import type { TripGuests } from "@/db/trips";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { mixedTrainingDepthAdvisory } from "@/lib/training-mark";

export function RosterMixedTrainingDepthWarning({
  marks,
  roster,
  t,
}: {
  marks?: ReadonlyMap<string, TrainingMarkRosterSeat>;
  roster: TripGuests["roster"];
  t: StaffTranslator;
}) {
  const courses = roster.flatMap(({ booking }) => {
    if (booking.identityUnconfirmedAt) return [];
    const mark = marks?.get(booking.id)?.mark;
    return mark?.valid ? [mark] : [];
  });
  return <MixedTrainingDepthWarning show={mixedTrainingDepthAdvisory(courses)} t={t} />;
}
