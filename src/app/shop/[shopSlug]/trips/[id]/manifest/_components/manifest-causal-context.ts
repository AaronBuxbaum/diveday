import type { RollCallCausalContext } from "@/lib/roll-call-causality";

type ManifestContexts = {
  divers: readonly { bookingId: string; rollCallContext?: RollCallCausalContext }[];
  crew: readonly { id: string; rollCallContext?: RollCallCausalContext }[];
};

/** Preserve the observed evidence and meeting day from this exact manifest. */
export function manifestCausalContexts(
  manifest: ManifestContexts,
): Record<string, RollCallCausalContext> {
  return Object.fromEntries([
    ...manifest.divers.flatMap((row) =>
      row.rollCallContext ? [[`bookingId:${row.bookingId}`, row.rollCallContext]] : [],
    ),
    ...manifest.crew.flatMap((row) =>
      row.rollCallContext ? [[`personId:${row.id}`, row.rollCallContext]] : [],
    ),
  ]);
}
