import { z } from "zod";
import { ROLL_CALL_EVENT_STATUSES, ROLL_CALL_NOTE_MAX } from "@/lib/roll-call";
import { rollCallEvidenceIdPattern } from "@/lib/roll-call-causality";

// This validates the stored copy's shape only. It does not verify its proofs,
// authorize a decision, establish a meeting, or permit device settlement.
const observationSchema = z.strictObject({
  checkpoint: z.union([z.literal("departure"), z.string().regex(/^after_dive_[1-6]$/)]),
  status: z.enum(ROLL_CALL_EVENT_STATUSES),
  occurredAt: z.iso.datetime().nullable(),
  snapshotId: z.string().uuid().nullable(),
  snapshotSavedAt: z.iso.datetime().nullable(),
  meetingDay: z.number().int().nonnegative().nullable(),
  meetingProof: z.string().max(128).nullable(),
  erasureToken: z.string().max(128).nullable(),
  observedEvidenceIds: z.array(z.string().regex(rollCallEvidenceIdPattern)).max(200).nullable(),
  retractsEventId: z.string().uuid().nullable(),
  retractsClientEventId: z.string().uuid().nullable(),
  reconcilesEvidence: z.boolean(),
  note: z.string().max(ROLL_CALL_NOTE_MAX).nullable(),
});

export function validReviewObservation(value: unknown) {
  const parsed = observationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
