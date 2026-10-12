import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";

/**
 * The checkpoint's milestones, felt rather than read: a buzz as the head count
 * climbs, and the ripple when the checkpoint completes.
 */
export function ManifestMilestones({
  tripId,
  checkpoint,
  summary,
  complete,
  t,
}: {
  tripId: string;
  checkpoint: RollCallCheckpoint;
  summary: TripManifest["summary"];
  /** The checkpoint's completeness verdict — divers *and* crew. */
  complete: boolean;
  t: StaffTranslator;
}) {
  return (
    <>
      {/* Keyed by trip id + checkpoint: each holds a `prevPct`/`isInitial`
        (MilestoneHaptics) or `prevComplete` (SubSurfaceRipple) ref that
        assumes a monotonic same-trip-same-checkpoint lifecycle. Rendered
        once per manifest page, this route/key is otherwise identical
        across a trip or checkpoint switch, so if `cacheComponents: true`'s
        Activity-based navigation is ever re-enabled, an un-keyed instance
        could survive one and fire a false completion ripple/haptic buzz
        off the old numbers with no real remount to reset it (docs ADR
        20260801-cache-components-activity-state, currently reverted,
        commit 100fcf8). The `key` forces a full remount — and fresh refs — on either
        change. The two are siblings in this one fragment, so each key carries
        its own suffix: a shared key makes React warn and may drop one. */}
      <MilestoneHaptics
        key={`${tripId}-${checkpoint}-haptics`}
        total={summary.totalDivers}
        boarded={summary.boarded}
      />
      <SubSurfaceRipple
        key={`${tripId}-${checkpoint}-ripple`}
        complete={complete}
        copy={{
          iconTitle: t("shared.subSurfaceRipple.iconTitle"),
          message: t("shared.subSurfaceRipple.message"),
        }}
      />
    </>
  );
}
