import type { TripPatch } from "@/db/trips";

export type DepartureDetailsSection =
  | "plan"
  | "meeting"
  | "timing"
  | "booking"
  | "boat"
  | "departure";

export const DEPARTURE_SECTION_FIELDS = {
  departure: ["title", "description", "lensId"],
  plan: ["plannedDives", "wetsuitThicknessMm", "exceedsNoDecoLimits", "lunchAboard"],
  meeting: [
    "meetingPointLabel",
    "meetingPointAddress",
    "arrivalLandmark",
    "arrivalParkingNote",
    "arrivalTransitNote",
    "arrivalLookFor",
    "arrivalFirstInteraction",
    "arrivalPhoto",
    "removeArrivalPhoto",
  ],
  timing: ["date", "startTime", "endTime", "dayCount", "meetingDate"],
  booking: [
    "capacity",
    "priceDollars",
    "depositDollars",
    "cancellationWindowHours",
    "minimumBookings",
    "minimumDecisionHours",
    "isPrivate",
  ],
  boat: ["diveMode", "boatId", "selfGuided"],
} as const;

export function isDepartureDetailsSection(value: unknown): value is DepartureDetailsSection {
  return typeof value === "string" && Object.hasOwn(DEPARTURE_SECTION_FIELDS, value);
}

const PATCH_FIELDS: Record<DepartureDetailsSection, readonly (keyof TripPatch)[]> = {
  departure: ["title", "description", "lensId"],
  plan: ["plannedDives", "dives", "wetsuitThicknessMm", "exceedsNoDecoLimits", "lunchAboard"],
  meeting: [
    "meetingPointLabel",
    "meetingPointAddress",
    "arrivalLandmark",
    "arrivalParkingNote",
    "arrivalTransitNote",
    "arrivalLookFor",
    "arrivalFirstInteraction",
    "arrivalPhotoUrl",
  ],
  timing: ["startsAt", "endsAt", "scheduleDays"],
  booking: [
    "capacity",
    "priceCents",
    "depositCents",
    "cancellationWindowHours",
    "minimumBookings",
    "minimumDecisionHours",
    "isPrivate",
  ],
  boat: ["diveMode", "boatId", "selfGuided"],
};

/** A forged field from another editor is ignored, including repeated form entries. */
export function departureSectionForm(
  section: DepartureDetailsSection,
  submitted: FormData,
): FormData {
  const allowed = new Set<string>(DEPARTURE_SECTION_FIELDS[section]);
  const form = new FormData();
  for (const [key, value] of submitted) {
    if (
      allowed.has(key) ||
      (section === "plan" && /^dive-[1-5]-(title|siteId|travelMinutes|description)$/.test(key))
    )
      form.append(key, value);
  }
  return form;
}

export function departureSectionPatch(
  section: DepartureDetailsSection,
  patch: TripPatch,
): Partial<TripPatch> {
  const allowed = new Set<string>([...PATCH_FIELDS[section], "changeActorPersonId"]);
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
}
