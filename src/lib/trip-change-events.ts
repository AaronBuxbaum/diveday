/** Values kept in the public trip change ledger. */
export type TripChangeSnapshot = Record<string, string | number | boolean | null>;

export type TripArrivalSnapshot = TripChangeSnapshot & {
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
  arrivalLandmark: string | null;
  arrivalParkingNote: string | null;
  arrivalTransitNote: string | null;
  arrivalLookFor: string | null;
  arrivalFirstInteraction: string | null;
  arrivalPhotoUrl: string | null;
};

export type TripConditionsSnapshot = TripChangeSnapshot & {
  conditionsHold: boolean;
  conditionsSummary: string | null;
  waterTemperatureC: number | null;
  visibilityMeters: number | null;
  surfaceConditions: string | null;
};

type TripArrivalSnapshotInput = {
  meetingPointLabel?: string | null;
  meetingPointAddress?: string | null;
  arrivalLandmark?: string | null;
  arrivalParkingNote?: string | null;
  arrivalTransitNote?: string | null;
  arrivalLookFor?: string | null;
  arrivalFirstInteraction?: string | null;
  arrivalPhotoUrl?: string | null;
};

type TripConditionsSnapshotInput = {
  conditionsHold?: boolean;
  conditionsSummary?: string | null;
  waterTemperatureC?: number | null;
  visibilityMeters?: number | null;
  surfaceConditions?: string | null;
};

function nullableText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** Makes the arrival facts stable for comparison and safe for a public ledger. */
export function tripArrivalSnapshot(trip: TripArrivalSnapshotInput): TripArrivalSnapshot {
  return {
    meetingPointLabel: nullableText(trip.meetingPointLabel),
    meetingPointAddress: nullableText(trip.meetingPointAddress),
    arrivalLandmark: nullableText(trip.arrivalLandmark),
    arrivalParkingNote: nullableText(trip.arrivalParkingNote),
    arrivalTransitNote: nullableText(trip.arrivalTransitNote),
    arrivalLookFor: nullableText(trip.arrivalLookFor),
    arrivalFirstInteraction: nullableText(trip.arrivalFirstInteraction),
    arrivalPhotoUrl: nullableText(trip.arrivalPhotoUrl),
  };
}

/** Makes the crew-authored facts stable for comparison and public rendering. */
export function tripConditionsSnapshot(trip: TripConditionsSnapshotInput): TripConditionsSnapshot {
  return {
    conditionsHold: trip.conditionsHold === true,
    conditionsSummary: nullableText(trip.conditionsSummary),
    waterTemperatureC: trip.waterTemperatureC ?? null,
    visibilityMeters: trip.visibilityMeters ?? null,
    surfaceConditions: nullableText(trip.surfaceConditions),
  };
}

/** Compares the fixed snapshot fields instead of relying on object key order. */
export function tripChangeSnapshotsEqual(
  left: TripChangeSnapshot,
  right: TripChangeSnapshot,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}
