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

/**
 * **The day's sites, in the order the diver reads them** (issue #3060): the
 * trip's own site first, then each dive's, each name once, as the diver's
 * "Planned sites" row lists them. Names only: a site's name is already
 * public on the trip page. `siteNames` is the run joined by a newline (a
 * snapshot is flat), null when no site is named.
 */
export type TripSitesSnapshot = TripChangeSnapshot & {
  siteNames: string | null;
};

/** The separator inside `siteNames`; a site name is one line, so it never holds one. */
const SITE_RUN_SEPARATOR = "\n";

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

/** The ordered, de-duplicated run of site names, ready to compare and to show. */
export function tripSitesSnapshot(
  names: readonly (string | null | undefined)[],
): TripSitesSnapshot {
  const run: string[] = [];
  for (const name of names) {
    const clean = name?.replace(/\s+/g, " ").trim();
    if (clean && !run.includes(clean)) run.push(clean);
  }
  return { siteNames: run.length > 0 ? run.join(SITE_RUN_SEPARATOR) : null };
}

/** The names a sites snapshot holds, in order; none for a missing or empty value. */
export function tripSiteNames(snapshot: TripChangeSnapshot | null | undefined): string[] {
  const value = snapshot?.siteNames;
  return typeof value === "string" && value ? value.split(SITE_RUN_SEPARATOR) : [];
}

/** Compares the fixed snapshot fields instead of relying on object key order. */
export function tripChangeSnapshotsEqual(
  left: TripChangeSnapshot,
  right: TripChangeSnapshot,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}
