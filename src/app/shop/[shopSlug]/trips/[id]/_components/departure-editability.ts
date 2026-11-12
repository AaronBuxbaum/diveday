import { finalHomeSaid, tripPhaseOf } from "@/lib/trip-phase";

type PhaseInput = Parameters<typeof tripPhaseOf>[0];

export function departureEditability(
  trip: Pick<PhaseInput, "startsAt" | "endsAt">,
  now: Date,
  timeZone: string,
  stage: PhaseInput["stage"],
  meetingWindows: PhaseInput["meetingWindows"],
  cancelled: boolean,
) {
  const phase = { ...trip, now, timeZone, stage, meetingWindows, cancelled: false };
  return {
    detailsEditable: tripPhaseOf(phase) !== "back",
    mayChangeDeparture: !cancelled && !finalHomeSaid(phase),
  };
}
