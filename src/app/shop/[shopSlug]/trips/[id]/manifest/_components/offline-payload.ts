import type { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import { crewBlockerText } from "@/i18n/identity-check-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BoatSafetySection } from "@/lib/boat-safety";
import type { TripManifest } from "@/lib/manifests";
import { type OfflineManifestPayload, serializeManifests } from "@/lib/offline-manifests";

/**
 * **What this phone keeps for the boat**: every checkpoint's manifest, the
 * shop's emergency reference, the boat check and the boat's safety section,
 * serialized for the offline copy — the same facts the screen is drawn from,
 * so the copy at sea cannot disagree with the page at the dock.
 */
export function offlineManifestPayload({
  completeManifests,
  shop,
  shopSlug,
  checklistItems,
  checklistChecks,
  boatSafety,
  t,
}: {
  completeManifests: readonly TripManifest[];
  shop: Omit<OfflineManifestPayload["shop"], "slug">;
  shopSlug: string;
  checklistItems: Awaited<ReturnType<typeof listChecklistItems>>;
  checklistChecks: Awaited<ReturnType<typeof latestPreDepartureChecksForTrip>>;
  boatSafety: BoatSafetySection | null;
  t: StaffTranslator;
}) {
  return serializeManifests(
    completeManifests,
    {
      slug: shopSlug,
      name: shop.name,
      timezone: shop.timezone,
      emergencyReference: shop.emergencyReference,
    },
    (blocker, diver) => crewBlockerText(t, diver, blocker),
    checklistItems.map((item) => ({
      id: item.id,
      label: item.label,
      check: checklistChecks.get(item.id),
    })),
    boatSafety,
  );
}
