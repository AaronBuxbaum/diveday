import { z } from "zod";
import { ROLL_CALL_NOTE_MAX } from "@/lib/manifests";
import { ROLL_CALL_EVENT_STATUSES } from "@/lib/roll-call";
import { rollCallEvidenceIdPattern } from "@/lib/roll-call-causality";
import { retractsEventIdSchema } from "./roll-call-undo";

export const causalRollCallFields = {
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

export const rollCallSchema = z.object({
  ...causalRollCallFields,
  bookingId: z.string().uuid(),
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
  personId: z.string().uuid(),
  status: z.enum(ROLL_CALL_EVENT_STATUSES),
  /** The same, for the other half of the head count. */
  note: z.string().trim().max(ROLL_CALL_NOTE_MAX).optional(),
  retractsEventId: retractsEventIdSchema,
});
