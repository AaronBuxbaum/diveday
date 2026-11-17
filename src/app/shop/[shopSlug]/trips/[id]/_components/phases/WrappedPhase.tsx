import type { ComponentProps, ReactNode } from "react";
import { TripRecordPanel } from "../TripRecordPanel";

/**
 * **Wrapped up** (ADR 20261117-trip-page-clock): the owner's phase once the
 * boat is back, and where a cancelled trip opens. It hosts the guest list as
 * sailed, then the record: links out, each dive's log, incident reports and
 * the activity.
 */
export function WrappedPhase({
  guests,
  record,
}: {
  guests: ReactNode;
  record: ComponentProps<typeof TripRecordPanel>;
}) {
  return (
    <div data-phase-panel="wrapped" className="space-y-10">
      {guests}
      <TripRecordPanel {...record} />
    </div>
  );
}
