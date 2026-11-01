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
      {/* Each child keeps progress/completion refs for one trip and
        checkpoint. These distinct keys force fresh refs when either changes,
        including if Activity navigation preserves this route (ADR
        20260801-cache-components-activity-state). They are siblings, so each
        key needs its own suffix. */}
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
