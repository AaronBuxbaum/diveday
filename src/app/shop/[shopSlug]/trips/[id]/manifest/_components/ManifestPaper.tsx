import type { ComponentProps, ReactNode } from "react";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import { CancelledRollCallBanner } from "./CancelledRollCallBanner";
import { CrewRollCall } from "./CrewRollCall";
import { DiverRollCall } from "./DiverRollCall";
import { DockDesk } from "./DockDesk";
import { PreDepartureCheckList } from "./PreDepartureCheckList";
import { PrintedSoulsOnBoard } from "./PrintedSoulsOnBoard";
import { PrintedStage } from "./PrintedStage";
import type { manifestRollCallProps } from "./roll-call-props";

/**
 * **The manifest as the trip packet's paper** (visual review 2026-10-24, B03,
 * B55). Only the packet composes the manifest page under `PAPER_PACKET`, and
 * this is what it renders: what the printed sheet has always carried, in the
 * same order — the souls on board, the boat's safety notices, the boat
 * check's printed list, the roll call's printed rows, what was found
 * aboard, and the boat's procedure and numbers. The stage strip's printed
 * word stays, as `PrintedStage` (layer 4 review, dde-b 4), and so does the
 * dock desk's found-aboard list on a reprint after sailing (dde-a N1). No
 * header (the packet's dive plan names the departure once), no tabs, no
 * count panel, and no control anywhere, so the packet's screen view is the
 * sheet that comes out. The executed-dive summary was never on it: the
 * packet composes the departure checkpoint, where the dive log is not drawn.
 */
export function ManifestPaper({
  cancelled,
  manifest,
  vesselName,
  boatSafety,
  checklist,
  rollCall,
  boatPaper,
  stage,
  dockDesk,
  t,
}: {
  cancelled: ComponentProps<typeof CancelledRollCallBanner>["state"];
  manifest: TripManifest;
  vesselName: string | null;
  boatSafety: ComponentProps<typeof BoatSafetyNotices> | null;
  checklist: ComponentProps<typeof PreDepartureCheckList>;
  rollCall: ReturnType<typeof manifestRollCallProps>;
  /** `PrintedBoatPaper`, built once by the page for both of its branches. */
  boatPaper: ReactNode;
  /** `stageStripProps`, the same read the live strip takes. */
  stage: ComponentProps<typeof PrintedStage>;
  dockDesk: Omit<ComponentProps<typeof DockDesk>, "paper">;
  t: StaffTranslator;
}) {
  return (
    <div className="boat-mode">
      <CancelledRollCallBanner state={cancelled} t={t} />
      <PrintedSoulsOnBoard manifest={manifest} vesselName={vesselName} t={t} />
      <div className="mt-5 space-y-10">
        <PrintedStage {...stage} />
        {boatSafety ? <BoatSafetyNotices {...boatSafety} /> : null}
        <PreDepartureCheckList {...checklist} paper />
        <DiverRollCall context={{ ...rollCall.divers, paper: true }} />
        <CrewRollCall {...rollCall.crew} paper />
        <DockDesk {...dockDesk} paper />
        {boatPaper}
      </div>
    </div>
  );
}
