import type { ComponentProps } from "react";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { BoatTabSheet } from "./BoatTabSheet";
import type { executedDiveLogView } from "./executed-dive-copy";
import { ManifestPaper } from "./ManifestPaper";
import { PrintedBoatPaper } from "./PrintedBoatProcedure";

type PaperProps = ComponentProps<typeof ManifestPaper>;

/**
 * **The Boat tab's sheet, composed from the page's own view** (issue #2745):
 * the packet's manifest paper for the checkpoint on screen, and after a dive
 * that dive's logged line. The roll call's rows repeat under the screen, so
 * every id moves to `${tripId}-sheet`: the skip link, the count panel's links
 * and every label keep pointing at the screen.
 */
export function BoatTabPaper({
  tripId,
  shop,
  shopSlug,
  checkpoint,
  paperIdentity,
  diveLog,
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
}: Omit<PaperProps, "boatPaper"> & {
  tripId: string;
  shop: { name: string; brandColor: string | null };
  shopSlug: string;
  checkpoint: RollCallCheckpoint;
  paperIdentity: { identity: string[]; printed: string };
  /** `executedDiveLogView`, after a dive; null at the dock. */
  diveLog: ReturnType<typeof executedDiveLogView> | null;
  boatPaper: ComponentProps<typeof PrintedBoatPaper>;
}) {
  const sheetIds = `${tripId}-sheet`;
  const logged = diveLog?.planned.find(
    ({ diveNumber }) => `after_dive_${diveNumber}` === checkpoint,
  );
  return (
    <BoatTabSheet
      shop={shop}
      shopSlug={shopSlug}
      name={t("trips.surfaces.manifest")}
      printed={paperIdentity.printed}
      // The margin's identity, less the shop the band already names.
      departure={paperIdentity.identity.slice(1)}
      diveLog={
        diveLog && logged ? { heading: diveLog.labels.heading, line: logged.summaryLine } : null
      }
    >
      <ManifestPaper
        cancelled={cancelled}
        manifest={manifest}
        vesselName={vesselName}
        boatSafety={boatSafety ? { ...boatSafety, idPrefix: sheetIds } : null}
        checklist={{ ...checklist, idPrefix: sheetIds }}
        rollCall={{
          divers: { ...rollCall.divers, idPrefix: sheetIds },
          crew: { ...rollCall.crew, idPrefix: sheetIds },
        }}
        boatPaper={<PrintedBoatPaper {...boatPaper} idPrefix={sheetIds} />}
        stage={stage}
        dockDesk={dockDesk}
        t={t}
      />
    </BoatTabSheet>
  );
}
