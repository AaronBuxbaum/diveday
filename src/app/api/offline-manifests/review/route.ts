import { z } from "zod";
import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "@/app/api/offline-manifests/staff-context";
import { recordRollCall } from "@/db/manifests";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import {
  offlineRollCallWitnessEnabled,
  verifyRollCallWitness,
} from "@/lib/offline-roll-call-witness";

const checkpoint = z.union([z.literal("departure"), z.string().regex(/^after_dive_[1-6]$/)]);
const confirmation = z.object({
  tripId: z.string().uuid(),
  bookingId: z.string().uuid(),
  checkpoint,
  status: z.enum(["boarded", "not_boarded"]),
  snapshotId: z.string().uuid(),
  meetingDay: z.number().int().min(0),
  witness: z.string().min(1).max(16000),
  originalWitness: z.string().min(1).max(16000),
  originalSnapshotId: z.string().uuid(),
  originalMeetingDay: z.number().int().min(0),
  confirmationId: z.string().uuid(),
  confirmed: z.literal(true),
});

/** Read the current roster and freshly issued context for an explicit review. */
export async function GET(request: Request) {
  if (!offlineRollCallWitnessEnabled())
    return Response.json(
      { error: "unavailable" },
      { status: 404, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  const tripId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("tripId"));
  if (!tripId.success)
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const result = await buildOfflineManifestCopies(access.db, access.shop, access.user.personId, [
    tripId.data,
  ]);
  const current = result.payloads[0];
  if (!current)
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  return Response.json({ current }, { headers: OFFLINE_MANIFEST_NO_STORE });
}

/** A staff confirmation is a new live mark; the original device event is never replayed here. */
export async function POST(request: Request) {
  if (!offlineRollCallWitnessEnabled())
    return Response.json(
      { error: "unavailable" },
      { status: 404, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const access = await authorizeOfflineManifestStaff();
  if (!access.ok) return access.response;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return Response.json(
      { error: "json_required" },
      { status: 415, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const parsed = confirmation.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const input = parsed.data;
  const scope = {
    shopId: access.shop.id,
    tripId: input.tripId,
    snapshotId: input.snapshotId,
    subjectKind: "seat" as const,
    subjectId: input.bookingId,
    checkpoint: input.checkpoint,
    meetingDay: input.meetingDay,
  };
  const witness = verifyRollCallWitness(input.witness, scope);
  const result = await recordRollCall(access.db, {
    shopId: access.shop.id,
    tripId: input.tripId,
    bookingId: input.bookingId,
    recordedByPersonId: access.user.personId,
    checkpoint: input.checkpoint as "departure" | `after_dive_${1 | 2 | 3 | 4 | 5 | 6}`,
    status: input.status,
    source: "live",
    clientEventId: input.confirmationId,
    observedEvidenceIds: witness?.frontier ?? [],
    reconcilesEvidence: true,
    meetingDay: input.meetingDay,
    offlineSnapshotId: input.snapshotId,
    reviewWitness: input.witness,
    reviewOriginalWitness: input.originalWitness,
    reviewOriginalSnapshotId: input.originalSnapshotId,
    reviewOriginalMeetingDay: input.originalMeetingDay,
  });
  if (!result.ok)
    return Response.json(
      {
        error: result.reason,
        ...(result.notApplied
          ? { status: "not_applied", confirmationId: input.confirmationId }
          : {}),
      },
      {
        status: result.reason === "staff_not_found" ? 401 : 409,
        headers: OFFLINE_MANIFEST_NO_STORE,
      },
    );
  return Response.json(
    {
      status: result.duplicate ? "duplicate" : "applied",
      eventId: result.eventId,
      confirmationId: input.confirmationId,
    },
    { headers: OFFLINE_MANIFEST_NO_STORE },
  );
}
