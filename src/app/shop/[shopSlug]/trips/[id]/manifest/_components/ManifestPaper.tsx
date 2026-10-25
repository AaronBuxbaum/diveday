import type { ComponentProps, ReactNode } from "react";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";
import { CancelledRollCallBanner } from "./CancelledRollCallBanner";
import { CrewRollCall } from "./CrewRollCall";
import { DiverRollCall } from "./DiverRollCall";
import { PreDepartureCheckList } from "./PreDepartureCheckList";
import { PrintedSoulsOnBoard } from "./PrintedSoulsOnBoard";
import type { manifestRollCallProps } from "./roll-call-props";

/**
 * **The manifest as the trip packet's paper** (visual review 2026-10-24, B03,
 * B55). Only the packet composes the manifest page under `PAPER_PACKET`, and
 * this is what it renders: what the printed sheet has always carried, in the
 * same order — the souls on board, the boat's safety notices, the boat
 * check's printed list, the roll call's printed rows, and the boat's
 * procedure and numbers. No header (the packet's dive plan names the
 * departure once), no tabs, no count panel or stage strip, and no control
 * anywhere, so the packet's screen view is the sheet that comes out.
 */
export function ManifestPaper({
  cancelled,
  manifest,
  vesselName,
  boatSafety,
  checklist,
  rollCall,
  boatPaper,
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
  t: StaffTranslator;
}) {
  return (
    <div className="boat-mode">
      <CancelledRollCallBanner state={cancelled} t={t} />
      <PrintedSoulsOnBoard manifest={manifest} vesselName={vesselName} t={t} />
      <div className="mt-5 space-y-10">
        {boatSafety ? <BoatSafetyNotices {...boatSafety} /> : null}
        <PreDepartureCheckList {...checklist} paper />
        <DiverRollCall context={{ ...rollCall.divers, paper: true }} />
        <CrewRollCall {...rollCall.crew} paper />
        {boatPaper}
      </div>
    </div>
  );
}
