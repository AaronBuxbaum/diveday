import { z } from "zod";
import { OFFLINE_MANIFEST_RECORD_VERSION } from "./offline-manifests";
import { rollCallEvidenceIdPattern } from "./roll-call-causality";

// Recovery must reject unknown event fields: a newer shell may have recorded
// evidence this version cannot interpret. Nothing here declares a mark synced.
const uuid = z.string().uuid();
const instant = z.iso.datetime();
const receipt = {
  syncStatus: z.enum(["pending", "applied", "rejected"]),
  rejectionReason: z.string().optional(),
  storedOccurredAt: instant.optional(),
  syncedAtRevision: z.number().int().nonnegative().optional(),
};
const common = {
  clientEventId: uuid,
  snapshotId: uuid,
  snapshotSavedAt: instant,
  tripId: uuid,
  occurredAt: instant,
  retractsClientEventId: uuid.optional(),
  ...receipt,
};
const disposition = z
  .enum(["discarded_erasure_cutoff", "discarded_unverified_snapshot"])
  .optional();
const rollCall = z
  .strictObject({
    ...common,
    bookingId: uuid.optional(),
    crewPersonId: uuid.optional(),
    checkpoint: z.union([z.literal("departure"), z.string().regex(/^after_dive_[1-6]$/)]),
    status: z.enum(["boarded", "not_boarded", "cleared"]),
    note: z.string().nullable().optional(),
    erasureEpochToken: z.string().max(128).optional(),
    meetingDay: z.number().int().nonnegative().optional(),
    meetingIdentityProof: z.string().max(128).optional(),
    observedEvidenceIds: z.array(z.string().regex(rollCallEvidenceIdPattern)).max(200).optional(),
    reconcilesEvidence: z.boolean().optional(),
    unresolvedReason: z.string().optional(),
    noteDisposition: disposition,
  })
  .refine((event) => Boolean(event.bookingId) !== Boolean(event.crewPersonId));
const checklist = z.strictObject({
  ...common,
  checklistItemId: uuid,
  status: z.enum(["checked", "cleared"]),
  note: z.string().nullable(),
  erasureEpochToken: z.string().max(128).optional(),
  noteDisposition: disposition,
});
const arrival = z.strictObject({
  ...common,
  bookingId: uuid,
  status: z.enum(["arrived", "cleared"]),
});
const envelope = z.strictObject({
  selectedRollCallMeetingDay: z.number().int().nonnegative().optional(),
  snapshot: z
    .object({
      version: z.literal(OFFLINE_MANIFEST_RECORD_VERSION),
      snapshotId: uuid,
      savedAt: instant,
      expiresAt: instant,
      shop: z.object({ slug: z.string().min(1) }).passthrough(),
      manifests: z
        .array(z.object({ trip: z.object({ id: uuid }).passthrough() }).passthrough())
        .min(1),
    })
    .passthrough(),
  events: z.array(rollCall),
  checklistEvents: z.array(checklist),
  arrivalEvents: z.array(arrival).optional(),
  medicalAlertsSavedBy: z
    .strictObject({ personId: uuid, name: z.string(), savedAt: instant })
    .optional(),
});

/** Validate all queues and scope without mutating or normalizing their evidence. */
export function validRecoveryEnvelope(value: unknown, shopSlug: string, tripId: string): boolean {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) return false;
  const copy = parsed.data;
  if (
    copy.snapshot.shop.slug !== shopSlug ||
    copy.snapshot.manifests.some((item) => item.trip.id !== tripId)
  )
    return false;
  const events = [...copy.events, ...copy.checklistEvents, ...(copy.arrivalEvents ?? [])];
  if (events.some((event) => event.tripId !== tripId)) return false;
  const ids = events.map((event) => event.clientEventId.toLowerCase());
  return new Set(ids).size === ids.length;
}
