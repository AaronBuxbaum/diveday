import type { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import type { OpenSnag } from "@/features/boat-snags";
import type { readOfflineManifestRoster } from "@/features/offline-manifest-snapshots";
import { depthWarningText } from "@/i18n/depth-labels";
import { crewBlockerText } from "@/i18n/identity-check-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BoatSafetySection } from "@/lib/boat-safety";
import { type OfflineManifestPayload, serializeManifests } from "@/lib/offline-manifests";
import { type DayWindow, rollCallDayBoundariesOf } from "@/lib/trip-days";
import { snagSentences } from "./pre-departure-check-view";

/**
 * **What this phone keeps for the boat**: every checkpoint's manifest, the
 * shop's emergency reference, the boat check, the boat's open snags and its
 * safety section,
 * serialized for the offline copy — the same facts the screen is drawn from,
 * so the copy at sea cannot disagree with the page at the dock.
 */
export function offlineManifestPayload({
  roster,
  shop,
  checklistItems,
  checklistChecks,
  boatSafety,
  snags,
  meetingWindows,
  locale,
  t,
}: {
  roster: NonNullable<Awaited<ReturnType<typeof readOfflineManifestRoster>>>;
  shop: OfflineManifestPayload["shop"];
  checklistItems: Awaited<ReturnType<typeof listChecklistItems>>;
  checklistChecks: Awaited<ReturnType<typeof latestPreDepartureChecksForTrip>>;
  boatSafety: BoatSafetySection | null;
  /** `openSnagsForTrip`: carried and this crew's own, in the reader's order. */
  snags: readonly OpenSnag[];
  /** The run's real windows (`trip_schedule_days`), which the page has already read. */
  meetingWindows: readonly DayWindow[] | undefined;
  locale: string;
  t: StaffTranslator;
}) {
  const boundaries = rollCallDayBoundariesOf(meetingWindows);
  return {
    ...serializeManifests(
      roster.manifests,
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
      (advisory) =>
        advisory.params.verificationReasons?.length
          ? t("shared.offlineManifest.juniorCheckRequired")
          : depthWarningText(t, advisory),
    ),
    ...(boundaries ? { rollCallDayBoundaries: boundaries } : {}),
    rollCallMeetingDays: meetingWindows?.map((day) => ({
      startsAt: day.startsAt.toISOString(),
      endsAt: day.endsAt.toISOString(),
    })),
    // The device trades this for a snapshot id, revision and signed token when
    // it saves (`claimOfflineManifestSnapshot`), refused if an erasure landed
    // since these rows were read or another copy was issued since (issue #4391).
    readAt: { erasureEpoch: roster.erasureEpoch, snapshotRevision: roster.snapshotRevision },
  };
}
