import { groupLabelClass } from "@/components/ui/group-label";
import type { TripStage } from "@/lib/trip-stages";
import type { StageStripCopy } from "./StageStrip";

/**
 * The packet prints the current stage label and recorded line without the
 * interactive `StageStrip` (`ManifestPaper`). With no current stage, there is
 * nothing to print (K-141).
 */
export function PrintedStage({
  copy,
  current,
}: {
  copy: StageStripCopy;
  current: TripStage | null;
}) {
  const label = copy.taps.find((tap) => tap.stage === current)?.label;
  if (!label) return null;
  return (
    <section aria-label={copy.legend}>
      <h2 className={groupLabelClass()}>{copy.legend}</h2>
      <p className="mt-2 text-base font-semibold">{label}</p>
      {copy.recordedLine ? (
        <p className="mt-1 text-sm text-muted tabular-nums">{copy.recordedLine}</p>
      ) : null}
    </section>
  );
}
