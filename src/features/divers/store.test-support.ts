/** The saved row, or a failure naming the refusal. */
import type { editDiver } from "./store";

export function saved(result: Awaited<ReturnType<typeof editDiver>>) {
  if (!result.ok) throw new Error(`editDiver refused: ${result.reason}`);
  return result.person;
}

export const DATE_INTEREST = { scope: "date", askedBy: "diver" } as const;

/** Statements for the diver history fixture; observation is authored by its caller. */
export function standingSeatEvidence(shopId: string, recordedByPersonId: string) {
  return (
    bookingId: string,
    tripId: string,
    status: "boarded" | "not_boarded" | "cleared",
    checkpoint: string,
    at: number,
  ) => ({
    shopId,
    tripId,
    bookingId,
    recordedByPersonId,
    status,
    checkpoint,
    occurredAt: new Date(Date.UTC(2026, 0, 1, 8, at)),
  });
}
