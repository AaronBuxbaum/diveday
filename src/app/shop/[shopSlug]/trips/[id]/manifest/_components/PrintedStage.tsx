import { groupLabelClass } from "@/components/ui/group-label";
import type { TripStage } from "@/lib/trip-stages";
import type { StageStripCopy } from "./StageStrip";

/**
 * **Where the boat is, on the packet's paper** (layer 4 review, dde-b 4).
 * `StageStrip` prints the crew's word under its buttons; the packet renders
 * no strip (`ManifestPaper`), so this is that printed word on its own: the
 * pressed tap's label and who said it when. With no word said there is
 * nothing to print, as on the strip (K-141).
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
