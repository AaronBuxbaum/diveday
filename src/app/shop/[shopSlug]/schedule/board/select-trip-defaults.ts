import type { AppDb } from "@/db/client";
import { getTripLens } from "@/features/trips/trip-lenses";
import { applyTripDefaults, EMPTY_TRIP_DEFAULTS, type TripDefaults } from "@/lib/trip-defaults";
import type { TripDetailsPatch } from "@/lib/trip-details";
import { hasTripDiveContent, tripDiveDraftsFromForm } from "@/lib/trip-dives";

export async function selectTripDefaults(
  db: AppDb,
  shop: { id: string; tripDefaults: TripDefaults | null },
  formData: FormData,
  patch: TripDetailsPatch,
  lensId: string | undefined,
) {
  const defaults = { ...(shop.tripDefaults ?? EMPTY_TRIP_DEFAULTS) };
  if (defaults.lensId && !(await getTripLens(db, shop.id, defaults.lensId))) defaults.lensId = null;
  const selected = applyTripDefaults(defaults, {
    depositCents:
      formData.has("depositDollars") && patch.depositCents !== defaults.depositCents
        ? patch.depositCents
        : undefined,
    cancellationWindowHours:
      formData.has("cancellationWindowHours") &&
      patch.cancellationWindowHours !== defaults.cancellationWindowHours
        ? patch.cancellationWindowHours
        : undefined,
    minimumBookings:
      formData.has("minimumBookings") && patch.minimumBookings !== defaults.minimumBookings
        ? patch.minimumBookings
        : undefined,
    lensId:
      formData.has("lensId") && (lensId ?? null) !== defaults.lensId ? (lensId ?? null) : undefined,
  });
  return selected;
}

/** Prefer expanded per-dive cards when any are filled. */
export function plannedDiveCardsFrom(formData: FormData, count: number) {
  const drafts = tripDiveDraftsFromForm(formData, count);
  return hasTripDiveContent(drafts) ? drafts : undefined;
}
