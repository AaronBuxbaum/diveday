import { z } from "zod";
import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "@/app/api/offline-manifests/staff-context";
import { readOfflineReviewIdentity } from "@/db/offline-review-identity";
import {
  offlineRollCallWitnessEnabled,
  verifyRollCallWitness,
} from "@/lib/offline-roll-call-witness";

const requestBody = z.object({
  tripId: z.string().uuid(),
  bookingId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  checkpoint: z.union([z.literal("departure"), z.string().regex(/^after_dive_[1-6]$/)]),
  meetingDay: z.number().int().min(0),
  witness: z.string().max(16000),
});

/** Open a witnessed original person only to current staff, never from an unverified seat ID. */
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
  const parsed = requestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const input = parsed.data;
  const proof = verifyRollCallWitness(input.witness, {
    shopId: access.shop.id,
    tripId: input.tripId,
    snapshotId: input.snapshotId,
    subjectKind: "seat",
    subjectId: input.bookingId,
    checkpoint: input.checkpoint,
    meetingDay: input.meetingDay,
  });
  if (!proof?.originalPersonId)
    return Response.json(
      { name: null, sameAssignment: false },
      { headers: OFFLINE_MANIFEST_NO_STORE },
    );
  const identity = await readOfflineReviewIdentity(access.db, {
    shopId: access.shop.id,
    tripId: input.tripId,
    bookingId: input.bookingId,
    personId: proof.originalPersonId,
    assignmentGeneration: proof.assignmentGeneration,
  });
  return Response.json(identity, { headers: OFFLINE_MANIFEST_NO_STORE });
}
