import type { OpenSnag } from "@/db/boat-snags";
import type { issueOfflineManifestSnapshot } from "@/db/offline-manifest-snapshots";
import type { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import { crewBlockerText } from "@/i18n/identity-check-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BoatSafetySection } from "@/lib/boat-safety";
import { type OfflineManifestPayload, serializeManifests } from "@/lib/offline-manifests";
import { snagSentences } from "./pre-departure-check-view";

/**
 * **What this phone keeps for the boat**: every checkpoint's manifest, the
 * shop's emergency reference, the boat check, the boat's open snags and its
 * safety section,
 * serialized for the offline copy — the same facts the screen is drawn from,
 * so the copy at sea cannot disagree with the page at the dock.
 */
export function offlineManifestPayload({
  snapshot,
  shop,
  checklistItems,
  checklistChecks,
  boatSafety,
  snags,
  locale,
  t,
}: {
  snapshot: NonNullable<Awaited<ReturnType<typeof issueOfflineManifestSnapshot>>>;
  shop: OfflineManifestPayload["shop"];
  checklistItems: Awaited<ReturnType<typeof listChecklistItems>>;
  checklistChecks: Awaited<ReturnType<typeof latestPreDepartureChecksForTrip>>;
  boatSafety: BoatSafetySection | null;
  /** `openSnagsForTrip`: carried and this crew's own, in the reader's order. */
  snags: readonly OpenSnag[];
  locale: string;
  t: StaffTranslator;
}) {
  return {
    ...serializeManifests(
      snapshot.manifests,
      {
        slug: shop.slug,
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
      {
        heading: t("trips.preDepartureCheck.snagsHeading"),
        items: snags.map((snag) => {
          const said = snagSentences({ snag, locale, timeZone: shop.timezone, t });
          return {
            line: said.line,
            notedBy: said.notedBy,
            ...(said.stillThere ? { stillThere: said.stillThere } : {}),
          };
        }),
      },
      () => t("shared.offlineManifest.juniorCheckRequired"),
    ),
    snapshotId: snapshot.snapshotId,
    erasureEpochToken: snapshot.erasureEpochToken,
  };
}
