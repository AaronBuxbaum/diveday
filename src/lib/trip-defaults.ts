/** Values copied from a shop when a departure is made, in shop currency minor units. */
export type TripDefaults = {
  depositCents: number | null;
  cancellationWindowHours: number | null;
  minimumBookings: number | null;
  snorkelerPriceCents: number | null;
  riderPriceCents: number | null;
  lensId: string | null;
};

export const EMPTY_TRIP_DEFAULTS: TripDefaults = {
  depositCents: null,
  cancellationWindowHours: null,
  minimumBookings: null,
  snorkelerPriceCents: null,
  riderPriceCents: null,
  lensId: null,
};

export const TRIP_DEFAULT_FIELDS = [
  "depositCents",
  "cancellationWindowHours",
  "minimumBookings",
  "snorkelerPriceCents",
  "riderPriceCents",
  "lensId",
] as const satisfies readonly (keyof TripDefaults)[];

export type TripDefaultField = (typeof TRIP_DEFAULT_FIELDS)[number];

/** Undefined means use the default; null explicitly clears it. Zero is a value. */
export function applyTripDefaults(defaults: TripDefaults, overrides: Partial<TripDefaults>) {
  const values = { ...defaults };
  const inherited: TripDefaultField[] = [];
  for (const field of TRIP_DEFAULT_FIELDS) {
    const override = overrides[field];
    if (override === undefined) {
      if (defaults[field] !== null) inherited.push(field);
    } else {
      // Each field's override has the same type as its corresponding default.
      Object.assign(values, { [field]: override });
    }
  }
  return { values, inherited };
}

/** Keep provenance only while the saved value has not changed. */
export function remainingTripDefaults(
  inherited: readonly TripDefaultField[],
  before: Partial<TripDefaults>,
  patch: Partial<TripDefaults>,
): TripDefaultField[] {
  return inherited.filter((field) => patch[field] === undefined || patch[field] === before[field]);
}
