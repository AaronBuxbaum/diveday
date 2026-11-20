import { z } from "zod";
import { nowMs } from "@/lib/clock";
import { ROLL_CALL_NOTE_MAX } from "@/lib/manifests";
import { ROLL_CALL_EVENT_STATUSES } from "@/lib/roll-call";
import { rollCallEvidenceIdPattern } from "@/lib/roll-call-causality";
import { retractsEventIdSchema } from "./roll-call-undo";

const causalRollCallFields = {
  observedAt: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.iso
      .datetime()
      .refine((value) => Date.parse(value) <= nowMs())
      .optional(),
  ),
  clientEventId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  observedEvidenceIds: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }, z.array(z.string().regex(rollCallEvidenceIdPattern)).max(200).optional()),
  meetingDay: z.coerce.number().int().min(0).optional(),
  reconcilesEvidence: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
};

const liveRecountProof = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  },
  z
    .object({
      snapshotId: z.string().uuid(),
      witness: z.string().max(16000),
      meetingDay: z.number().int().min(0),
    })
    .optional(),
);

export const rollCallSchema = z.object({
  ...causalRollCallFields,
  liveRecountProof,
  bookingId: z.string().uuid(),
  physicalPresenceOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  status: z.enum(ROLL_CALL_EVENT_STATUSES),
  /**
   * What the crew observed about a person who is unaccounted for. Bounded here
   * and narrowed again in the write, which keeps it only at an after-dive
   * checkpoint (`rollCallNoteAllowed`) — so this field cannot put free text on
   * a departure event the surface never offered a box for.
   */
  note: z.string().trim().max(ROLL_CALL_NOTE_MAX).optional(),
  retractsEventId: retractsEventIdSchema,
});

export const crewRollCallSchema = z.object({
  ...causalRollCallFields,
  liveRecountProof,
  personId: z.string().uuid(),
  status: z.enum(ROLL_CALL_EVENT_STATUSES),
  /** The same, for the other half of the head count. */
  note: z.string().trim().max(ROLL_CALL_NOTE_MAX).optional(),
  retractsEventId: retractsEventIdSchema,
});
