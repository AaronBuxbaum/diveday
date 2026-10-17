import { shopPath } from "@/lib/staff-notices";

/** A roll-call checkpoint as the manifest's URL spells it, or null for anything else. */
export function manifestCheckpointParam(value: string | undefined): string | null {
  return value && /^(departure|after_dive_[1-9][0-9]?)$/.test(value) ? value : null;
}

/**
 * Where "Back to manifest" leads on a report opened from the manifest's "Start
 * a missing diver report" (`?from=manifest`), at the checkpoint it was pressed
 * at; null on a report reached any other way, which keeps its usual way back.
 */
export function manifestReturnHref(
  shopSlug: string,
  tripId: string,
  search: { from?: string; checkpoint?: string },
): string | null {
  if (search.from !== "manifest") return null;
  const manifest = shopPath(shopSlug, "trips", tripId, "manifest");
  const checkpoint = manifestCheckpointParam(search.checkpoint);
  return checkpoint ? `${manifest}?checkpoint=${checkpoint}` : manifest;
}
